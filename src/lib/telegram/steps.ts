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
  type Workspace,
} from "./store";
import { eligible, recount, TelegramError, type Data, type Job, type Contact } from "./domain";
import { activeProfileId, retainedSessionEncs } from "./accounts";
import { telegramNetworkStatus } from "./network";

function accountIdentity(data: Data) {
  const generation = data.accounts?.generation ?? 0;
  const accountId = data.account?.id;
  return {
    profileId: activeProfileId(data),
    generation: Number.isSafeInteger(generation) && generation >= 0 ? generation : -1,
    accountId: typeof accountId === "number" && Number.isSafeInteger(accountId) && accountId > 0 ? accountId : null,
  };
}
function workerScope(row: Workspace, token: string) {
  return {
    ...accountIdentity(row.parsed), token,
    attempt: row.authAttempt,
    state: row.authState,
    credentials: row.credentialsEnc,
    session: row.sessionEnc,
  };
}
type WorkerScope = ReturnType<typeof workerScope>;
function sameWorker(row: Workspace, scope: WorkerScope, allowExpired = false) {
  const identity = accountIdentity(row.parsed);
  return identity.profileId === scope.profileId && identity.generation === scope.generation &&
    identity.accountId === scope.accountId && scope.generation >= 0 &&
    row.busyToken === scope.token && row.authAttempt === scope.attempt && row.authState === scope.state &&
    row.credentialsEnc === scope.credentials && row.sessionEnc === scope.session &&
    (allowExpired || (!!row.busyUntil && row.busyUntil.getTime() > Date.now()));
}
type JobPin = { accountId: number; profileId: string; generation: number; legacy: boolean };
function jobPin(data: Data, job: Job): JobPin | null {
  const identity = accountIdentity(data);
  if (!identity.accountId || identity.generation < 0 || job.accountId !== identity.accountId) return null;
  if (job.accountProfileId === undefined && job.accountGeneration === undefined) {
    if (data.accounts || identity.profileId !== "primary" || identity.generation !== 0) return null;
    return { accountId: identity.accountId, profileId: "primary", generation: 0, legacy: true };
  }
  if (job.accountProfileId !== identity.profileId || job.accountGeneration !== identity.generation) return null;
  return { accountId: identity.accountId, profileId: identity.profileId, generation: identity.generation, legacy: false };
}
function sameJobPin(job: Job, pin: JobPin) {
  return job.accountId === pin.accountId && (pin.legacy
    ? job.accountProfileId === undefined && job.accountGeneration === undefined
    : job.accountProfileId === pin.profileId && job.accountGeneration === pin.generation);
}
function contactBelongs(data: Data, person: Contact, pin: JobPin) {
  return person.accountId === pin.accountId || (person.accountId === undefined &&
    !data.accounts && pin.profileId === "primary" && pin.generation === 0);
}
function interruptQueue(data: Data, job: Job, message: string, dispatched = false) {
  for (const result of data.results) {
    if (result.job_id === job.id && result.state === "in_progress") {
      result.state = dispatched ? "uncertain" : "waiting";
      result.message = message;
      result.updated_at = Date.now() / 1000;
    }
  }
  if (job.state !== "cancelled") job.state = "interrupted";
  job.message = message;
  job.lease = undefined;
  job.lease_until = undefined;
  recount(data, job);
}

