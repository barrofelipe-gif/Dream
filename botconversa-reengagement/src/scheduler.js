// Loop que roda a cada 1 minuto (config.checkIntervalMs) e confere, pra cada
// contato em espera, se alguma das 3 janelas (30min/1h/6h) venceu. Rodar por
// checagem periódica (em vez de setTimeout) é o que permite sobreviver a um
// restart do processo sem perder o agendamento.

import { config } from './config.js';
import { getWaitingSubscribers, markSent, closeNoResponse } from './store.js';
import { sendMessage, removeTag } from './botconversaClient.js';

const WINDOWS = [
  { key: 'min30', minutes: config.windowsMinutes.min30, text: config.messages.min30 },
  { key: 'h1', minutes: config.windowsMinutes.h1, text: config.messages.h1 },
  { key: 'h6', minutes: config.windowsMinutes.h6, text: config.messages.h6 },
];

async function tick() {
  const now = Date.now();
  const waiting = getWaitingSubscribers();

  for (const record of waiting) {
    const elapsedMinutes = (now - record.lastInboundAt) / 60000;

    for (const window of WINDOWS) {
      if (record.sent[window.key]) continue;
      if (elapsedMinutes < window.minutes) continue;

      try {
        await sendMessage(record.subscriberId, window.text);
        markSent(record.subscriberId, window.key);
        console.log(`[reengajamento] mensagem "${window.key}" enviada pro subscriber ${record.subscriberId}`);
      } catch (err) {
        console.error(`[reengajamento] falhou ao enviar "${window.key}" pro subscriber ${record.subscriberId}:`, err.message);
        continue; // tenta de novo no próximo tick, não marca como enviado
      }

      // Depois da última janela (6h), se ainda não respondeu, encerra o
      // ciclo e tira a tag — não fica reciclando o contato.
      if (window.key === 'h6') {
        try {
          await removeTag(record.subscriberId, config.tagSemRespostaId);
        } catch (err) {
          console.error(`[reengajamento] falhou ao remover tag do subscriber ${record.subscriberId}:`, err.message);
        }
        closeNoResponse(record.subscriberId);
        console.log(`[reengajamento] subscriber ${record.subscriberId} encerrado sem resposta`);
      }
    }
  }
}

export function startScheduler() {
  tick().catch((err) => console.error('[reengajamento] erro no tick inicial:', err));
  setInterval(() => {
    tick().catch((err) => console.error('[reengajamento] erro no tick:', err));
  }, config.checkIntervalMs);
}
