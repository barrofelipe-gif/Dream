import { randomUUID } from "node:crypto";
import { activeStates, TelegramError, type Data, type Contact, type Group, type Privacy } from "./domain";

type Account = NonNullable<Data["account"]>;
export type ContactMetadata = Pick<Contact, "user_id" | "source_id" | "firstCollectedAt" | "lastCollectedAt" | "accountId">;
export type AccountProfile = {
  id: string;
  label: string;
  account?: Account;
  contextEnc?: string;
  limits?: Data["limits"];
};
export type Accounts = { activeId: string; generation: number; profiles: AccountProfile[] };
export type AccountWorkspace = {
  parsed: Data;
  credentialsEnc: string | null;
  sessionEnc: string | null;
  loginEnc: string | null;
  authState: string;
  authAttempt: string | null;
  authExpiresAt: Date | null;
  busyToken: string | null;
  busyUntil: Date | null;
};
export type AccountCodec = {
  seal(value: unknown): string;
  secret<T>(value: string | null): T | undefined;
};
type PrivateContext = {
  version: 1;
  account: Account;
  credentialsEnc: string;
  sessionEnc: string;
  authState: "connected" | "saved";
  sources: Group[];
  targets: Group[];
  groups: Group[];
  contacts: Contact[];
  privacy?: Privacy;
  discovery?: Data["discovery"];
  limits: Data["limits"];
  authorizedIds: number[];
  authorizations: Data["authorizations"];
  error?: string;
};

export function activeProfileId(data: Data): string {
  return data.accounts?.activeId || "primary";
}
function profiles(row: AccountWorkspace): AccountProfile[] {
  return row.parsed.accounts?.profiles || [{ id: "primary", label: row.parsed.account?.name || "Conta principal", ...(row.parsed.account ? { account: row.parsed.account } : {}) }];
}
function registry(row: AccountWorkspace): Accounts {
  if (!row.parsed.accounts) row.parsed.accounts = { activeId: "primary", generation: 0, profiles: structuredClone(profiles(row)) };
  const value = row.parsed.accounts;
  if (!Number.isSafeInteger(value.generation) || value.generation < 0 || !value.profiles.some((p) => p.id === value.activeId))
    throw new TelegramError("account_vault", "Não foi possível conferir as contas salvas.", 0, 409);
  return value;
}
function advance(row: AccountWorkspace) {
  const value = registry(row);
  if (value.generation >= Number.MAX_SAFE_INTEGER) throw new TelegramError("account_vault", "Atualize as contas salvas.", 0, 409);
  value.generation++;
}
export function publicAccountRoster(row: AccountWorkspace) {
  return profiles(row).map((profile) => {
    const active = profile.id === activeProfileId(row.parsed);
    return {
      id: profile.id, label: profile.label,
      account: structuredClone((active ? row.parsed.account : profile.account) || profile.account || null),
      state: active ? row.authState : profile.contextEnc ? "saved" : "disconnected",
      active,
    };
  });
}
export function accountsLocked(row: AccountWorkspace): boolean {
  const now = Date.now();
  return ["qr", "code", "password"].includes(row.authState) ||
    !!(row.busyToken && row.busyUntil && row.busyUntil.getTime() > now) ||
    row.parsed.jobs.some((job) => activeStates.includes(job.state) || !!(job.lease && (job.lease_until || 0) * 1000 > now));
}
function requireIdle(row: AccountWorkspace) {
  if (accountsLocked(row)) throw new TelegramError("busy", "Conclua ou cancele a operação atual antes de trocar de conta.", 0, 409);
}

