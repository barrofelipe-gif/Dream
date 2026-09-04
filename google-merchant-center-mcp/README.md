# google-merchant-center-mcp

Servidor MCP para o **Google Merchant Center** — diagnóstico de conta, status
de aprovação/reprovação de produto (com motivo do erro) e dados brutos do
feed, via Content API for Shopping v2.1. Roda localmente via stdio e se
conecta ao Claude Code / Claude Desktop.

Uso 100% gratuito: você usa suas próprias credenciais OAuth do Google Cloud
(grátis, sem developer token). Substitui a análise manual de CSV exportado
do Google Ads/Shopping.

## Ferramentas disponíveis

- `gmc_get_account_status` — diagnóstico da conta inteira (suspensão, políticas violadas)
- `gmc_list_product_statuses` — status de aprovação + motivo de reprovação de **todos** os produtos
- `gmc_get_product_status` — status + issues de um produto específico
- `gmc_list_products` — dados brutos do feed (preço, disponibilidade, GTIN, imagem)
- `gmc_get_product` — dados brutos de um produto específico

## Passo 1 — Criar/reaproveitar as credenciais OAuth no Google Cloud (grátis)

Se você já criou um OAuth client "Desktop app" pros outros servidores
`google-*-mcp` deste repositório, reaproveite o mesmo Client ID/Secret — só
precisa ativar a API certa no mesmo projeto:

1. Acesse https://console.cloud.google.com/ → escolha o projeto.
2. **APIs & Services → Library** → ative **Content API for Shopping**.
3. Se for criar do zero: **APIs & Services → Credentials → Create Credentials
   → OAuth client ID**, tipo **Desktop app**.

## Passo 2 — Instalar e gerar o refresh token

```bash
cd google-merchant-center-mcp
npm install
cp .env.example .env
```

Preencha `GOOGLE_MERCHANT_CENTER_CLIENT_ID` e `_CLIENT_SECRET` no `.env`.
Depois rode, **na sua máquina local** (precisa abrir navegador):

```bash
npm run auth
```

Loga com a conta Google dona do Merchant Center, autoriza, e o script
imprime o `refresh_token`. Cole em `GOOGLE_MERCHANT_CENTER_REFRESH_TOKEN`.

Preencha também `GOOGLE_MERCHANT_CENTER_MERCHANT_ID` — o número que aparece
no canto superior direito da UI do Merchant Center (não confundir com o
Customer ID do Google Ads).

## Passo 3 — Build e registro no Claude Code

```bash
npm run build
```

```bash
claude mcp add google-merchant-center -- node "$(pwd)/dist/index.js"
```

Reinicie a sessão do Claude Code e as 5 ferramentas `gmc_*` aparecem
disponíveis.

## Testando sem o Claude Code

```bash
npm run inspector
```

## Segurança

- `.env` nunca é commitado (está no `.gitignore`). Nunca cole seu client
  secret ou refresh token em mensagens de chat.
- O escopo usado é `content` (leitura e escrita), mas este servidor só
  implementa ferramentas de **leitura** — nenhuma delas altera produtos ou
  configuração da conta.
