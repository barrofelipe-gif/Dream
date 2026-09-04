# google-analytics-mcp

Servidor MCP para o **Google Analytics 4 (GA4)** — relatórios via Data API
(qualquer combinação de dimensões/métricas, incluindo tempo real) e descoberta
de contas/propriedades via Admin API. Roda localmente via stdio e se conecta
ao Claude Code / Claude Desktop.

Uso 100% gratuito: você usa suas próprias credenciais OAuth do Google Cloud
(grátis, sem developer token — diferente do Google Ads). Não depende de
nenhuma plataforma paga (Windsor, Supermetrics etc.).

## Ferramentas disponíveis

- `google_analytics_list_properties` — lista contas e propriedades GA4 que o token acessa
- `google_analytics_run_report` — relatório GA4 completo (tráfego, engajamento, conversões, receita, e-commerce) com qualquer dimensão/métrica e intervalo de datas
- `google_analytics_run_realtime_report` — relatório de tempo real (últimos ~30 min)
- `google_analytics_get_metadata` — lista as dimensões/métricas disponíveis pra uma propriedade

## Passo 1 — Criar/reaproveitar as credenciais OAuth no Google Cloud (grátis)

Se você já criou um OAuth client "Desktop app" pro `google-ads-mcp` (ou pro
Gmail deste projeto), pode **reaproveitar o mesmo Client ID/Secret** — só
precisa garantir que a API certa está ativada no mesmo projeto:

1. Acesse https://console.cloud.google.com/ → escolha o projeto.
2. **APIs & Services → Library** → ative **Google Analytics Data API** e
   **Google Analytics Admin API**.
3. Se for criar do zero: **APIs & Services → Credentials → Create Credentials
   → OAuth client ID**, tipo **Desktop app**.

## Passo 2 — Instalar e gerar o refresh token

```bash
cd google-analytics-mcp
npm install
cp .env.example .env
```

Preencha `GOOGLE_ANALYTICS_CLIENT_ID` e `GOOGLE_ANALYTICS_CLIENT_SECRET` no
`.env`. Depois rode, **na sua máquina local** (precisa abrir navegador):

```bash
npm run auth
```

Loga com a conta Google que tem acesso à propriedade GA4, autoriza, e o
script imprime o `refresh_token`. Cole em `GOOGLE_ANALYTICS_REFRESH_TOKEN`.

Opcional: preencha `GOOGLE_ANALYTICS_PROPERTY_ID` com o id numérico da
propriedade (aparece em Admin → Configurações da propriedade no GA4) pra não
precisar passar `property_id` em toda chamada.

## Passo 3 — Build e registro no Claude Code

```bash
npm run build
```

```bash
claude mcp add google-analytics -- node "$(pwd)/dist/index.js"
```

Reinicie a sessão do Claude Code e as 4 ferramentas `google_analytics_*`
aparecem disponíveis.

Configuração manual (Claude Desktop):

```json
{
  "mcpServers": {
    "google-analytics": {
      "command": "node",
      "args": ["/caminho/absoluto/para/google-analytics-mcp/dist/index.js"],
      "env": {
        "GOOGLE_ANALYTICS_CLIENT_ID": "...",
        "GOOGLE_ANALYTICS_CLIENT_SECRET": "...",
        "GOOGLE_ANALYTICS_REFRESH_TOKEN": "...",
        "GOOGLE_ANALYTICS_PROPERTY_ID": ""
      }
    }
  }
}
```

## Testando sem o Claude Code

```bash
npm run inspector
```

## Segurança

- `.env` nunca é commitado (está no `.gitignore`). Nunca cole seu client
  secret ou refresh token em mensagens de chat.
- O escopo usado é `analytics.readonly` — este servidor só lê dados, nunca
  altera configuração da propriedade nem dados de eventos.
