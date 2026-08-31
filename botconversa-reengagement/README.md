# Reengajamento automático — BotConversa

Serviço pequeno que roda 24h e cuida sozinho do reengajamento de clientes
que pararam de responder no WhatsApp: manda 3 mensagens (30min / 1h / 6h) e
gerencia a tag `SemResposta`, sem depender do construtor de fluxo nativo
(que estava travando pedindo autorização toda hora).

## Antes de rodar — já confirmado direto no Swagger

- **Header de autenticação:** `API-KEY` (sem prefixo, só a chave crua).
- **Corpo do `send_message`:** `{ "type": "text", "value": "sua mensagem" }`.
- **Tag `SemResposta` já existe** na conta (apareceu na lista de 16 tags).
  Só falta você pegar o **ID numérico** dela — rode isto no console do
  navegador, na mesma aba do Swagger (troca `SUA_CHAVE` pela chave real):

  ```js
  fetch('https://backend.botconversa.com.br/api/v1/webhook/tags/', {
    headers: { 'API-KEY': 'SUA_CHAVE' },
  })
    .then((r) => r.json())
    .then((tags) => console.log(tags.map((t) => `${t.id} -> ${t.name}`).join('\n')));
  ```

  Acha a linha `... -> SemResposta` e usa esse número em `TAG_SEM_RESPOSTA_ID`.

## Configuração

1. Crie um banco grátis em **console.upstash.com** → "Create Database" →
   copie a **REST URL** e o **REST Token** (aba "REST API" do banco criado).
2. ```
   cp .env.example .env
   # edite o .env com sua chave de API, o ID da tag, o WEBHOOK_SHARED_SECRET
   # inventado, e as credenciais do Upstash
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

Recomendado: **Render** (Web Service, plano grátis) + **UptimeRobot**
(grátis, batendo em `/health` a cada 5min pra manter acordado) +
**Upstash Redis** (grátis, guarda o estado — veja "Configuração" acima).
Com essa combinação, mesmo que a Render reinicie o serviço às vezes (o
próprio plano grátis deles diz que isso pode acontecer, sem aviso), o
estado de quem está em ciclo de espera não se perde, porque não mora mais
num arquivo local — mora no Upstash.

(Fly.io não é mais opção grátis permanente desde 2024, só dá créditos de
teste por alguns dias — por isso não está na lista.)

## Como funciona por dentro

- `src/server.js` — recebe o aviso de mensagem nova (`POST /webhook/inbound`)
- `src/inbound.js` — decide o que fazer quando chega mensagem (tira a tag se
  já estava esperando, e reinicia o ciclo de 30min/1h/6h)
- `src/scheduler.js` — a cada 1 minuto, confere se alguma janela venceu pra
  algum contato e manda a mensagem certa; ao final das 6h sem resposta,
  remove a tag e encerra o ciclo (não fica reciclando)
- `src/store.js` — guarda o estado de cada contato no Upstash Redis
  (sobrevive a um restart do serviço, diferente de um arquivo local)
- `src/botconversaClient.js` — chamadas aos endpoints reais do BotConversa
