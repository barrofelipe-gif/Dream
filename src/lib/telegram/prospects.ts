import { TelegramError, type PublicGroup } from "./domain";

export type ProspectObservation = {
  at: string;
  members: number | null;
  delta: number | null;
};
export type SavedProspect = PublicGroup & {
  savedAt: string;
  query: string;
  discoveredAt: string;
  lastCheckedAt: string;
  nextCheckAt: string;
  history: ProspectObservation[];
  lastAttemptAt?: string;
  lastError?: string;
};

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
function text(value: unknown, length: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, length)
    : "";
}
function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return;
  const milliseconds = Date.parse(value);
  if (Number.isFinite(milliseconds) && milliseconds >= 0)
    return new Date(milliseconds).toISOString();
}
function instant(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 8.64e15)
    throw new TelegramError("input", "Data de consulta inválida.");
  return new Date(milliseconds).toISOString();
}

const prospectClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function localClock(milliseconds: number): number {
  const parts = prospectClock.formatToParts(new Date(milliseconds));
  const read = (name: string) => Number(parts.find((part) => part.type === name)!.value);
  return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"), new Date(milliseconds).getUTCMilliseconds());
}

/** A calendar month in Brasília, retaining local time and clamping the last day. */
export function nextProspectCheck(at: string): string {
  const parsed = timestamp(at);
  if (!parsed) throw new TelegramError("input", "Data de consulta inválida.");
  const date = new Date(localClock(Date.parse(parsed))), day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  const target = date.getTime();
  let candidate = target, previous = candidate;
  for (let attempt = 0; attempt < 4; attempt++) {
    const correction = target - localClock(candidate);
    if (!correction) return new Date(candidate).toISOString();
    previous = candidate;
    candidate += correction;
  }
  // Historical daylight-saving gaps use the first valid later local time.
  return new Date(Math.max(candidate, previous)).toISOString();
}

function publicGroup(value: unknown): PublicGroup | undefined {
  if (!value || typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "number" || !Number.isSafeInteger(row.id) || row.id >= 0 ||
      typeof row.username !== "string" || !/^[A-Za-z0-9_]{3,32}$/.test(row.username)) return;
  const name = text(row.name, 200);
  if (!name) return;
  return {
    id: row.id,
    name,
    username: row.username,
    url: `https://t.me/${row.username}`,
    members: count(row.members),
    sponsored: row.sponsored === true,
    ...(row.kind === "group" || row.kind === "channel" ? { kind: row.kind } : {}),
  };
}

function observations(value: unknown): ProspectObservation[] {
  const points = new Map<string, { at: string; members: number | null; conflict: boolean }>();
  if (Array.isArray(value)) for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const at = timestamp(entry.at);
    const members = count(entry.members);
    if (!at) continue;
    const prior = points.get(at);
    const conflict = !!prior?.conflict || !!(prior && prior.members !== null && members !== null && prior.members !== members);
    points.set(at, { at, members: conflict ? null : members ?? prior?.members ?? null, conflict });
  }
  let previous: number | null = null;
  return [...points.values()].sort((a, b) => a.at.localeCompare(b.at)).map(({ at, members }) => {
    const delta = members !== null && previous !== null ? members - previous : null;
    previous = members;
    return { at, members, delta };
  });
}

