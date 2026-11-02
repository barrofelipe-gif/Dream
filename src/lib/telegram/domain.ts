import { randomUUID } from "node:crypto";

export class TelegramError extends Error {
  constructor(
    public code: string,
    message: string,
    public wait = 0,
    public status = 400,
  ) {
    super(message);
  }
}
export type Group = {
  id: number;
  name: string;
  private: boolean;
  owner: boolean;
  can_invite: boolean;
  supergroup: boolean;
};
export type Person = {
  user_id: number;
  name: string;
  username: string;
  accessHash: string;
};
export type Contact = Person & { source_id: number; selected: boolean };
export type Consent = {
  user_id: number;
  target_id: number;
  evidence: string;
  authorized_at: number;
};
export type Result = {
  job_id: string;
  user_id: number;
  name: string;
  state: string;
  message: string;
  updated_at: number;
};
export type Job = {
  id: string;
  source_id: number;
  target_id: number;
  state: string;
  total: number;
  processed: number;
  success: number;
  failed: number;
  added: number;
  already: number;
  message: string;
  not_before: number;
  created_at: number;
  lease?: string;
  lease_until?: number;
};
export type Privacy = {
  group_id: number;
  name: string;
  private: boolean;
  members_hidden: boolean;
  content_protected: boolean;
  owner: boolean;
  supergroup: boolean;
  checked_at: number;
  notes?: string[];
};
export type Data = {
  sources: Group[];
  targets: Group[];
  groups: Group[];
  authorizedIds: number[];
  contacts: Contact[];
  authorizations: Consent[];
  audit: {
    action: string;
    user_id: number;
    target_id: number;
    evidence?: string;
    at: number;
  }[];
  jobs: Job[];
  results: Result[];
  limits: { restricted: boolean; not_before: number };
  account?: { id: number; name: string; username: string };
  privacy?: Privacy;
  error?: string;
};
export const activeStates = [
  "queued",
  "running",
  "paused",
  "paused_restriction",
];
export function initialData(input: unknown): Data {
  return {
    sources: [],
    targets: [],
    groups: [],
    authorizedIds: [],
    contacts: [],
    authorizations: [],
    audit: [],
    jobs: [],
    results: [],
    limits: { restricted: false, not_before: 0 },
    ...(input && typeof input === "object" ? input : {}),
  } as Data;
}
export function numeric(value: unknown, positive = false): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (positive ? value <= 0 : value >= 0)
  )
    throw new TelegramError("input", "Use um ID numérico válido.");
  return value;
}
export function idle(data: Data) {
  if (data.jobs.some((j) => activeStates.includes(j.state)))
    throw new TelegramError(
      "busy",
      "Encerre a operação atual antes de alterar a conexão ou os grupos.",
      0,
      409,
    );
}
export function pair(data: Data, source: unknown, target: unknown) {
  const sourceId = numeric(source),
    targetId = numeric(target);
  if (
    sourceId === targetId ||
    !data.sources.some((g) => g.id === sourceId) ||
    !data.targets.some((g) => g.id === targetId)
  )
    throw new TelegramError(
      "permission",
      "Escolha origem e destino cadastrados e diferentes.",
    );
  return { sourceId, targetId };
}
export function limits(data: Data) {
  if (data.limits.restricted)
    throw new TelegramError(
      "restricted",
      "O Telegram restringiu esta conta. Revise a situação antes de continuar.",
      0,
      409,
    );
  if (data.limits.not_before > Date.now() / 1000)
    throw new TelegramError(
      "flood_wait",
      "A espera determinada pelo Telegram ainda está em vigor.",
      0,
      409,
    );
}
export function confirmed(data: Data, userId: number, targetId: number) {
  return data.results.some(
    (r) =>
      r.user_id === userId &&
      ["added", "already"].includes(r.state) &&
      data.jobs.find((j) => j.id === r.job_id)?.target_id === targetId,
  );
}
export function eligible(
  data: Data,
  userId: number,
  sourceId: number,
  targetId: number,
) {
  return (
    data.authorizedIds.includes(userId) &&
    data.contacts.some(
      (p) => p.user_id === userId && p.source_id === sourceId && p.selected,
    ) &&
    data.authorizations.some(
      (a) => a.user_id === userId && a.target_id === targetId,
    ) &&
    !confirmed(data, userId, targetId)
  );
}
export function authorize(
  data: Data,
  userId: unknown,
  targetId: unknown,
  evidence: unknown,
) {
  const uid = numeric(userId, true),
    target = numeric(targetId);
  if (
    !data.authorizedIds.includes(uid) ||
    !data.contacts.some((p) => p.user_id === uid) ||
    !data.targets.some((g) => g.id === target)
  )
    throw new TelegramError(
      "permission",
      "Participante ou destino fora da configuração.",
    );
  if (
    typeof evidence !== "string" ||
    evidence.trim().length < 8 ||
    evidence.trim().length > 500
  )
    throw new TelegramError(
      "input",
      "Informe uma referência de autorização entre 8 e 500 caracteres.",
    );
  data.authorizations = data.authorizations.filter(
    (a) => a.user_id !== uid || a.target_id !== target,
  );
  data.authorizations.push({
    user_id: uid,
    target_id: target,
    evidence: evidence.trim(),
    authorized_at: Date.now() / 1000,
  });
  data.audit.push({
    action: "authorized",
    user_id: uid,
    target_id: target,
    evidence: evidence.trim(),
    at: Date.now() / 1000,
  });
}
export function enqueue(
  data: Data,
  source: unknown,
  target: unknown,
  ids: unknown,
) {
  idle(data);
  limits(data);
  const { sourceId, targetId } = pair(data, source, target);
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 500 ||
    ids.some(
      (i) => !Number.isSafeInteger(i) || !eligible(data, i, sourceId, targetId),
    )
  )
    throw new TelegramError(
      "input",
      "Selecione até 500 participantes autorizados, ainda não confirmados neste destino.",
    );
  const users = [...new Set(ids)] as number[];
  const job: Job = {
    id: randomUUID(),
    source_id: sourceId,
    target_id: targetId,
    state: "queued",
    total: users.length,
    processed: 0,
    success: 0,
    failed: 0,
    added: 0,
    already: 0,
    message: "Na fila. Acompanhe os resultados individuais.",
    not_before: 0,
    created_at: Date.now() / 1000,
  };
  data.jobs.unshift(job);
  data.results.push(
    ...users.map((user_id) => ({
      job_id: job.id,
      user_id,
      name: data.contacts.find((c) => c.user_id === user_id)!.name,
      state: "waiting",
      message: "Aguardando processamento.",
      updated_at: Date.now() / 1000,
    })),
  );
  return job;
}
export function recount(data: Data, job: Job) {
  const rows = data.results.filter((r) => r.job_id === job.id);
  job.processed = rows.filter(
    (r) => !["waiting", "in_progress"].includes(r.state),
  ).length;
  job.added = rows.filter((r) => r.state === "added").length;
  job.already = rows.filter((r) => r.state === "already").length;
  job.success = job.added + job.already;
  job.failed = rows.filter(
    (r) => !["waiting", "in_progress", "added", "already"].includes(r.state),
  ).length;
}
export function publicSnapshot(data: Data) {
  const latest = new Map<string, Result & { target_id: number }>();
  for (const r of data.results) {
    const j = data.jobs.find((j) => j.id === r.job_id);
    if (j)
      latest.set(`${r.user_id}:${j.target_id}`, {
        ...r,
        target_id: j.target_id,
      });
  }
  return {
    contacts: data.contacts.map((p) => ({
      user_id: p.user_id,
      name: p.name,
      username: p.username,
      source_id: p.source_id,
      selected: p.selected,
    })),
    authorizations: data.authorizations,
    jobs: data.jobs.map((job) => {
      const snapshot = { ...job };
      delete snapshot.lease;
      delete snapshot.lease_until;
      return snapshot;
    }),
    results: data.jobs[0]
      ? data.results.filter((r) => r.job_id === data.jobs[0].id)
      : [],
    last_results: [...latest.values()],
    confirmed: data.results
      .filter((r) => ["added", "already"].includes(r.state))
      .map((r) => ({
        user_id: r.user_id,
        target_id: data.jobs.find((j) => j.id === r.job_id)!.target_id,
      })),
    limits: data.limits,
  };
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
