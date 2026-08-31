// Persistência simples em arquivo JSON. Não precisa de banco de dados pra
// esse volume — só precisa sobreviver a um restart do serviço, já que os
// prazos (30min/1h/6h) são checados por um loop, não por setTimeout (que se
// perderia se a hospedagem reiniciar o processo).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DATA_FILE = join(DATA_DIR, 'state.json');

function load() {
  if (!existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function save(state) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

let state = load();

// Chamado toda vez que uma mensagem do cliente chega (via webhook do fluxo).
// Reinicia o ciclo de reengajamento do zero pra esse subscriber.
export function registerInboundMessage(subscriberId) {
  const now = Date.now();
  state[subscriberId] = {
    subscriberId,
    lastInboundAt: now,
    status: 'waiting', // waiting | responded | closed_no_response
    sent: { min30: false, h1: false, h6: false },
  };
  save(state);
  return state[subscriberId];
}

// Chamado quando detectamos que o cliente respondeu de novo DEPOIS de já
// estar em ciclo de espera — encerra o ciclo sem esperar os prazos.
export function markResponded(subscriberId) {
  const record = state[subscriberId];
  if (record && record.status === 'waiting') {
    record.status = 'responded';
    save(state);
  }
}

export function markSent(subscriberId, windowKey) {
  const record = state[subscriberId];
  if (!record) return;
  record.sent[windowKey] = true;
  save(state);
}

export function closeNoResponse(subscriberId) {
  const record = state[subscriberId];
  if (!record) return;
  record.status = 'closed_no_response';
  save(state);
}

export function getWaitingSubscribers() {
  return Object.values(state).filter((r) => r.status === 'waiting');
}

export function getRecord(subscriberId) {
  return state[subscriberId] || null;
}
