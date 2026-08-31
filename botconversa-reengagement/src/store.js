// Persistência no Upstash Redis (tier grátis) via API REST — assim o estado
// de cada contato sobrevive a um restart do serviço na Render, em vez de
// morar num arquivo local que se perde quando o processo reinicia.
//
// Guarda dois tipos de coisa:
//   - subscriber:{id}  -> JSON com { subscriberId, lastInboundAt, status, sent }
//   - waiting_subscribers -> um "set" com os IDs de quem está em ciclo de espera
//     (é essa lista que o scheduler.js confere a cada 1 minuto)

import { config } from './config.js';

async function redis(...command) {
  const url = `${config.redisUrl}/${command.map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.redisToken}` },
  });
  if (!res.ok) {
    throw new Error(`Upstash Redis ${command[0]} -> ${res.status}: ${await res.text()}`);
  }
  const { result } = await res.json();
  return result;
}

function key(subscriberId) {
  return `subscriber:${subscriberId}`;
}

export async function registerInboundMessage(subscriberId) {
  const now = Date.now();
  const record = {
    subscriberId,
    lastInboundAt: now,
    status: 'waiting',
    sent: { min30: false, h1: false, h6: false },
  };
  await redis('SET', key(subscriberId), JSON.stringify(record));
  await redis('SADD', 'waiting_subscribers', subscriberId);
  return record;
}

export async function markResponded(subscriberId) {
  const record = await getRecord(subscriberId);
  if (record && record.status === 'waiting') {
    record.status = 'responded';
    await redis('SET', key(subscriberId), JSON.stringify(record));
    await redis('SREM', 'waiting_subscribers', subscriberId);
  }
}

export async function markSent(subscriberId, windowKey) {
  const record = await getRecord(subscriberId);
  if (!record) return;
  record.sent[windowKey] = true;
  await redis('SET', key(subscriberId), JSON.stringify(record));
}

export async function closeNoResponse(subscriberId) {
  const record = await getRecord(subscriberId);
  if (!record) return;
  record.status = 'closed_no_response';
  await redis('SET', key(subscriberId), JSON.stringify(record));
  await redis('SREM', 'waiting_subscribers', subscriberId);
}

export async function getWaitingSubscribers() {
  const ids = (await redis('SMEMBERS', 'waiting_subscribers')) || [];
  const records = await Promise.all(ids.map((id) => getRecord(id)));
  return records.filter(Boolean);
}

export async function getRecord(subscriberId) {
  const raw = await redis('GET', key(subscriberId));
  return raw ? JSON.parse(raw) : null;
}
