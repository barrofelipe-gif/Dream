# google-business-profile-mcp

Servidor MCP para o **Google Business Profile** (antigo Google Meu Negócio)
— contas, locais (lojas/endereços), leitura e atualização de informações
(horário, telefone, categoria) e métricas de performance (visualizações,
cliques, ligações, pedidos de rota). Roda localmente via stdio e se conecta
ao Claude Code / Claude Desktop.

Uso 100% gratuito (sem custo de API), mas **precisa de aprovação do
Google** — ver Passo 0 abaixo, é o equivalente ao developer token do Ads.

## Ferramentas disponíveis

- `gbp_list_accounts` — contas que o token acessa
- `gbp_list_locations` — locais (lojas) de uma conta
- `gbp_get_location` — detalhes completos de um local (horário, telefone, categoria, endereço)
- `gbp_update_location` — atualiza campos de um local
- `gbp_get_performance` — série diária de uma métrica (visualizações no Maps/Busca, cliques no site, ligações, pedidos de rota, mensagens, pedidos)

### ⚠️ Sobre avaliações (reviews)

Responder/ler avaliações de clientes usa uma API separada e mais antiga
(My Business API v4) que o Google **descontinuou para novos apps** — não
dá mais pra pedir acesso a ela. Este servidor não inclui essa
funcionalidade porque não há caminho de acesso disponível hoje. Ler e
responder avaliações continua precisando ser feito pela UI do Business
Profile mesmo.

## Passo 0 — Pedir acesso à API (obrigatório, é como o developer token do Ads)

Diferente de Analytics/Search Console/Sheets, o Google **restringe** o
acesso às APIs do Business Profile por padrão — só ativar no Cloud Console
não é suficiente.

1. Preencha o formulário de acesso:
   https://developers.google.com/my-business/content/prereqs
2. Explique o uso (gerenciar o(s) local(is) da sua empresa). Aprovação
   costuma levar alguns dias úteis.
3. Só depois de aprovado as chamadas efetivamente funcionam — antes disso
   você recebe erro de permissão mesmo com token e API ativada certos.

## Passo 1 — Criar/reaproveitar as credenciais OAuth no Google Cloud (grátis)

1. Acesse https://console.cloud.google.com/ → escolha o projeto (pode
   reaproveitar o mesmo dos outros servidores `google-*-mcp`).
2. **APIs & Services → Library** → ative as três:
   **My Business Account Management API**, **My Business Business
   Information API** e **Business Profile Performance API**.
3. Se for criar do zero: **APIs & Services → Credentials → Create Credentials
   → OAuth client ID**, tipo **Desktop app**.

## Passo 2 — Instalar e gerar o refresh token

```bash
cd google-business-profile-mcp
npm install
cp .env.example .env
```

Preencha `GOOGLE_BUSINESS_PROFILE_CLIENT_ID` e `_CLIENT_SECRET` no `.env`.
Depois rode, **na sua máquina local** (precisa abrir navegador):

```bash
npm run auth
```

Loga com a conta Google dona/gerente do Business Profile, autoriza, e cole
o `refresh_token` em `GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN`.

## Passo 3 — Build e registro no Claude Code

```bash
npm run build
```

```bash
claude mcp add google-business-profile -- node "$(pwd)/dist/index.js"
```

Reinicie a sessão do Claude Code e as 5 ferramentas `gbp_*` aparecem
disponíveis.

## Testando sem o Claude Code

```bash
npm run inspector
```

## Segurança

- `.env` nunca é commitado (está no `.gitignore`). Nunca cole seu client
  secret ou refresh token em mensagens de chat.
- O escopo `business.manage` dá leitura E escrita — `gbp_update_location`
  muda informação pública do seu negócio no Google Maps/Busca assim que
  chamada, sem confirmação extra dentro do servidor.
