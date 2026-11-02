import QRCode from "qrcode";
import { TelegramDriver, deadline, mapError, type Credentials } from "./driver";
import {
  load,
  mutate,
  lease,
  release,
  secret,
  seal,
  finishConnection,
  isAdministrator,
} from "./store";
import { eligible, recount, TelegramError } from "./domain";

export async function qrStep(userId: string, attempt: string) {
  "use step";
  console.info("[telegram] qr: iniciado");
  let driver: TelegramDriver | undefined,
    token: string | undefined,
    completed = false;
  const abort = new AbortController();
  let watcher: ReturnType<typeof setInterval> | undefined;
  try {
    const lock = await lease(userId, 300000);
    token = lock.token;
    if (lock.row.authAttempt !== attempt || lock.row.authState !== "qr") return;
    const key = secret<Credentials>(lock.row.credentialsEnc);
    if (!key)
      throw new TelegramError("credentials", "Cadastre as chaves do Telegram.");
    driver = new TelegramDriver(key, secret<string>(lock.row.sessionEnc) || "");
    await driver.connect(false);
    let watching = false;
    watcher = setInterval(() => {
      if (watching) return;
      watching = true;
      Promise.all([load(userId), isAdministrator(userId)])
        .then(([row, allowed]) => {
          if (
            !allowed ||
            row.authAttempt !== attempt ||
            row.authState !== "qr" ||
            !row.authExpiresAt ||
            row.authExpiresAt.getTime() < Date.now()
          )
            abort.abort();
        })
        .catch(() => abort.abort())
        .finally(() => {
          watching = false;
        });
    }, 1000);
    if (!(await driver.client.checkAuthorization()))
      await deadline(
        driver.client.signInUserWithQrCode(key, {
          abortSignal: abort.signal,
          qrCode: async (qr) => {
            if (abort.signal.aborted)
              throw new TelegramError("cancelled", "Conexão cancelada.");
            const url =
              "tg://login?token=" + Buffer.from(qr.token).toString("base64url");
            const image = await QRCode.toDataURL(url, {
              margin: 4,
              width: 300,
              errorCorrectionLevel: "M",
            });
            await mutate(userId, (row) => {
              if (row.authAttempt !== attempt || row.authState !== "qr")
                throw new TelegramError("cancelled", "Conexão cancelada.");
              row.loginEnc = seal({ image, expires_at: qr.expires });
            });
          },
          password: async () => {
            throw new TelegramError(
              "password_required",
              "Digite sua senha de duas etapas.",
            );
          },
          onError: async (error) => {
            throw error;
          },
        }),
        230000,
      );
    const account = await driver.me(),
      saved = driver.save();
    if (!(await isAdministrator(userId)))
      throw new TelegramError(
        "permission",
        "O operador não possui mais acesso de administrador.",
        0,
        403,
      );
    await mutate(userId, (row) => {
      if (row.authState !== "qr")
        throw new TelegramError("cancelled", "Conexão cancelada.");
      finishConnection(row, attempt, account, saved);
    });
    completed = true;
    console.info("[telegram] qr: conectado");
  } catch (error) {
    const safe = mapError(error);
    await mutate(userId, (row) => {
      if (row.authAttempt !== attempt || row.authState !== "qr") return;
      if (safe.code === "password_required" && driver) {
        row.sessionEnc = seal(driver.save());
        row.authState = "password";
        row.loginEnc = null;
        row.authExpiresAt = new Date(Date.now() + 600000);
      } else {
        row.authState = "qr_error";
        row.loginEnc = seal({ error: safe.message });
        if (safe.code === "flood_wait")
          row.parsed.limits.not_before = Date.now() / 1000 + safe.wait;
      }
    });
    console.info("[telegram] qr: encerrado", { code: safe.code });
  } finally {
    abort.abort();
    if (watcher) clearInterval(watcher);
    if (driver) {
      if (!completed) {
        const current = await load(userId).catch(() => undefined);
        const allowed = await isAdministrator(userId).catch(() => false);
        if (
          !allowed ||
          (current &&
            (current.authAttempt !== attempt ||
              current.authState !== "password"))
        )
          await deadline(driver.client.logOut(), 5000).catch(() => undefined);
      }
      await driver.close();
    }
    if (token) await release(userId, token);
  }
}
qrStep.maxRetries = 0;

