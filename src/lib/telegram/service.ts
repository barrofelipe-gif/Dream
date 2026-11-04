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
  isAdministrator,
  type Workspace,
} from "./store";
import {
  confirmed,
  contactUsable,
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
  type ChannelCreation,
  type ChannelTest,
  type ChannelSetup,
} from "./domain";
import { connectTelegramQR, runTelegramQueue } from "@/workflows/telegram";
import { normalizeProspect, recordProspectCheck, saveProspectRecord } from "./prospects";
import { recordCollection } from "./collection-history";
import {
  publicAccountRoster,
  addDraft,
  renameAccount as renameProfile,
  activateAccount,
  retainedSessionEncs,
  accountsLocked,
  activeProfileId,
} from "./accounts";
import { accountContext, assertRequestContext } from "./request-context";

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
type SessionUpdate = <T>(change: (current: Workspace) => T) => Promise<T>;
function connectionStamp(row: Workspace) {
  return {
    token: row.busyToken,
    until: row.busyUntil?.getTime() ?? null,
    attempt: row.authAttempt,
    state: row.authState,
    account: row.parsed.account?.id ?? null,
    credentials: row.credentialsEnc,
    session: row.sessionEnc,
    context: accountContext(row.parsed),
  };
}
function sameConnection(row: Workspace, stamp: ReturnType<typeof connectionStamp>) {
  const current = connectionStamp(row);
  return Object.keys(stamp).every(
    (key) => current[key as keyof typeof current] === stamp[key as keyof typeof stamp],
  ) && (stamp.until === null || stamp.until > Date.now());
}
async function clientFor<T>(
  userId: string,
  work: (driver: TelegramDriver, row: Workspace, update: SessionUpdate) => Promise<T>,
  required = true,
  persistSession = true,
) {
  const { token, row } = await lease(userId);
  let driver: TelegramDriver | undefined;
  let active = true;
  let stamp: ReturnType<typeof connectionStamp> = { ...connectionStamp(row), token };
  const update: SessionUpdate = async (change) => {
    let next = stamp;
    const result = await mutate(userId, (current) => {
      if (!active || !sameConnection(current, stamp))
        throw new TelegramError(
          "busy",
          "A conexão mudou ou a consulta terminou. Confira o estado antes de repetir.",
          0,
          409,
        );
      const value = change(current);
      next = connectionStamp(current);
      return value;
    });
    stamp = next;
    return result;
  };
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
    const result = await deadline(work(driver, row, update));
    if (persistSession) {
      const saved = driver.save();
      await update((current) => { current.sessionEnc = seal(saved); });
    }
    return result;
  } catch (error) {
    active = false;
    const safe = mapError(error);
    await mutate(userId, (current) => {
      if (sameConnection(current, stamp)) recordError(current, safe);
    });
    throw safe;
  } finally {
    active = false;
    if (driver) await driver.close();
    await release(userId, token);
  }
}
function channelSetup(row: Workspace): ChannelSetup {
  return row.parsed.channelSetup ??= { creations: [], tests: [], audit: [] };
}
function channelSetupSnapshot(row: Workspace) {
  const accountId = row.parsed.account?.id;
  const setup = row.parsed.channelSetup;
  const creations = setup?.creations.filter((item) => item.accountId === accountId) || [];
  const tests = setup?.tests.filter((item) => item.accountId === accountId) || [];
  function visible<T extends ChannelCreation | ChannelTest>(item: T | undefined): T | null {
    if (!item) return null;
    const active = setup?.activeRequest?.requestId === item.requestId &&
      setup.activeRequest.leaseToken === row.busyToken && !!row.busyUntil && row.busyUntil.getTime() > Date.now();
    return item.status === "pending" && !active
      ? { ...item, status: "uncertain", message: "A operação foi interrompida. Confira o canal no Telegram antes de tentar novamente." }
      : { ...item };
  }
  return {
    creation: visible(creations.at(-1)),
    test: visible(tests.at(-1)),
    channel: creations.findLast((item) => item.status === "confirmed")?.channel || null,
  };
}
function channelRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new TelegramError("input", "Identificador da solicitação inválido.");
  return value.toLowerCase();
}
function channelTitle(value: unknown): string {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(value))
    throw new TelegramError("input", "Informe um nome válido para o canal.");
  const title = value.trim();
  if (title.length < 3 || title.length > 128)
    throw new TelegramError("input", "Use entre 3 e 128 caracteres no nome do canal.");
  return title;
}
function channelUsername(value: unknown): string {
  if (typeof value !== "string" || !/^@?[A-Za-z][A-Za-z0-9_]{2,31}$/.test(value.trim()))
    throw new TelegramError("input", "Informe o @usuário público da conta de teste.");
  return value.trim().replace(/^@/, "").toLowerCase();
}
function channelAudit(row: Workspace, action: "create" | "test", record: ChannelCreation | ChannelTest) {
  channelSetup(row).audit.push({
    action, requestId: record.requestId, accountId: record.accountId,
    at: new Date().toISOString(), status: record.status,
    ...("targetId" in record ? { targetId: record.targetId } : record.channel ? { targetId: record.channel.id } : {}),
  });
}
function uncertainChannel(): never {
  throw new TelegramError("uncertain", "Já existe uma solicitação sem confirmação. Confira o canal no Telegram; a operação não será repetida automaticamente.", 0, 409);
}
function creationResult(record: ChannelCreation) {
  return { accountId: record.accountId, channelId: record.channel!.id, channel: record.channel!, privacy: record.privacy!, creation: structuredClone(record) };
}
function existingCreation(row: Workspace, requestId: string, title: string, accountId: number) {
  const creations = row.parsed.channelSetup?.creations || [];
  const prior = creations.find((item) => item.requestId === requestId);
  if (prior && (prior.accountId !== accountId || prior.title !== title))
    throw new TelegramError("input", "Esta solicitação pertence a outra conta ou nome de canal.", 0, 409);
  const record = prior || creations.findLast((item) => item.accountId === accountId && item.title === title && item.status !== "failed");
  if (!record) return;
  if (record.status === "confirmed" && record.channel && record.privacy) return creationResult(record);
  if (record.status === "failed")
    throw new TelegramError("input", record.message || "A solicitação falhou antes da criação. Inicie uma nova solicitação.", 0, 409);
  return uncertainChannel();
}
function ownedChannel(row: Workspace, targetId: number, accountId: number) {
  const created = row.parsed.channelSetup?.creations.findLast((item) =>
    item.accountId === accountId && item.status === "confirmed" && item.channel?.id === targetId,
  );
  if (!created?.channel?.owner || !created.channel.private || created.channel.kind !== "channel" ||
      !created.privacy?.owner || !created.privacy.private || created.privacy.kind !== "channel")
    throw new TelegramError("permission", "Escolha o canal privado criado e confirmado por esta conta neste painel.", 0, 403);
  return created.channel;
}
function existingChannelTest(row: Workspace, requestId: string, targetId: number, username: string, accountId: number) {
  const tests = row.parsed.channelSetup?.tests || [];
  const prior = tests.find((item) => item.requestId === requestId);
  if (prior && (prior.accountId !== accountId || prior.targetId !== targetId || prior.username !== username))
    throw new TelegramError("input", "Esta solicitação pertence a outra conta, canal ou usuário.", 0, 409);
  if (prior) {
    if (["added", "already", "privacy"].includes(prior.status))
      return { accountId, targetId, state: prior.status, user: prior.user, message: prior.message, test: structuredClone(prior) };
    if (prior.status === "failed")
      throw new TelegramError("input", prior.message || "A consulta falhou. Inicie uma nova solicitação.", 0, 409);
    return uncertainChannel();
  }
  if (tests.some((item) => item.accountId === accountId && item.targetId === targetId && item.username === username && ["pending", "uncertain"].includes(item.status)))
    return uncertainChannel();
}
async function channelDispatch(userId: string, update: SessionUpdate, accountId: number, action: "create" | "test", requestId: string) {
  if (!(await isAdministrator(userId)))
    throw new TelegramError("permission", "O operador não possui mais acesso de administrador.", 0, 403);
  await update((current) => {
    usable(current);
    idle(current.parsed);
    limits(current.parsed);
    if (originAccount(current) !== accountId)
      throw new TelegramError("busy", "A conta mudou. Nenhuma nova operação foi enviada.", 0, 409);
    const record = action === "create"
      ? channelSetup(current).creations.find((item) => item.requestId === requestId)
      : channelSetup(current).tests.find((item) => item.requestId === requestId);
    const active = channelSetup(current).activeRequest;
    if (!record || record.status !== "pending" || record.dispatchedAt ||
        active?.requestId !== requestId || active.leaseToken !== current.busyToken) return uncertainChannel();
    if ("targetId" in record) ownedChannel(current, record.targetId, accountId);
    record.dispatchedAt = new Date().toISOString();
    channelAudit(current, action, record);
  });
}
async function failChannelRequest(userId: string, requestId: string, action: "create" | "test", error: unknown) {
  const safe = mapError(error);
  await mutate(userId, (current) => {
    const record = action === "create"
      ? current.parsed.channelSetup?.creations.find((item) => item.requestId === requestId)
      : current.parsed.channelSetup?.tests.find((item) => item.requestId === requestId);
    if (!record || record.status !== "pending") return;
    record.status = record.dispatchedAt ? "uncertain" : "failed";
    record.finishedAt = new Date().toISOString();
    record.message = record.dispatchedAt
      ? "O Telegram pode ter concluído a operação, mas a confirmação não chegou. Confira o canal antes de continuar. Nenhuma tentativa será reenviada automaticamente."
      : safe.message;
    if (current.parsed.channelSetup?.activeRequest?.requestId === requestId)
      delete current.parsed.channelSetup.activeRequest;
    channelAudit(current, action, record);
  });
  throw safe;
}
export async function createChannel(userId: string, input: Record<string, unknown>) {
  const requestId = channelRequestId(input.requestId), title = channelTitle(input.title);
  const requested = await load(userId);
  usable(requested);
  const accountId = originAccount(requested);
  const existing = existingCreation(requested, requestId, title, accountId);
  if (existing) return existing;
  idle(requested.parsed);
  limits(requested.parsed);
  let started = false;
  try {
    return await clientFor(userId, async (driver, row, update) => {
      if (originAccount(row) !== accountId)
        throw new TelegramError("busy", "A conta mudou. Confira a conexão antes de criar o canal.", 0, 409);
      const repeated = existingCreation(row, requestId, title, accountId);
      if (repeated) return repeated;
      await update((current) => {
        idle(current.parsed);
        limits(current.parsed);
        const record: ChannelCreation = { requestId, title, accountId, status: "pending", startedAt: new Date().toISOString() };
        channelSetup(current).creations.push(record);
        channelSetup(current).activeRequest = { requestId, leaseToken: current.busyToken! };
        channelAudit(current, "create", record);
      });
      started = true;
      const result = await driver.createPrivateChannel(title, () => channelDispatch(userId, update, accountId, "create", requestId));
      if (result.channel.kind !== "channel" || !result.channel.owner || !result.channel.private ||
          result.privacy.kind !== "channel" || !result.privacy.owner || !result.privacy.private || result.privacy.group_id !== result.channel.id)
        throw new TelegramError("uncertain", "A criação ainda não confirmou um canal privado sob sua propriedade. Confira o Telegram.", 0, 409);
      return update((current) => {
        const record = channelSetup(current).creations.find((item) => item.requestId === requestId)!;
        if (record.status !== "pending" || !record.dispatchedAt) return uncertainChannel();
        record.status = "confirmed";
        record.finishedAt = new Date().toISOString();
        record.channel = result.channel;
        record.privacy = result.privacy;
        record.message = "Canal privado criado. Somente a conta criadora publica.";
        delete channelSetup(current).activeRequest;
        current.parsed.groups = [...current.parsed.groups.filter((group) => group.id !== result.channel.id), result.channel];
        current.parsed.targets = [...current.parsed.targets.filter((group) => group.id !== result.channel.id), result.channel];
        channelAudit(current, "create", record);
        return creationResult(record);
      });
    });
  } catch (error) {
    if (!started) throw mapError(error);
    return failChannelRequest(userId, requestId, "create", error);
  }
}
export async function testChannel(userId: string, input: Record<string, unknown>) {
  const requestId = channelRequestId(input.requestId), targetId = numeric(input.target_id), username = channelUsername(input.username);
  const requested = await load(userId);
  usable(requested);
  const accountId = originAccount(requested);
  ownedChannel(requested, targetId, accountId);
  const existing = existingChannelTest(requested, requestId, targetId, username, accountId);
  if (existing) return existing;
  idle(requested.parsed);
  limits(requested.parsed);
  let started = false;
  try {
    return await clientFor(userId, async (driver, row, update) => {
      if (originAccount(row) !== accountId)
        throw new TelegramError("busy", "A conta mudou. Confira o canal antes do teste.", 0, 409);
      ownedChannel(row, targetId, accountId);
      const repeated = existingChannelTest(row, requestId, targetId, username, accountId);
      if (repeated) return repeated;
      await update((current) => {
        idle(current.parsed);
        limits(current.parsed);
        ownedChannel(current, targetId, accountId);
        const record: ChannelTest = { requestId, targetId, username, accountId, status: "pending", startedAt: new Date().toISOString() };
        channelSetup(current).tests.push(record);
        channelSetup(current).activeRequest = { requestId, leaseToken: current.busyToken! };
        channelAudit(current, "test", record);
      });
      started = true;
      const result = await driver.testChannelAccount(targetId, username, () => channelDispatch(userId, update, accountId, "test", requestId));
      if (!["added", "already", "privacy"].includes(result.state))
        throw new TelegramError("uncertain", "A participação da conta ainda não foi confirmada. Confira no Telegram.", 0, 409);
      return update((current) => {
        ownedChannel(current, targetId, accountId);
        const record = channelSetup(current).tests.find((item) => item.requestId === requestId)!;
        if (record.status !== "pending") return uncertainChannel();
        if (result.state === "added" && !record.dispatchedAt) return uncertainChannel();
        record.status = result.state;
        record.finishedAt = new Date().toISOString();
        record.user = { id: result.user.id, name: result.user.name, username: result.user.username };
        record.message = result.message;
        delete channelSetup(current).activeRequest;
        channelAudit(current, "test", record);
        return { accountId, targetId, state: result.state, user: record.user, message: record.message, test: structuredClone(record) };
      });
    });
  } catch (error) {
    if (!started) throw mapError(error);
    return failChannelRequest(userId, requestId, "test", error);
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
            result.updated_at = Date.now() / 1000;
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
      accounts: publicAccountRoster(row),
      active_account_id: activeProfileId(data),
      context_id: accountContext(data),
      accounts_locked: accountsLocked(row),
      phone_hint: login?.phone ? "…" + login.phone.slice(-4) : "",
      credentials_saved: !!row.credentialsEnc,
      vault_error: false,
      retry_at: data.limits.not_before,
      configured: !!data.sources.length && !!data.targets.length,
      groups: data.groups,
      privacy: data.privacy || null,
      saved_setup: null,
      channel_setup: channelSetupSnapshot(row),
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
export async function addAccount(userId: string, input: Record<string, unknown>) {
  if (typeof input.label !== "string")
    throw new TelegramError("input", "Informe um nome para identificar a conta.");
  const label = input.label;
  return mutate(userId, (row) => {
    addDraft(row, label, { seal, secret });
    return { ok: true, id: activeProfileId(row.parsed), context_id: accountContext(row.parsed) };
  });
}
export async function switchAccount(userId: string, input: Record<string, unknown>) {
  if (typeof input.id !== "string" || !input.id || input.id.length > 100)
    throw new TelegramError("input", "Escolha uma conta salva neste painel.");
  const id = input.id;
  await mutate(userId, (row) => {
    activateAccount(row, id, { seal, secret });
  });
  return { ok: true };
}
export async function renameAccount(userId: string, input: Record<string, unknown>) {
  await mutate(userId, (row) => { renameProfile(row, input.id, input.label); });
  return { ok: true };
}
export async function begin(
  userId: string,
  input: Record<string, unknown>,
  qr: boolean,
) {
  const phone = typeof input.phone === "string" ? input.phone : "";
  if (!qr && !/^\+[1-9][0-9]{7,14}$/.test(phone))
    throw new TelegramError("input", "Informe o número com +, código do país, DDD e número.");
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
    row.sessionEnc = null;
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
  try {
    await clientFor(
      userId,
      async (driver, _row, update) => {
        if (await driver.client.checkAuthorization()) {
          await connected(userId, attempt, driver, update);
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
        await update((row) => {
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
  update: SessionUpdate,
) {
  let adopted = false;
  try {
    const account = await driver.me();
    await update((row) => {
      if (["code", "password", "qr"].includes(row.authState) &&
          (!row.authExpiresAt || row.authExpiresAt.getTime() < Date.now()))
        throw new TelegramError("cancelled", "A conexão expirou. Inicie novamente.", 0, 409);
      finishConnection(row, attempt, account, driver.save());
    });
    adopted = true;
  } finally {
    if (!adopted) await discardAuthorizedSession(userId, attempt, driver);
  }
}
async function discardAuthorizedSession(userId: string, attempt: string | null, driver: TelegramDriver) {
  try {
    const saved = driver.save();
    const retained = async () => {
      const current = await load(userId);
      // A pending old login stores its auth key before becoming authorized.
      return (secret<string>(current.sessionEnc) === saved &&
        (current.authState === "connected" || current.authAttempt !== attempt)) ||
        retainedSessionEncs(current, { seal, secret }).some((encrypted) => secret<string>(encrypted) === saved);
    };
    // Another attempt may already be using this exact MTProto session.
    if (await retained()) return;
    if (driver.client.connected === false) await deadline(driver.connect(false), 5000);
    if (await retained()) return;
    await deadline(driver.client.logOut(), 5000);
  } catch (error) {
    console.warn("[telegram] sessão descartada: limpeza não confirmada", { code: mapError(error).code });
  }
}
export async function restore(userId: string) {
  const row = await load(userId);
  idle(row.parsed);
  await clientFor(
    userId,
    async (driver, _leased, update) => {
      if (!(await driver.client.checkAuthorization()))
        throw new TelegramError(
          "auth_required",
          "A sessão salva expirou. Conecte novamente por QR Code.",
          0,
          409,
        );
      await connected(userId, row.authAttempt, driver, update);
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
    async (driver, _row, update) => {
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
        await connected(userId, attempt, driver, update);
      } catch (error) {
        const safe = mapError(error);
        if (safe.code !== "password_required") throw safe;
        await update((current) => {
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
  await clientFor(userId, async (driver, _leased, update) => {
    await driver.client.logOut();
    await update((current) => {
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
      current.parsed.discovery = undefined;
      current.parsed.authorizedIds = [];
      for (const contact of current.parsed.contacts) contact.selected = false;
    });
  }, true, false);
  return { ok: true };
}
export async function groups(userId: string) {
  return clientFor(userId, async (driver, row, update) => {
    idle(row.parsed);
    const result = await driver.groups();
    await update((current) => {
      current.parsed.groups = result;
    });
    return { groups: result };
  });
}
export async function discover(userId: string, input: Record<string, unknown>) {
  const query = groupSearch(input.query);
  return clientFor(userId, async (driver, row, update) => {
    idle(row.parsed);
    limits(row.parsed);
    const groups = await driver.searchGroups(query, input.include_channels === true);
    await update(current => { current.parsed.discovery = { groups, query: query.text, at: Date.now() }; });
    return { query: query.text, groups };
  });
}
function originFrom(row: Workspace, id: number) {
  const origin = row.parsed.prospects?.find((group) => group.id === id) ||
    row.parsed.discovery?.groups.find((group) => group.id === id);
  if (!origin)
    throw new TelegramError("input", "Escolha um público descoberto ou salvo nesta conta.", 0, 404);
  if (origin.kind === "channel")
    throw new TelegramError("origin_kind", "Este público é um canal. A coleta atual aceita somente grupos e supergrupos.", 0, 409);
  if (typeof origin.username !== "string" || !/^[A-Za-z0-9_]{3,32}$/.test(origin.username))
    throw new TelegramError("input", "Pesquise novamente para confirmar o grupo público.");
  return origin;
}
function originAccount(row: Workspace) {
  const accountId = row.parsed.account?.id;
  if (typeof accountId !== "number" || !Number.isSafeInteger(accountId) || accountId <= 0)
    throw new TelegramError("auth_required", "Reconecte sua conta Telegram antes de preparar uma origem.", 0, 409);
  return accountId;
}
export async function prepareOrigin(userId: string, input: Record<string, unknown>) {
  const id = numeric(input.id);
  const workspace = await load(userId);
  idle(workspace.parsed);
  limits(workspace.parsed);
  const requestedAccount = originAccount(workspace);
  originFrom(workspace, id);
  return clientFor(userId, async (driver, row, update) => {
    idle(row.parsed);
    limits(row.parsed);
    const accountId = originAccount(row);
    if (accountId !== requestedAccount)
      throw new TelegramError("busy", "A conta Telegram mudou. Prepare a origem novamente pela conta atual.", 0, 409);
    const origin = originFrom(row, id);
    const source = await driver.prepareOrigin(origin.username, id, () => update((current) => {
      idle(current.parsed);
      limits(current.parsed);
      originFrom(current, id);
    }));
    if (source.id !== id)
      throw new TelegramError("group_identity", "O Telegram retornou uma origem diferente da solicitada.");
    const listed = await driver.groups();
    // Self-membership was confirmed even if getDialogs has not refreshed yet.
    const groups = listed.some((group) => group.id === id) ? listed : [...listed, source];
    await update((current) => {
      idle(current.parsed);
      limits(current.parsed);
      originFrom(current, id);
      current.parsed.groups = groups;
    });
    return { accountId, source: groups.find((group) => group.id === id)!, groups };
  });
}
export async function saveProspect(userId: string, input: Record<string, unknown>) {
  const id = numeric(input.id);
  return mutate(userId, row => {
    const saved = row.parsed.prospects || [];
    if (input.remove === true) {
      row.parsed.prospects = saved.filter(p => p.id !== id);
      return { ok: true };
    }
    const found = row.parsed.discovery;
    const group = found?.groups.find(g => g.id === id);
    if (!group || !found || Date.now() - found.at > 86400000) throw new TelegramError("input", "Pesquise novamente para salvar este público.");
    row.parsed.prospects = saveProspectRecord(saved, group, found.query, found.at);
    return { ok: true };
  });
}
export async function refreshProspect(userId: string, input: Record<string, unknown>) {
  const id = numeric(input.id);
  const workspace = await load(userId);
  idle(workspace.parsed);
  limits(workspace.parsed);
  const prospect = normalizeProspect(workspace.parsed.prospects?.find(p => p.id === id));
  if (!prospect) throw new TelegramError("input", "Salve o público antes de consultar novamente.", 0, 404);
  return clientFor(userId, async (driver, row, update) => {
    idle(row.parsed);
    limits(row.parsed);
    let live: Awaited<ReturnType<typeof driver.inspectPublicGroup>> | undefined;
    let failure: TelegramError | undefined;
    try {
      live = await driver.inspectPublicGroup(prospect.username, prospect.id);
    } catch (error) {
      failure = mapError(error);
    }
    await update(current => {
      // Uma remoção feita durante a consulta não pode ressuscitar o público.
      if (!current.parsed.prospects?.some(p => p.id === id))
        throw new TelegramError("input", "Este público não está mais na lista monitorada.", 0, 404);
      current.parsed.prospects = recordProspectCheck(current.parsed.prospects, id, live, failure?.message);
    });
    if (failure && ["auth_required", "flood_wait", "restricted"].includes(failure.code)) throw failure;
    return { checked: failure ? 0 : 1, failed: failure ? 1 : 0 };
  });
}
export async function privacy(
  userId: string,
  groupId: unknown,
  protect = false,
) {
  const id = numeric(groupId);
  return clientFor(userId, async (driver, row, update) => {
    idle(row.parsed);
    if (!row.parsed.groups.some((g) => g.id === id))
      throw new TelegramError(
        "permission",
        "Escolha um dos grupos da sua conta.",
      );
    const result = await (protect ? driver.protect(id) : driver.privacy(id));
    await update((current) => {
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
  await clientFor(userId, async (driver, row, update) => {
    idle(row.parsed);
    const groups = await driver.groups();
    const s = groups.find((g) => g.id === source),
      t = groups.find((g) => g.id === target);
    if (s?.kind === "channel")
      throw new TelegramError("origin_kind", "Canais não podem ser usados como origem da coleta. Escolha um grupo ou supergrupo.", 0, 409);
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
    await update((current) => {
      idle(current.parsed);
      current.parsed.sources = [s];
      current.parsed.targets = [t];
      current.parsed.privacy = p;
    });
  });
  return { ok: true };
}
export async function collect(userId: string, input: Record<string, unknown>) {
  return clientFor(userId, async (driver, row, update) => {
    idle(row.parsed);
    limits(row.parsed);
    const ids = pair(row.parsed, input.source_id, input.target_id);
    const people = await driver.collect(ids.sourceId, ids.targetId);
    const run = await update((current) => {
      return recordCollection(current.parsed, ids.sourceId, ids.targetId, people);
    });
    return { received: run.received, newContacts: run.newContacts, collectedAt: run.collectedAt };
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
      if (input.selected && !contactUsable(data, person))
        throw new TelegramError("contact_stale", "Consulte novamente os participantes com a conta atual antes de selecionar.", 0, 409);
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
          person.selected = contactUsable(data, person) && !confirmed(data, person.user_id, targetId);
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
  if (!results) assertRequestContext(data);
  const rows: unknown[][] = results
    ? [
        ["operacao", "participante_id", "nome", "estado", "detalhes", "atualizado_em"],
        ...data.results.map((r) => [
          r.job_id,
          r.user_id,
          r.name,
          r.state,
          r.message,
          r.updated_at > 0 ? new Date(r.updated_at * 1000).toISOString() : "",
        ]),
      ]
    : [
        ["participante_id", "nome", "usuario", "origem", "selecionado", "primeira_coleta_em", "ultima_coleta_em"],
        ...data.contacts.map((p) => [
          p.user_id,
          p.name,
          p.username,
          p.source_id,
          p.selected ? "sim" : "não",
          p.firstCollectedAt || "",
          p.lastCollectedAt || "",
        ]),
      ];
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
}