export async function qrStep(userId: string, attempt: string) {
  "use step";
  console.info("[telegram] qr: iniciado");
  let driver: TelegramDriver | undefined,
    token: string | undefined,
    completed = false,
    scope: WorkerScope | undefined;
  const abort = new AbortController();
  let watcher: ReturnType<typeof setInterval> | undefined;
  try {
    const lock = await lease(userId, 300000);
    token = lock.token;
    scope = workerScope(lock.row, token);
    if (lock.row.authAttempt !== attempt || lock.row.authState !== "qr") return;
    if (!sameWorker(lock.row, scope) || !lock.row.authExpiresAt || lock.row.authExpiresAt.getTime() < Date.now()) return;
    const key = secret<Credentials>(lock.row.credentialsEnc);
    if (!key)
      throw new TelegramError("credentials", "Cadastre as chaves do Telegram.");
    driver = new TelegramDriver(key, secret<string>(lock.row.sessionEnc) || "");
    await driver.connect(false);
    if (!sameWorker(await load(userId), scope))
      throw new TelegramError("cancelled", "A conta selecionada mudou. Inicie a conexão novamente.", 0, 409);
    let watching = false;
    watcher = setInterval(() => {
      if (watching) return;
      watching = true;
      Promise.all([load(userId), isAdministrator(userId)])
        .then(([row, allowed]) => {
          if (
            !allowed ||
            !scope || !sameWorker(row, scope) ||
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
              if (!scope || !sameWorker(row, scope) || row.authAttempt !== attempt || row.authState !== "qr" ||
                  !row.authExpiresAt || row.authExpiresAt.getTime() < Date.now())
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
    const account = await deadline(driver.me()),
      saved = driver.save();
    if (!(await isAdministrator(userId)))
      throw new TelegramError(
        "permission",
        "O operador não possui mais acesso de administrador.",
        0,
        403,
      );
    await mutate(userId, (row) => {
      if (!scope || !sameWorker(row, scope) || row.authState !== "qr" ||
          !row.authExpiresAt || row.authExpiresAt.getTime() < Date.now())
        throw new TelegramError("cancelled", "Conexão cancelada.");
      finishConnection(row, attempt, account, saved);
    });
    completed = true;
    console.info("[telegram] qr: conectado");
  } catch (error) {
    const safe = mapError(error);
    await mutate(userId, (row) => {
      if (!scope || !sameWorker(row, scope, true) || row.authAttempt !== attempt || row.authState !== "qr") return;
      if (safe.code === "password_required" && driver) {
        row.sessionEnc = seal(driver.save());
        row.authState = "password";
        row.loginEnc = null;
        row.authExpiresAt = new Date(Date.now() + 600000);
      } else {
        row.authState = "qr_error";
        row.loginEnc = seal({ error: safe.message });
        if (safe.code === "flood_wait")
          row.parsed.limits.not_before = Math.max(row.parsed.limits.not_before, Date.now() / 1000 + Math.max(0, safe.wait));
        if (safe.code === "restricted") row.parsed.limits.restricted = true;
      }
    });
    console.info("[telegram] qr: encerrado", { code: safe.code });
  } finally {
    abort.abort();
    if (watcher) clearInterval(watcher);
    if (driver) {
      if (!completed) {
        const current = await load(userId).catch(() => undefined);
        if (current) {
          try {
            const saved = driver.save();
            const retainedActive = secret<string>(current.sessionEnc) === saved &&
              (["connected", "saved"].includes(current.authState) || (current.authState === "password" &&
                current.authAttempt === attempt && !!scope &&
                activeProfileId(current.parsed) === scope.profileId &&
                accountIdentity(current.parsed).generation === scope.generation));
            const retainedParked = retainedSessionEncs(current, { seal, secret })
              .some((encrypted) => secret<string>(encrypted) === saved);
            if (!retainedActive && !retainedParked)
              await deadline(driver.client.logOut(), 5000).catch(() => undefined);
          } catch {
            // Unknown retention must not revoke a potentially parked account.
            console.warn("[telegram] qr: não foi possível confirmar a retenção da sessão");
          }
        }
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
    selectedId: number | undefined,
    scope: WorkerScope | undefined,
    dispatchStarted = false,
    stoppedBeforeDispatch = false,
    continueAfterStop = false;
  try {
    const lock = await lease(userId);
    token = lock.token;
    scope = workerScope(lock.row, token);
    const item = await mutate(userId, (row) => {
      const data = row.parsed,
        job = data.jobs.find((j) => j.id === jobId);
      if (!job || !["queued", "running"].includes(job.state)) return null;
      if (!scope || !sameWorker(row, scope) || !jobPin(data, job)) {
        interruptQueue(data, job, "A conta ou sessão desta operação não corresponde à conta selecionada. Recrie a operação na conta correta.");
        return null;
      }
      const network = telegramNetworkStatus();
      if (!network.enabled) {
        job.state = "paused";
        job.message = network.notice;
        return null;
      }
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
            r.updated_at = Date.now() / 1000;
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
      const person = data.contacts.find(
        (p) => p.user_id === result.user_id && p.source_id === job.source_id,
      );
      const pin = jobPin(data, job)!;
      if (person && !contactBelongs(data, person, pin)) {
        interruptQueue(data, job, "O participante foi consultado por outra conta ou não possui uma origem de conta confirmada. Consulte a origem novamente.");
        return null;
      }
      if (!person || !eligible(data, result.user_id, job.source_id, job.target_id)) {
        result.state = "revoked";
        result.message =
          "Participante fora da seleção. Nenhum convite enviado.";
        result.updated_at = Date.now() / 1000;
        recount(data, job);
        return { skip: true } as const;
      }
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
        pin,
      } as const;
    });
    if (!item) return false;
    if (item.skip) return true;
    selectedId = item.person.user_id;
    const key = secret<Credentials>(lock.row.credentialsEnc),
      saved = secret<string>(lock.row.sessionEnc);
    if (!key || !saved)
      throw new TelegramError("auth_required", "Reconecte a conta Telegram.");
    await mutate(userId, (row) => {
      const job = row.parsed.jobs.find((current) => current.id === jobId);
      if (!job || !scope || !sameWorker(row, scope) || !sameJobPin(job, item.pin) || !jobPin(row.parsed, job)) {
        if (job && job.lease === token) interruptQueue(row.parsed, job, "A conta mudou antes da conexão. Nenhum convite foi enviado.");
        stoppedBeforeDispatch = true;
      }
    });
    if (stoppedBeforeDispatch) return false;
    driver = new TelegramDriver(key, saved);
    await driver.connect();
    const connectedAccount = await deadline(driver.me());
    if (connectedAccount.id !== item.pin.accountId) {
      await mutate(userId, (row) => {
        const job = row.parsed.jobs.find((current) => current.id === jobId);
        if (job && job.lease === token) interruptQueue(row.parsed, job, "A sessão Telegram pertence a outra conta. Reconecte a conta correta antes de recriar a operação.");
      });
      return false;
    }
    // Mudanças de seleção/cancelamento durante a conexão ainda impedem o despacho.
    const canSend = await mutate(userId, (row) => {
      const job = row.parsed.jobs.find((j) => j.id === jobId);
      if (!job || job.lease !== token) return null;
      if (!scope || !sameWorker(row, scope) || !sameJobPin(job, item.pin) || !jobPin(row.parsed, job)) {
        interruptQueue(row.parsed, job, "A conta mudou antes do despacho. Nenhum convite foi enviado.");
        return null;
      }
      if (!["running", "queued"].includes(job.state)) {
        const result = row.parsed.results.find(
          (r) => r.job_id === jobId && r.user_id === selectedId,
        )!;
        result.state = "waiting";
        result.message =
          "Nenhum convite iniciado; operação pausada ou cancelada.";
        result.updated_at = Date.now() / 1000;
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
      ? await deadline(driver.invite(item.source, item.target, item.person, async () => {
          if (!(await isAdministrator(userId)))
            throw new TelegramError("permission", "O operador não possui mais acesso de administrador.", 0, 403);
          const allowed = await mutate(userId, (row) => {
            const job = row.parsed.jobs.find((current) => current.id === jobId);
            if (!job || job.lease !== token) return false;
            if (!scope || !sameWorker(row, scope) || !sameJobPin(job, item.pin) || !jobPin(row.parsed, job)) {
              interruptQueue(row.parsed, job, "A conta mudou durante a verificação. Nenhum convite foi enviado.");
              return false;
            }
            if (!["queued", "running"].includes(job.state)) {
              const result = row.parsed.results.find((current) => current.job_id === jobId && current.user_id === selectedId)!;
              result.state = "waiting";
              result.message = "Operação pausada ou cancelada antes do envio.";
              result.updated_at = Date.now() / 1000;
              job.lease = undefined;
              job.lease_until = undefined;
              return false;
            }
            const current = row.parsed.contacts.find((person) => person.user_id === selectedId && person.source_id === job.source_id);
            if (!current || !contactBelongs(row.parsed, current, item.pin)) {
              interruptQueue(row.parsed, job, "O participante não pertence à conta desta operação. Nenhum convite foi enviado.");
              return false;
            }
            if (!eligible(row.parsed, selectedId!, job.source_id, job.target_id)) {
              const result = row.parsed.results.find((current) => current.job_id === jobId && current.user_id === selectedId)!;
              result.state = "revoked";
              result.message = "Seleção retirada antes do envio. Nenhum convite foi enviado.";
              result.updated_at = Date.now() / 1000;
              job.lease = undefined;
              job.lease_until = undefined;
              recount(row.parsed, job);
              if (job.processed === job.total) job.state = "completed";
              continueAfterStop = ["queued", "running"].includes(job.state);
              return false;
            }
            return true;
          });
          if (!allowed) {
            stoppedBeforeDispatch = true;
            throw new TelegramError("cancelled", "O despacho foi interrompido antes do convite.", 0, 409);
          }
          dispatchStarted = true;
        }))
      : {
          state: "revoked",
          message:
            "Operação pausada, cancelada ou seleção retirada antes do despacho.",
        };
    if (outcome.state === "added" && !dispatchStarted)
      throw new TelegramError("uncertain", "O envio não teve sua conta confirmada antes do despacho.", 0, 409);
    return await mutate(userId, (row) => {
      const data = row.parsed,
        job = data.jobs.find((j) => j.id === jobId),
        result = data.results.find(
          (r) => r.job_id === jobId && r.user_id === selectedId,
        )!;
      if (!job || job.lease !== token || !sameJobPin(job, item.pin) || !result) return false;
      const sameAccount = !!scope && sameWorker(row, scope) && !!jobPin(data, job);
      Object.assign(result, outcome, { updated_at: Date.now() / 1000 });
      job.lease = undefined;
      job.lease_until = undefined;
      if (sameAccount && ["added", "already", "excluded_admin", "not_in_source"].includes(outcome.state))
        for (const p of data.contacts)
          if (p.user_id === selectedId && p.source_id === job.source_id) {
            p.selected = false;
            if (["excluded_admin", "not_in_source"].includes(outcome.state)) p.accessHash = "";
          }
      recount(data, job);
      if (!sameAccount) {
        if (job.state !== "cancelled") job.state = job.processed === job.total ? "completed" : "interrupted";
        job.message = "O resultado da conta original foi registrado. A conta selecionada mudou; nenhum outro convite será enviado.";
        return false;
      }
      if (job.processed === job.total && job.state === "running") {
        job.state = "completed";
        job.message = "Operação concluída. Confira os resultados individuais.";
      }
      return job.state === "running";
    });
  } catch (error) {
    const safe = mapError(error);
    if (stoppedBeforeDispatch) return continueAfterStop;
    if (safe.code === "busy" && !token) return true;
    const handled = await mutate(userId, (row) => {
      const job = row.parsed.jobs.find((j) => j.id === jobId);
      if (!job) return false;
      // A worker rejected before lease acquisition cannot release another worker's job.
      if ((row.busyToken && row.busyToken !== token) ||
          (job.lease && job.lease !== token)) return false;
      const ownsJob = !!token && job.lease === token;
      if (!ownsJob && (!['queued', 'running'].includes(job.state) ||
          row.parsed.results.some(r => r.job_id === jobId && r.state === "in_progress")))
        return false;
      const cancelled = job.state === "cancelled";
      const result = row.parsed.results.find(
        (r) => r.job_id === jobId && r.user_id === selectedId,
      );
      if (scope && !sameWorker(row, scope)) {
        interruptQueue(row.parsed, job, "A conta ou sessão mudou durante a operação. Confira o último resultado no Telegram antes de repetir.", dispatchStarted);
        return false;
      }
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
        row.parsed.limits.not_before = Math.max(row.parsed.limits.not_before, Date.now() / 1000 + Math.max(0, safe.wait));
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
      return true;
    });
    console.info("[telegram] fila: ocorrência", { code: safe.code });
    return handled && safe.code === "privacy";
  } finally {
    if (driver) await driver.close();
    if (token) await release(userId, token);
  }
}
queueStep.maxRetries = 0;