export async function queueStep(
  userId: string,
  jobId: string,
): Promise<boolean> {
  "use step";
  console.info("[telegram] fila: processar próximo");
  let driver: TelegramDriver | undefined,
    token: string | undefined,
    selectedId: number | undefined;
  try {
    const lock = await lease(userId);
    token = lock.token;
    const item = await mutate(userId, (row) => {
      const data = row.parsed,
        job = data.jobs.find((j) => j.id === jobId);
      if (!job || !["queued", "running"].includes(job.state)) return null;
      if (
        data.limits.restricted ||
        data.limits.not_before > Date.now() / 1000
      ) {
        job.state = "paused_restriction";
        job.message = "Aguardando liberação do Telegram. Retomada manual.";
        return null;
      }
      if (row.authState !== "connected") {
        job.state = "failed";
        job.message = "Reconecte a conta antes de continuar.";
        return null;
      }
      if (
        data.results.some(
          (r) => r.job_id === jobId && r.state === "in_progress",
        )
      ) {
        job.state = "interrupted";
        job.message =
          "Uma tentativa anterior não teve resultado confirmado. Confira antes de repetir.";
        for (const r of data.results)
          if (r.job_id === jobId && r.state === "in_progress") {
            r.state = "uncertain";
            r.message = job.message;
          }
        recount(data, job);
        return null;
      }
      const result = data.results.find(
        (r) => r.job_id === jobId && r.state === "waiting",
      );
      if (!result) {
        job.state = "completed";
        job.message = "Operação concluída. Confira os resultados individuais.";
        return null;
      }
      if (!eligible(data, result.user_id, job.source_id, job.target_id)) {
        result.state = "revoked";
        result.message =
          "Seleção ou autorização indisponível. Nenhum convite enviado.";
        recount(data, job);
        return { skip: true } as const;
      }
      const person = data.contacts.find(
        (p) => p.user_id === result.user_id && p.source_id === job.source_id,
      )!;
      result.state = "in_progress";
      result.message = "Verificando participação e inclusão.";
      result.updated_at = Date.now() / 1000;
      job.state = "running";
      job.lease = token;
      job.lease_until = Date.now() / 1000 + 120;
      return {
        skip: false,
        person: structuredClone(person),
        source: job.source_id,
        target: job.target_id,
      } as const;
    });
    if (!item) return false;
    if (item.skip) return true;
    selectedId = item.person.user_id;
    const key = secret<Credentials>(lock.row.credentialsEnc),
      saved = secret<string>(lock.row.sessionEnc);
    if (!key || !saved)
      throw new TelegramError("auth_required", "Reconecte a conta Telegram.");
    driver = new TelegramDriver(key, saved);
    await driver.connect();
    // Revogação/cancelamento feitos durante a conexão ainda impedem o despacho.
    const canSend = await mutate(userId, (row) => {
      const job = row.parsed.jobs.find((j) => j.id === jobId)!;
      if (!["running", "queued"].includes(job.state)) {
        const result = row.parsed.results.find(
          (r) => r.job_id === jobId && r.user_id === selectedId,
        )!;
        result.state = "waiting";
        result.message =
          "Nenhum convite iniciado; operação pausada ou cancelada.";
        job.lease = undefined;
        job.lease_until = undefined;
        return null;
      }
      return eligible(row.parsed, selectedId!, job.source_id, job.target_id);
    });
    if (canSend === null) return false;
    if (!(await isAdministrator(userId)))
      throw new TelegramError(
        "permission",
        "O operador não possui mais acesso de administrador.",
        0,
        403,
      );
    const outcome = canSend
      ? await deadline(driver.invite(item.source, item.target, item.person))
      : {
          state: "revoked",
          message:
            "Operação pausada, cancelada ou autorização retirada antes do despacho.",
        };
    return await mutate(userId, (row) => {
      const data = row.parsed,
        job = data.jobs.find((j) => j.id === jobId)!,
        result = data.results.find(
          (r) => r.job_id === jobId && r.user_id === selectedId,
        )!;
      if (job.lease !== token) return false;
      Object.assign(result, outcome, { updated_at: Date.now() / 1000 });
      job.lease = undefined;
      job.lease_until = undefined;
      if (["added", "already"].includes(outcome.state))
        for (const p of data.contacts)
          if (p.user_id === selectedId && p.source_id === job.source_id)
            p.selected = false;
      recount(data, job);
      if (job.processed === job.total && job.state === "running") {
        job.state = "completed";
        job.message = "Operação concluída. Confira os resultados individuais.";
      }
      return job.state === "running";
    });
  } catch (error) {
    const safe = mapError(error);
    if (safe.code === "busy" && !token) return true;
    await mutate(userId, (row) => {
      const job = row.parsed.jobs.find((j) => j.id === jobId);
      if (!job) return;
      const cancelled = job.state === "cancelled";
      const result = row.parsed.results.find(
        (r) => r.job_id === jobId && r.user_id === selectedId,
      );
      if (result?.state === "in_progress") {
        result.state =
          safe.code === "privacy"
            ? "privacy"
            : safe.code === "flood_wait"
              ? "flood_wait"
              : "uncertain";
        result.message = safe.message;
        result.updated_at = Date.now() / 1000;
      }
      if (safe.code === "flood_wait") {
        row.parsed.limits.not_before = Date.now() / 1000 + safe.wait;
        job.not_before = row.parsed.limits.not_before;
        job.state = "paused_restriction";
      } else if (safe.code === "restricted") {
        row.parsed.limits.restricted = true;
        job.state = "restricted";
      } else if (safe.code !== "privacy") {
        job.state = "failed";
      }
      if (cancelled) job.state = "cancelled";
      job.message = safe.message;
      job.lease = undefined;
      job.lease_until = undefined;
      recount(row.parsed, job);
    });
    console.info("[telegram] fila: ocorrência", { code: safe.code });
    return safe.code === "privacy";
  } finally {
    if (driver) await driver.close();
    if (token) await release(userId, token);
  }
}
queueStep.maxRetries = 0;