/** Global collection metadata contains no access hashes or account session material. */
export function collectionContactMetadata(data: Data): ContactMetadata[] {
  const rows = new Map<string, ContactMetadata>();
  for (const contact of [...(data.collectionContacts || []), ...data.contacts]) {
    if (!Number.isSafeInteger(contact.user_id) || contact.user_id <= 0 || !Number.isSafeInteger(contact.source_id) || contact.source_id >= 0) continue;
    const accountId = typeof contact.accountId === "number" && Number.isSafeInteger(contact.accountId) && contact.accountId > 0 ? contact.accountId : undefined;
    const key = `${accountId ?? "unknown"}:${contact.source_id}:${contact.user_id}`;
    const prior = rows.get(key);
    const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
    const first = date(contact.firstCollectedAt), last = date(contact.lastCollectedAt);
    const firstCollectedAt = prior ? prior.firstCollectedAt && first ? [prior.firstCollectedAt, first].sort()[0] : undefined : first;
    const lastCollectedAt = [prior?.lastCollectedAt, last].filter((at): at is string => !!at).sort().at(-1);
    rows.set(key, { user_id: contact.user_id, source_id: contact.source_id,
      ...(accountId ? { accountId } : {}), ...(firstCollectedAt ? { firstCollectedAt } : {}), ...(lastCollectedAt ? { lastCollectedAt } : {}) });
  }
  return [...rows.values()];
}
export function rememberContactMetadata(data: Data) {
  data.collectionContacts = collectionContactMetadata(data);
}

