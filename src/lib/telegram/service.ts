import "server-only";
import { randomUUID } from "node:crypto";
import { Api } from "teleproto";
import { start } from "workflow/api";
import { csrf } from "./access";
import {
  TelegramDriver,
  credentials,
  deadline,
  mapError,
  type Credentials,
} from "./driver";
import {
  load,
  mutate,
  lease,
  release,
  seal,
  secret,
  notBusy,
  finishConnection,
  type Workspace,
} from "./store";
import {
  confirmed,
  csvCell,
  enqueue,
  idle,
  limits,
  numeric,
  pair,
  publicSnapshot,
  recount,
  TelegramError,
  groupSearch,
} from "./domain";
import { connectTelegramQR, runTelegramQueue } from "@/workflows/telegram";

export type Login = {
  phone?: string;
  phone_code_hash?: string;
  image?: string;
  expires_at?: number;
  error?: string;
};
function credentialFor(
  row: Workspace,
  input: Record<string, unknown>,
): Credentials {
  if (input.use_saved === true || input.use_pending === true) {
    const stored = secret<Credentials>(row.credentialsEnc);
    if (stored) return stored;
  }
  return credentials(input);
}
function usable(row: Workspace) {
  if (row.authState !== "connected" || !row.sessionEnc || !row.credentialsEnc)
    throw new TelegramError(
      "auth_required",
      "Conecte sua conta Telegram primeiro.",
      0,
      409,
    );
}
function recordError(row: Workspace, error: TelegramError) {
  row.parsed.error = error.message;
  if (error.code === "flood_wait")
    row.parsed.limits.not_before = Date.now() / 1000 + error.wait;
  if (error.code === "restricted") row.parsed.limits.restricted = true;
  if (error.code === "auth_required") {
    row.authState = "disconnected";
    row.sessionEnc = null;
    row.loginEnc = null;
    row.authAttempt = null;
    row.authExpiresAt = null;
  }
}
async function clientFor<T>(
  userId: string,
  work: (driver: TelegramDriver, row: Workspace) => Promise<T>,
  required = true,
) {
  const { token, row } = await lease(userId);
  let driver: TelegramDriver | undefined;
  try {
    if (required) usable(row);
    const key = secret<Credentials>(row.credentialsEnc);
    if (!key)
      throw new TelegramError(
        "credentials",
        "Cadastre as chaves do aplicativo Telegram.",
      );
    driver = new TelegramDriver(key, secret<string>(row.sessionEnc) || "");
    await driver.connect(required);
    const result = await deadline(work(driver, row));
    const saved = driver.save();
    await mutate(userId, (current) => {
      if (
        current.busyToken !== token ||
        current.authAttempt !== row.authAttempt
      )
        throw new TelegramError(
          "busy",
          "A conexão mudou. Confira o estado antes de repetir.",
          0,
          409,
        );
      current.sessionEnc = seal(saved);
    });
    return result;
  } catch (error) {
    const safe = mapError(error);
    await mutate(userId, (current) => recordError(current, safe));
    throw safe;
  } finally {
    if (driver) await driver.close();
    await release(userId, token);
  }
}
export async function state(userId: string) {
  await mutate(userId, (row) => {
    if (
      row.authExpiresAt &&
      row.authExpiresAt.getTime() < Date.now() &&
      ["qr", "code", "password"].includes(row.authState)
    ) {
      row.authState = "qr_error";
      row.loginEnc = seal({
        error: "O prazo da conexão terminou. Gere outro QR Code ou reconecte.",
      });
      if (!row.busyUntil || row.busyUntil.getTime() < Date.now()) {
        row.busyToken = null;
        row.busyUntil = null;
      }
    }
    // Um passo interrompido nunca é reenviado automaticamente.
    for (const job of row.parsed.jobs)
      if (
        job.lease_until &&
        job.lease_until < Date.now() / 1000 &&
        row.parsed.results.some(
          (r) => r.job_id === job.id && r.state === "in_progress",
        )
      ) {
        for (const result of row.parsed.results)
          if (result.job_id === job.id && result.state === "in_progress") {
            result.state = "uncertain";
            result.message =
              "Processamento interrompido. Confira no Telegram antes de repetir.";
          }
        job.state = "interrupted";
        job.message =
          "Operação interrompida. Nenhum convite foi reenviado automaticamente.";
        recount(row.parsed, job);
      }
  });
  const row = await load(userId),
    data = row.parsed,
    login = secret<Login>(row.loginEnc);
  return {
    csrf_token: csrf(userId),
    mode: "live",
    sources: data.sources,
    targets: data.targets,
    ...publicSnapshot(data),
    connection: {
      enabled: true,
      state: row.authState,
      account: data.account || null,
      phone_hint: login?.phone ? "…" + login.phone.slice(-4) : "",
      credentials_saved: !!row.credentialsEnc,
      vault_error: false,
      retry_at: data.limits.not_before,
      configured: !!data.sources.length && !!data.targets.length,
      groups: data.groups,
      privacy: data.privacy || null,
      saved_setup: null,
      qr:
        row.authState === "qr" && login?.image
          ? {
              state: "waiting",
              image: login.image,
              expires_at: login.expires_at,
            }
          : null,
      qr_error: login?.error || data.error || "",
    },
  };
}
export async function begin(
  userId: string,
  input: Record<string, unknown>,
  qr: boolean,
) {
  const attempt = randomUUID();
  await mutate(userId, (row) => {
    idle(row.parsed);
    limits(row.parsed);
    notBusy(row);
    if (!["disconnected", "qr_error", "saved"].includes(row.authState))
      throw new TelegramError(
        "busy",
        "Conclua ou cancele a conexão atual.",
        0,
        409,
      );
    row.credentialsEnc = seal(credentialFor(row, input));
    row.authAttempt = attempt;
    row.authExpiresAt = new Date(Date.now() + 250000);
    row.authState = qr ? "qr" : "code";
    row.loginEnc = null;
    row.parsed.error = undefined;
  });
  if (qr) {
    try {
      await start(connectTelegramQR, [userId, attempt]);
    } catch {
      await mutate(userId, (row) => {
        if (row.authAttempt === attempt) {
          row.authState = "qr_error";
          row.loginEnc = seal({
            error: "Não foi possível iniciar o QR Code. Tente novamente.",
          });
        }
      });
      throw new TelegramError(
        "workflow",
        "Não foi possível iniciar a conexão por QR Code.",
        0,
        503,
      );
    }
    return { ok: true };
  }
  const phone = input.phone;
  if (typeof phone !== "string" || !/^\+[1-9][0-9]{7,14}$/.test(phone)) {
    await cancel(userId);
    throw new TelegramError(
      "input",
      "Informe o número com +, código do país, DDD e número.",
    );
  }
  try {
    await clientFor(
      userId,
      async (driver) => {
        if (await driver.client.checkAuthorization()) {
          await connected(userId, attempt, driver);
          return;
        }
        const key = driver.credentials;
        const sent = await driver.client.invoke(
          new Api.auth.SendCode({
            phoneNumber: phone,
            apiId: key.apiId,
            apiHash: key.apiHash,
            settings: new Api.CodeSettings({}),
          }),
        );
        if (!(sent instanceof Api.auth.SentCode))
          throw new TelegramError(
            "login",
            "Confira a conexão pelo Telegram oficial antes de tentar novamente.",
          );
        await mutate(userId, (row) => {
          if (row.authAttempt !== attempt)
            throw new TelegramError("cancelled", "Conexão cancelada.");
          row.authState = "code";
          row.loginEnc = seal({ phone, phone_code_hash: sent.phoneCodeHash });
          row.authExpiresAt = new Date(Date.now() + 600000);
        });
      },
      false,
    );
    return { ok: true };
  } catch (error) {
    await mutate(userId, (row) => {
      if (
        row.authAttempt === attempt &&
        row.authState === "code" &&
        !row.loginEnc
      )
        row.authState = "disconnected";
    });
    throw error;
  }
}
export async function connected(
  userId: string,
  attempt: string | null,
  driver: TelegramDriver,
) {
  const account = await driver.me();
  await mutate(userId, (row) =>
    finishConnection(row, attempt, account, driver.save()),
  );
}
export async function restore(userId: string) {
  const row = await load(userId);
  idle(row.parsed);
  await clientFor(
    userId,
    async (driver) => {
      if (!(await driver.client.checkAuthorization()))
        throw new TelegramError(
          "auth_required",
          "A sessão salva expirou. Conecte novamente por QR Code.",
          0,
          409,
        );
      await connected(userId, row.authAttempt, driver);
    },
    false,
  );
  return { ok: true };
}
export async function verify(
  userId: string,
  input: Record<string, unknown>,
  password: boolean,
) {
  const row = await load(userId),
    expected = password ? "password" : "code";
  if (
    row.authState !== expected ||
    !row.authExpiresAt ||
    row.authExpiresAt.getTime() < Date.now()
  )
    throw new TelegramError(
      "login",
      "A conexão expirou ou não está nesta etapa. Cancele e inicie novamente.",
    );
  const value = input[password ? "password" : "code"];
  if (
    typeof value !== "string" ||
    !value ||
    value.length > (password ? 256 : 10) ||
    (!password && !/^\d{4,10}$/.test(value))
  )
    throw new TelegramError(
      "input",
      password
        ? "Preencha sua senha de duas etapas."
        : "Preencha o código recebido no Telegram.",
    );
  const attempt = row.authAttempt,
    login = secret<Login>(row.loginEnc);
  await clientFor(
    userId,
    async (driver) => {
      try {
        if (password)
          await driver.client.signInWithPassword(driver.credentials, {
            password: async () => value,
            onError: async (error) => {
              throw error;
            },
          });
        else {
          if (!login?.phone || !login.phone_code_hash)
            throw new TelegramError("login", "Inicie a conexão novamente.");
          const result = await driver.client.invoke(
            new Api.auth.SignIn({
              phoneNumber: login.phone,
              phoneCodeHash: login.phone_code_hash,
              phoneCode: value,
            }),
          );
          if (!(result instanceof Api.auth.Authorization))
            throw new TelegramError(
              "login",
              "Use uma conta Telegram já existente.",
            );
        }
        await connected(userId, attempt, driver);
      } catch (error) {
        const safe = mapError(error);
        if (safe.code !== "password_required") throw safe;
        await mutate(userId, (current) => {
          if (current.authAttempt === attempt) {
            current.authState = "password";
            current.sessionEnc = seal(driver.save());
            current.loginEnc = null;
            current.authExpiresAt = new Date(Date.now() + 600000);
          }
        });
      }
    },
    false,
  );
  return { ok: true };
}
export async function cancel(userId: string) {
  await mutate(userId, (row) => {
    if (row.authState === "connected")
      throw new TelegramError(
        "login",
        "Use Desconectar para encerrar uma conta conectada.",
      );
    row.authAttempt = null;
    row.authState = "disconnected";
    row.loginEnc = null;
    row.sessionEnc = null;
    row.authExpiresAt = null;
  });
  return { ok: true };
}
export async function disconnect(userId: string) {
  const row = await load(userId);
  idle(row.parsed);
  await clientFor(userId, async (driver) => {
    await driver.client.logOut();
  });
  await mutate(userId, (current) => {
    current.authState = "disconnected";
    current.authAttempt = null;
    current.authExpiresAt = null;
    current.sessionEnc = null;
    current.loginEnc = null;
    current.parsed.groups = [];
    current.parsed.sources = [];
    current.parsed.targets = [];
    current.parsed.account = undefined;
    current.parsed.privacy = undefined;
  });
  return { ok: true };
}
export async function groups(userId: string) {
  return clientFor(userId, async (driver, row) => {
    idle(row.parsed);
    const result = await driver.groups();
    await mutate(userId, (current) => {
      current.parsed.groups = result;
    });
    return { groups: result };
  });
}
export async function discover(userId: string, input: Record<string, unknown>) {
  const query = groupSearch(input.query);
  return clientFor(userId, async (driver, row) => {
    idle(row.parsed);
    limits(row.parsed);
    return { query: query.text, groups: await driver.searchGroups(query) };
  });
}
export async function privacy(
  userId: string,
  groupId: unknown,
  protect = false,
) {
  const id = numeric(groupId);
  return clientFor(userId, async (driver, row) => {
    idle(row.parsed);
    if (!row.parsed.groups.some((g) => g.id === id))
      throw new TelegramError(
        "permission",
        "Escolha um dos grupos da sua conta.",
      );
    const result = await (protect ? driver.protect(id) : driver.privacy(id));
    await mutate(userId, (current) => {
      current.parsed.privacy = result;
      for (const group of current.parsed.groups)
        if (group.id === id) group.private = result.private;
    });
    return result;
  });
}
export async function configure(
  userId: string,
  input: Record<string, unknown>,
) {
  const source = numeric(input.source_id),
    target = numeric(input.target_id);
  if (source === target)
    throw new TelegramError(
      "input",
      "Escolha uma origem diferente do destino.",
    );
  idle((await load(userId)).parsed);
  await clientFor(userId, async (driver, row) => {
    idle(row.parsed);
    const groups = await driver.groups();
    const s = groups.find((g) => g.id === source),
      t = groups.find((g) => g.id === target);
    if (!s || !t || !t.can_invite)
      throw new TelegramError(
        "permission",
        "Confira os grupos e a permissão de convidar no destino.",
      );
    const p = await driver.privacy(target);
    if (!p.private)
      throw new TelegramError(
        "permission",
        "A comunidade de destino precisa ser privada.",
      );
    await mutate(userId, (current) => {
      idle(current.parsed);
      current.parsed.sources = [s];
      current.parsed.targets = [t];
      current.parsed.privacy = p;
    });
  });
  return { ok: true };
}
export async function collect(userId: string, input: Record<string, unknown>) {
  return clientFor(userId, async (driver, row) => {
    idle(row.parsed);
    limits(row.parsed);
    const ids = pair(row.parsed, input.source_id, input.target_id);
    const people = await driver.collect(ids.sourceId, ids.targetId);
    await mutate(userId, (current) => {
      for (const p of people) {
        const old = current.parsed.contacts.find(
          (c) => c.user_id === p.user_id && c.source_id === ids.sourceId,
        );
        if (old) Object.assign(old, p);
        else
          current.parsed.contacts.push({
            ...p,
            source_id: ids.sourceId,
            selected: false,
          });
      }
    });
    return { received: people.length };
  });
}
export async function localAction(
  userId: string,
  path: string,
  input: Record<string, unknown>,
) {
  return mutate(userId, (row) => {
    const data = row.parsed;
    usable(row);
    if (path === "/selection") {
      idle(data);
      const uid = numeric(input.user_id, true),
        source = numeric(input.source_id);
      if (typeof input.selected !== "boolean")
        throw new TelegramError("input", "Seleção inválida.");
      const person = data.contacts.find(
        (p) => p.user_id === uid && p.source_id === source,
      );
      if (!person)
        throw new TelegramError(
          "input",
          "Consulte a origem antes de selecionar.",
        );
      person.selected = input.selected;
      return { ok: true };
    }
    if (path === "/selection/bulk") {
      idle(data);
      const { sourceId, targetId } = pair(
        data,
        input.source_id,
        input.target_id,
      );
      let count = 0;
      for (const person of data.contacts)
        if (person.source_id === sourceId) {
          person.selected = !confirmed(data, person.user_id, targetId);
          if (person.selected) count++;
        }
      return { selected: count };
    }
    throw new TelegramError("input", "Operação desconhecida.");
  });
}
export async function createJob(
  userId: string,
  input: Record<string, unknown>,
) {
  const job = await mutate(userId, (row) => {
    usable(row);
    notBusy(row);
    return enqueue(
      row.parsed,
      input.source_id,
      input.target_id,
      input.user_ids,
    );
  });
  try {
    await start(runTelegramQueue, [userId, job.id]);
  } catch {
    await mutate(userId, (row) => {
      const current = row.parsed.jobs.find((j) => j.id === job.id)!;
      current.state = "failed";
      current.message =
        "Não foi possível iniciar a fila. Nenhum convite foi enviado.";
    });
    throw new TelegramError(
      "workflow",
      "Não foi possível iniciar a fila.",
      0,
      503,
    );
  }
  return job;
}
export async function control(userId: string, input: Record<string, unknown>) {
  const result = await mutate(userId, (row) => {
    const j = row.parsed.jobs.find((j) => j.id === input.job_id);
    if (!j) throw new TelegramError("input", "Operação não encontrada.");
    if (
      input.action === "cancel" &&
      ["queued", "running", "paused", "paused_restriction"].includes(j.state)
    ) {
      j.state = "cancelled";
      j.message = "Cancelado. Uma chamada em andamento ainda pode terminar.";
    } else if (
      input.action === "pause" &&
      ["queued", "running"].includes(j.state)
    ) {
      j.state = "paused";
      j.message = "Pausado após a chamada em andamento.";
    } else if (
      input.action === "resume" &&
      ["paused", "paused_restriction"].includes(j.state)
    ) {
      limits(row.parsed);
      j.state = "running";
      j.message = "Retomado para os participantes restantes.";
    } else throw new TelegramError("input", "Ação indisponível neste estado.");
    return structuredClone(j);
  });
  if (input.action === "resume") {
    try {
      await start(runTelegramQueue, [userId, result.id]);
    } catch {
      await mutate(userId, (row) => {
        const job = row.parsed.jobs.find((j) => j.id === result.id);
        if (job?.state === "running" && !job.lease) {
          job.state = "paused";
          job.message =
            "Não foi possível retomar. A fila está pausada; tente novamente.";
        }
      });
      throw new TelegramError(
        "workflow",
        "Não foi possível retomar a fila. Confira o estado antes de tentar novamente.",
        0,
        503,
      );
    }
  }
  return result;
}
export async function csv(userId: string, results: boolean) {
  const row = await load(userId),
    data = row.parsed;
  const rows: unknown[][] = results
    ? [
        ["operacao", "participante_id", "nome", "estado", "detalhes"],
        ...data.results.map((r) => [
          r.job_id,
          r.user_id,
          r.name,
          r.state,
          r.message,
        ]),
      ]
    : [
        ["participante_id", "nome", "usuario", "origem", "selecionado"],
        ...data.contacts.map((p) => [
          p.user_id,
          p.name,
          p.username,
          p.source_id,
          p.selected ? "sim" : "não",
        ]),
      ];
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
}
