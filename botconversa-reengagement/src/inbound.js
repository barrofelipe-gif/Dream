// O que acontece toda vez que o BotConversa avisa (via bloco de webhook do
// fluxo) que um cliente mandou mensagem. É o único evento que entra nesse
// serviço vindo de fora — tudo mais (as 3 janelas de espera) é decidido aqui.

import { config } from './config.js';
import { getRecord, registerInboundMessage } from './store.js';
import { addTag, removeTag } from './botconversaClient.js';

export async function handleInboundMessage(subscriberId) {
  const current = getRecord(subscriberId);

  // Já estava num ciclo de espera (tag "sem-resposta" aplicada) e agora
  // respondeu: isso é exatamente o que a cutucada queria conseguir.
  if (current && current.status === 'waiting') {
    await removeTag(subscriberId, config.tagSemRespostaId);
  }

  // Reinicia o ciclo do zero a partir desta mensagem — se o cliente ficar
  // quieto de novo, as janelas de 30min/1h/6h recomeçam a contar daqui.
  registerInboundMessage(subscriberId);
  await addTag(subscriberId, config.tagSemRespostaId);
}
