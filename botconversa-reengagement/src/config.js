// Lê toda a configuração de variáveis de ambiente (definidas no .env local
// ou no painel da hospedagem). Nada de chave/segredo fica escrito no código.

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente ${name} não definida. Confira o .env (veja .env.example).`
    );
  }
  return value;
}

export const config = {
  apiBase: process.env.BOTCONVERSA_API_BASE || 'https://backend.botconversa.com.br/api/v1/webhook',
  apiKey: required('BOTCONVERSA_API_KEY'),
  authHeaderName: process.env.BOTCONVERSA_AUTH_HEADER_NAME || 'Api-Key',
  authHeaderPrefix: process.env.BOTCONVERSA_AUTH_HEADER_PREFIX || '',
  tagSemRespostaId: required('TAG_SEM_RESPOSTA_ID'),
  webhookSharedSecret: required('WEBHOOK_SHARED_SECRET'),
  redisUrl: required('UPSTASH_REDIS_REST_URL'),
  redisToken: required('UPSTASH_REDIS_REST_TOKEN'),
  port: Number(process.env.PORT || 3000),
  messages: {
    min30: process.env.MSG_30MIN || 'Ei, ficou alguma dúvida?',
    h1: process.env.MSG_1H || 'Ei, conseguiu comprar?',
    h6: process.env.MSG_6H || 'Ei, deu tudo certo?',
  },
  // Janelas de reengajamento em minutos a partir do momento em que o cliente parou de responder.
  windowsMinutes: {
    min30: 30,
    h1: 60,
    h6: 360,
  },
  // De quanto em quanto tempo o serviço confere se alguma janela venceu (em ms).
  checkIntervalMs: 60 * 1000,
};