/** Legacy savedAt records receive a baseline, never a fabricated growth delta. */
export function normalizeProspect(value: unknown, now = Date.now()): SavedProspect | undefined {
  if (!Number.isSafeInteger(now) || now < 0) return;
  const group = publicGroup(value);
  if (!group) return;
  const row = value as Record<string, unknown>;
  let history = observations(row.history);
  const savedAt = timestamp(row.savedAt) || timestamp(row.discoveredAt) || history[0]?.at;
  if (!savedAt) return;
  const discoveredAt = timestamp(row.discoveredAt) || savedAt;
  const lastCheckedAt = timestamp(row.lastCheckedAt) || history.at(-1)?.at || discoveredAt;
  if (!history.length) history = [{ at: lastCheckedAt, members: group.members, delta: null }];
  else if (lastCheckedAt > history.at(-1)!.at)
    history = observations([...history, { at: lastCheckedAt, members: group.members }]);
  const checked = history.at(-1)!.at;
  const nextCheckAt = timestamp(row.nextCheckAt);
  const lastAttemptAt = timestamp(row.lastAttemptAt);
  const lastError = text(row.lastError, 300);
  return {
    ...group,
    members: history.at(-1)!.members,
    savedAt,
    query: text(row.query, 100),
    discoveredAt,
    lastCheckedAt: checked,
    nextCheckAt: nextCheckAt && nextCheckAt > checked ? nextCheckAt : nextProspectCheck(checked),
    history,
    ...(lastAttemptAt ? { lastAttemptAt } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

function records(list: readonly unknown[], now: number): SavedProspect[] {
  const byId = new Map<number, SavedProspect>();
  for (const item of list) {
    const record = normalizeProspect(item, now);
    if (!record) continue;
    const prior = byId.get(record.id);
    if (!prior) { byId.set(record.id, record); continue; }
    const latest = record.lastCheckedAt >= prior.lastCheckedAt ? record : prior;
    const first = record.discoveredAt < prior.discoveredAt ? record : prior;
    const attempted = (record.lastAttemptAt || record.lastCheckedAt) >= (prior.lastAttemptAt || prior.lastCheckedAt) ? record : prior;
    const history = observations([...prior.history, ...record.history]);
    byId.set(record.id, {
      ...latest,
      members: history.at(-1)!.members,
      savedAt: record.savedAt < prior.savedAt ? record.savedAt : prior.savedAt,
      discoveredAt: first.discoveredAt,
      query: first.query || latest.query,
      history,
      lastAttemptAt: attempted.lastAttemptAt,
      lastError: attempted.lastError,
    });
  }
  return [...byId.values()];
}

export function saveProspectRecord(
  list: readonly unknown[], group: PublicGroup, query: string, foundAt: number, now = Date.now(),
): SavedProspect[] {
  const savedAt = instant(now), discoveredAt = instant(foundAt);
  if (foundAt > now) throw new TelegramError("input", "A data de descoberta não pode estar no futuro.");
  const live = publicGroup(group);
  if (!live) throw new TelegramError("input", "Escolha um grupo ou canal público válido.");
  const saved = records(list, now);
  if (saved.some((record) => record.id === live.id)) return saved;
  if (saved.some((record) => record.username.toLowerCase() === live.username.toLowerCase()))
    throw new TelegramError("group_identity", "Este @usuário pertence a outro ID. O canal salvo e seu histórico foram preservados.");
  return [{
    ...live, savedAt, discoveredAt, query: text(query, 100),
    lastCheckedAt: discoveredAt,
    nextCheckAt: nextProspectCheck(discoveredAt),
    history: [{ at: discoveredAt, members: live.members, delta: null }],
  }, ...saved];
}

export function recordProspectCheck(
  list: readonly unknown[], id: number, live?: PublicGroup, error?: string, now = Date.now(),
): SavedProspect[] {
  const at = instant(now);
  return records(list, now).map((prior) => {
    if (prior.id !== id || at < prior.lastCheckedAt || (prior.lastAttemptAt && at < prior.lastAttemptAt)) return prior;
    const group = publicGroup(live);
    const failure = text(error, 300) || (!group ? "Não foi possível consultar este grupo ou canal público." :
      group.id !== id ? "O @usuário agora pertence a outro ID. O histórico foi preservado." : "");
    if (failure) return { ...prior, lastAttemptAt: at, lastError: text(failure, 300) };
    if (at === prior.lastCheckedAt) return prior;
    const updated = { ...prior, ...group!,
      lastAttemptAt: at, lastCheckedAt: at, nextCheckAt: nextProspectCheck(at),
      history: observations([...prior.history, { at, members: group!.members }]),
    };
    delete updated.lastError;
    return updated;
  });
}
