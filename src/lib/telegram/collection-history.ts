import { randomUUID } from "node:crypto";
import type { Contact, Data, Person } from "./domain";

/** A snapshot of consulted contacts, not acquisitions, invitations or sales. */
export type CollectionRun = {
  id: string;
  sourceId: number;
  targetId: number;
  collectedAt: string;
  received: number;
  newContacts: number;
  knownContacts: number;
  totalKnown: number;
  accountId?: number;
};

export type CollectionContact = Contact & {
  firstCollectedAt?: string;
  lastCollectedAt?: string;
};
type HistoryData = Data & {
  contacts: CollectionContact[];
  collectionRuns?: CollectionRun[];
};

// Explicit projection also keeps future/private fields out of the public DTO.
function snapshot(run: CollectionRun): CollectionRun {
  return {
    id: run.id,
    sourceId: run.sourceId,
    targetId: run.targetId,
    collectedAt: run.collectedAt,
    received: run.received,
    newContacts: run.newContacts,
    knownContacts: run.knownContacts,
    totalKnown: run.totalKnown,
    ...(run.accountId === undefined ? {} : { accountId: run.accountId }),
  };
}

function actualDate(value: string | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function latest(a: string | undefined, b: string): string {
  const known = actualDate(a);
  return known && known > b ? known : b;
}

/** Mutates Data after a successful RPC. `now` is Unix time in milliseconds. */
export function recordCollection(
  data: Data,
  sourceId: number,
  targetId: number,
  people: Person[],
  now = Date.now(),
  runId = randomUUID(),
): CollectionRun {
  const history = data as HistoryData;
  const prior = history.collectionRuns?.find((run) => run.id === runId);
  if (prior) return snapshot(prior);
  const collectedAt = new Date(now).toISOString();
  const contacts: CollectionContact[] = [];
  const known = new Map<number, CollectionContact>();
  for (const contact of history.contacts) {
    if (contact.source_id !== sourceId) {
      contacts.push(contact);
      continue;
    }
    const existing = known.get(contact.user_id);
    if (existing) {
      // Consolidate old duplicate rows without losing an existing selection.
      existing.selected ||= contact.selected;
      if (existing.firstCollectedAt && contact.firstCollectedAt) {
        existing.firstCollectedAt = [existing.firstCollectedAt, contact.firstCollectedAt].sort()[0];
      } else {
        // An undated legacy row means its original collection date is unknown.
        delete existing.firstCollectedAt;
      }
      const last = actualDate(contact.lastCollectedAt);
      if (last) existing.lastCollectedAt = latest(existing.lastCollectedAt, last);
    } else {
      const copy = { ...contact };
      known.set(contact.user_id, copy);
      contacts.push(copy);
    }
  }
  // Telegram can repeat a participant across result pages. The final real data wins.
  const unique = new Map(people.map((person) => [person.user_id, person]));
  let newContacts = 0;
  let knownContacts = 0;
  for (const person of unique.values()) {
    const existing = known.get(person.user_id);
    if (existing) {
      existing.name = person.name;
      existing.username = person.username;
      existing.accessHash = person.accessHash;
      existing.lastCollectedAt = latest(existing.lastCollectedAt, collectedAt);
      // Keep selected and firstCollectedAt exactly as recorded, including absent.
      knownContacts++;
    } else {
      const contact: CollectionContact = {
        user_id: person.user_id,
        name: person.name,
        username: person.username,
        accessHash: person.accessHash,
        source_id: sourceId,
        selected: false,
        firstCollectedAt: collectedAt,
        lastCollectedAt: collectedAt,
      };
      known.set(person.user_id, contact);
      contacts.push(contact);
      newContacts++;
    }
  }
  const run: CollectionRun = {
    id: runId,
    sourceId,
    targetId,
    collectedAt,
    received: unique.size,
    newContacts,
    knownContacts,
    totalKnown: known.size,
    ...(data.account ? { accountId: data.account.id } : {}),
  };
  history.contacts = contacts;
  history.collectionRuns = [...(history.collectionRuns ?? []), snapshot(run)];
  return snapshot(run);
}

/** Public origin-level statistics. Never includes a participant or access hash. */
export function collectionSummary(data: Data, sourceId: number): {
  firstCollectedAt: string | null;
  lastCollectedAt: string | null;
  totalContacts: number;
  runs: CollectionRun[];
} {
  const history = data as HistoryData;
  const contacts = history.contacts.filter((contact) => contact.source_id === sourceId);
  const runs = (history.collectionRuns ?? [])
    .filter((run) => run.sourceId === sourceId)
    .map(snapshot)
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  const dates = (runs.length
    ? runs.map((run) => actualDate(run.collectedAt))
    : contacts.flatMap((contact) => [actualDate(contact.firstCollectedAt), actualDate(contact.lastCollectedAt)])
  ).filter((date): date is string => date !== null).sort();
  return {
    firstCollectedAt: dates[0] ?? null,
    lastCollectedAt: dates.at(-1) ?? null,
    totalContacts: new Set(contacts.map((contact) => contact.user_id)).size,
    runs,
  };
}
