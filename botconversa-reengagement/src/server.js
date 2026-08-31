import express from 'express';
import { config } from './config.js';
import { startScheduler } from './scheduler.js';
import { handleInboundMessage } from './inbound.js';

const app = express();
app.use(express.json());

// Endpoint que o fluxo do BotConversa chama (Bloco de Integração -> Webhook)
// sempre que o cliente manda uma mensagem. Configure esse bloco pra:
//   Método: POST
//   URL: https://SEU-SERVICO/webhook/inbound?secret=SEU_WEBHOOK_SHARED_SECRET
//   Corpo (JSON): { "subscriber_id": "{{subscriber_id}}" }
// (o nome exato da variável do subscriber_id dentro do BotConversa você
// confirma no próprio editor do bloco de integração, no fluxo).
app.post('/webhook/inbound', async (req, res) => {
  if (req.query.secret !== config.webhookSharedSecret) {
    return res.status(401).json({ error: 'segredo inválido' });
  }

  const subscriberId = req.body?.subscriber_id;
  if (!subscriberId) {
    return res.status(400).json({ error: 'subscriber_id ausente no corpo da requisição' });
  }

  try {
    await handleInboundMessage(subscriberId);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook/inbound] erro:', err.message);
    res.status(500).json({ error: 'falha ao processar mensagem' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(config.port, () => {
  console.log(`[reengajamento] servidor rodando na porta ${config.port}`);
  startScheduler();
});