function privateContext(row: AccountWorkspace): PrivateContext {
  const data = row.parsed;
  if (!data.account || !row.sessionEnc || !row.credentialsEnc || !["connected", "saved"].includes(row.authState))
    throw new TelegramError("auth_required", "Confirme a sessão atual antes de adicionar outra conta.", 0, 409);
  return structuredClone({ version: 1, account: data.account,
    credentialsEnc: row.credentialsEnc, sessionEnc: row.sessionEnc,
    authState: row.authState as "connected" | "saved", sources: data.sources, targets: data.targets,
    groups: data.groups, contacts: data.contacts, privacy: data.privacy, discovery: data.discovery,
    limits: data.limits, authorizedIds: data.authorizedIds, authorizations: data.authorizations, error: data.error });
}
function openContext(profile: AccountProfile, codec: AccountCodec): PrivateContext {
  try {
    const context = codec.secret<PrivateContext>(profile.contextEnc || null);
    if (!context || context.version !== 1 || !context.account || context.account.id !== profile.account?.id ||
        !context.credentialsEnc || !context.sessionEnc || !["connected", "saved"].includes(context.authState) ||
        ![context.sources, context.targets, context.groups, context.contacts, context.authorizedIds, context.authorizations].every(Array.isArray) || !context.limits)
      throw new Error("Invalid account snapshot");
    return context;
  } catch {
    throw new TelegramError("account_vault", "Não foi possível abrir esta conta salva. As outras contas foram preservadas.", 0, 409);
  }
}
function park(row: AccountWorkspace, codec: AccountCodec) {
  rememberContactMetadata(row.parsed);
  const current = registry(row).profiles.find((profile) => profile.id === activeProfileId(row.parsed))!;
  current.limits = structuredClone(row.parsed.limits);
  if (["connected", "saved"].includes(row.authState) && row.parsed.account && row.sessionEnc && row.credentialsEnc) {
    current.account = structuredClone(row.parsed.account);
    current.contextEnc = codec.seal(privateContext(row));
  } else if (row.sessionEnc) {
    throw new TelegramError("busy", "Conclua ou cancele a conexão atual antes de trocar de conta.", 0, 409);
  }
}
function empty(row: AccountWorkspace, credentialsEnc: string | null, profile: AccountProfile) {
  row.credentialsEnc = credentialsEnc;
  row.sessionEnc = null;
  row.loginEnc = null;
  row.authState = "disconnected";
  row.authAttempt = null;
  row.authExpiresAt = null;
  Object.assign(row.parsed, { account: profile.account ? structuredClone(profile.account) : undefined,
    sources: [], targets: [], groups: [], contacts: [], privacy: undefined, discovery: undefined,
    authorizedIds: [], authorizations: [], error: undefined,
    limits: structuredClone(profile.limits || { restricted: false, not_before: 0 }) });
}
export function addDraft(row: AccountWorkspace, label: unknown, codec: AccountCodec) {
  requireIdle(row);
  if (typeof label !== "string" || !label.trim() || label.trim().length > 60 || /[\x00-\x1f\x7f]/.test(label))
    throw new TelegramError("input", "Dê um nome de até 60 caracteres para a conta.");
  const credentialsEnc = row.credentialsEnc;
  park(row, codec);
  const profile: AccountProfile = { id: randomUUID(), label: label.trim() };
  const value = registry(row);
  value.profiles.push(profile);
  value.activeId = profile.id;
  empty(row, credentialsEnc, profile);
  advance(row);
  return publicAccountRoster(row).find((entry) => entry.active)!;
}
export function renameAccount(row: AccountWorkspace, id: unknown, label: unknown) {
  requireIdle(row);
  if (typeof label !== "string" || !label.trim() || label.trim().length > 60 || /[\x00-\x1f\x7f]/.test(label))
    throw new TelegramError("input", "Dê um nome de até 60 caracteres para a conta.");
  const profile = registry(row).profiles.find((item) => item.id === id);
  if (!profile) throw new TelegramError("input", "Escolha uma conta salva.", 0, 404);
  profile.label = label.trim();
}
export function activateAccount(row: AccountWorkspace, id: unknown, codec: AccountCodec) {
  requireIdle(row);
  const value = registry(row), target = value.profiles.find((profile) => profile.id === id);
  if (!target) throw new TelegramError("input", "Escolha uma conta salva.", 0, 404);
  if (target.id === value.activeId) return publicAccountRoster(row).find((entry) => entry.active)!;
  const context = target.contextEnc ? openContext(target, codec) : undefined;
  const credentialsEnc = row.credentialsEnc;
  park(row, codec);
  empty(row, credentialsEnc, target);
  if (context) {
    row.credentialsEnc = context.credentialsEnc;
    row.sessionEnc = context.sessionEnc;
    row.authState = context.authState;
    Object.assign(row.parsed, { account: context.account, sources: context.sources, targets: context.targets,
      groups: context.groups, contacts: context.contacts, privacy: context.privacy, discovery: context.discovery,
      limits: context.limits, authorizedIds: context.authorizedIds, authorizations: context.authorizations, error: context.error });
  }
  delete target.contextEnc;
  value.activeId = target.id;
  advance(row);
  return publicAccountRoster(row).find((entry) => entry.active)!;
}
/** Only parked established sessions: pending active authentication is handled by its caller. */
export function retainedSessionEncs(row: AccountWorkspace, codec: AccountCodec): string[] {
  return profiles(row).filter((profile) => profile.id !== activeProfileId(row.parsed) && profile.contextEnc)
    .map((profile) => openContext(profile, codec).sessionEnc);
}
export function adoptProfileAccount(row: AccountWorkspace, account: Account, newAuthentication: boolean, codec: AccountCodec) {
  if (!row.parsed.accounts && !newAuthentication) return;
  const value = registry(row);
  let profile = value.profiles.find((item) => item.id === value.activeId)!;
  if (profile.account && profile.account.id !== account.id)
    throw new TelegramError("account_identity", "Esta conexão pertence a outra conta. Use Adicionar conta para preservá-las.", 0, 409);
  const existing = value.profiles.find((item) => item.id !== profile.id && item.account?.id === account.id);
  if (existing) {
    // A verified login from an empty draft reconnects the same Telegram ID.
    // Keep the canonical profile/history and any name already chosen for it.
    if (!newAuthentication || profile.account || profile.contextEnc)
      throw new TelegramError("account_exists", "Esta conta já está salva. Selecione a conta existente.", 0, 409);
    const context = existing.contextEnc ? openContext(existing, codec) : undefined;
    const priorLimits = context?.limits || existing.limits;
    const draftLimits = row.parsed.limits;
    rememberContactMetadata(row.parsed);
    if (context) Object.assign(row.parsed, {
      account: context.account, sources: context.sources, targets: context.targets,
      groups: context.groups, contacts: context.contacts, privacy: context.privacy,
      discovery: context.discovery, authorizedIds: context.authorizedIds, authorizations: context.authorizations,
    });
    row.parsed.limits = {
      restricted: !!priorLimits?.restricted || draftLimits.restricted,
      not_before: Math.max(priorLimits?.not_before || 0, draftLimits.not_before),
    };
    if (existing.label === existing.account?.name || existing.label === "Conta principal")
      existing.label = profile.label;
    delete existing.contextEnc;
    value.profiles = value.profiles.filter((item) => item.id !== profile.id);
    value.activeId = existing.id;
    profile = existing;
  }
  profile.account = structuredClone(account);
  delete profile.contextEnc;
  if (newAuthentication) advance(row);
}
