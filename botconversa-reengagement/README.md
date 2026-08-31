# Reengajamento automático — BotConversa

Serviço pequeno que roda 24h e cuida sozinho do reengajamento de clientes
que pararam de responder no WhatsApp: manda 3 mensagens (30min / 1h / 6h) e
gerencia a tag `sem-resposta`, sem depender do construtor de fluxo nativo
(que estava travando pedindo autorização toda hora).

## Antes de rodar — 3 coisas pra confirmar

Eu não tenho acesso à sua conta do BotConversa nem à documentação completa
da API (bloqueada neste ambiente). O código abaixo foi escrito em cima do
que apareceu no seu Swagger (`https://backend.botconversa.com.br/swagger/`),
mas tem 2 pontos que só dá pra confirmar clicando lá:

1. **Nome do header de autenticação.** Clique em **"Authorize"** no Swagger
   e veja o nome do campo pedido (ex: `Api-Key`). Ajuste
   `BOTCONVERSA_AUTH_HEADER_NAME` no `.env` se for diferente do padrão que
   deixei configurado.
2. **Formato exato do corpo de `send_message`.** No Swagger, clique no
   endpoint `POST /subscriber/{subscriber_id}/send_message/` e expanda o
   "Request body" — confirme se o campo se chama `message` (o que assumi em
   `src/botconversaClient.js`) ou outra coisa (`text`, `value`, etc.). Ajuste
   o arquivo se for diferente.
3. **ID da tag `sem-resposta`.** Essa tag precisa já existir no BotConversa
   (crie manualmente em Configurações → Etiquetas, se ainda não existir).
   Depois, chame `GET /tags/` (dá pra testar direto no Swagger, botão "Try
   it out") pra achar o ID numérico dela e colocar em `TAG_SEM_RESPOSTA_ID`.

## Configuração

```
cp .env.example .env
# edite o .env com sua chave de API, o ID da tag, e invente um WEBHOOK_SHARED_SECRET
npm install
npm start
```

## Como conectar ao fluxo do BotConversa

Dentro do seu fluxo (Fluxos de conversa), você só precisa de **1 bloco**,
não da automação inteira que estava travando:

- Gatilho: "ao receber mensagem do cliente"
- Ação: Bloco de Integração → Webhook
  - Método: `POST`
  - URL: `https://SEU-SERVICO-HOSPEDADO/webhook/inbound?secret=SEU_WEBHOOK_SHARED_SECRET`
  - Corpo (JSON): `{ "subscriber_id": "{{subscriber_id}}" }`
    (o nome da variável do ID do subscriber dentro do editor de fluxo pode
    ter um nome ligeiramente diferente — use a variável que representa o
    ID do contato atual, disponível no próprio editor do bloco)

Esse bloco simples é bem mais robusto que a automação de espera+condição
inteira dentro do fluxo — ele só avisa "chegou mensagem" e some. Todo o
resto (contar 30min/1h/6h, mandar as mensagens, tirar a tag) acontece aqui
no serviço, de forma confiável mesmo se o BotConversa reiniciar algo do
lado dele.

## Onde hospedar

Isso precisa ficar rodando 24h — **não dá pra rodar no seu computador
pessoal** (webhook exige um endereço sempre acessível pela internet).
Opções gratuitas simples pra esse tamanho de serviço: Railway, Render ou
Fly.io — qualquer uma delas sobe um Node.js a partir deste repositório em
poucos cliques (conectando ao GitHub) e te dá uma URL pública (é essa URL
que vai no bloco de webhook do fluxo, acima).

## Como funciona por dentro

- `src/server.js` — recebe o aviso de mensagem nova (`POST /webhook/inbound`)
- `src/inbound.js` — decide o que fazer quando chega mensagem (tira a tag se
  já estava esperando, e reinicia o ciclo de 30min/1h/6h)
- `src/scheduler.js` — a cada 1 minuto, confere se alguma janela venceu pra
  algum contato e manda a mensagem certa; ao final das 6h sem resposta,
  remove a tag e encerra o ciclo (não fica reciclando)
- `src/store.js` — guarda o estado de cada contato em `data/state.json`
  (sobrevive a um restart do serviço)
- `src/botconversaClient.js` — chamadas aos endpoints reais do BotConversa
