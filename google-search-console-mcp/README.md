# google-search-console-mcp

Servidor MCP para o **Google Search Console** — search analytics (cliques,
impressões, CTR, posição), listagem de sites e sitemaps, envio de sitemap e
inspeção de indexação de URL. Roda localmente via stdio e se conecta ao
Claude Code / Claude Desktop.

Uso 100% gratuito: você usa suas próprias credenciais OAuth do Google Cloud
(grátis, sem developer token). Não depende de nenhuma plataforma paga
(Windsor, Supermetrics etc.).

## Ferramentas disponíveis

**Leitura**
- `google_search_console_list_sites` — lista sites/propriedades que o token acessa
- `google_search_console_query` — search analytics: cliques, impressões, CTR, posição, por query/página/país/dispositivo/data
- `google_search_console_list_sitemaps` — sitemaps enviados, com erros/avisos e URLs indexadas
- `google_search_console_inspect_url` — status de indexação de uma URL específica (por que não aparece no Google)

**Escrita**
- `google_search_console_submit_sitemap` — envia ou reenvia um sitemap

## Passo 1 — Criar/reaproveitar as credenciais OAuth no Google Cloud (grátis)

Se você já criou um OAuth client "Desktop app" pro `google-ads-mcp` ou
`google-analytics-mcp` (ou pro Gmail deste projeto), pode **reaproveitar o
mesmo Client ID/Secret** — só precisa garantir que a API certa está ativada
no mesmo projeto:

1. Acesse https://console.cloud.google.com/ → escolha o projeto.
2. **APIs & Services → Library** → ative **Search Console API**.
3. Se for criar do zero: **APIs & Services → Credentials → Create Credentials
   → OAuth client ID**, tipo **Desktop app**.

## Passo 2 — Instalar e gerar o refresh token

```bash
cd google-search-console-mcp
npm install
cp .env.example .env
```

Preencha `GOOGLE_SEARCH_CONSOLE_CLIENT_ID` e `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET`
no `.env`. Depois rode, **na sua máquina local** (precisa abrir navegador):

```bash
npm run auth
```

Loga com a conta Google dona da propriedade no Search Console, autoriza, e o
script imprime o `refresh_token`. Cole em
`GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN`.

Opcional: preencha `GOOGLE_SEARCH_CONSOLE_SITE_URL` com o site exatamente
como está cadastrado no Search Console (ex: `https://www.exemplo.com/` ou
`sc-domain:exemplo.com`) pra não precisar passar `site_url` em toda chamada.

## Passo 3 — Build e registro no Claude Code

```bash
npm run build
```

```bash
claude mcp add google-search-console -- node "$(pwd)/dist/index.js"
```

Reinicie a sessão do Claude Code e as 5 ferramentas
`google_search_console_*` aparecem disponíveis.

Configuração manual (Claude Desktop):

```json
{
  "mcpServers": {
    "google-search-console": {
      "command": "node",
      "args": ["/caminho/absoluto/para/google-search-console-mcp/dist/index.js"],
      "env": {
        "GOOGLE_SEARCH_CONSOLE_CLIENT_ID": "...",
        "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET": "...",
        "GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN": "...",
        "GOOGLE_SEARCH_CONSOLE_SITE_URL": ""
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
- O escopo usado é o `webmasters` completo (não só `.readonly`), porque
  `google_search_console_submit_sitemap` precisa de permissão de escrita —
  é a única ferramenta que muda algo; todas as outras são leitura. Se você
  não quer nem essa permissão de escrita, edite `SCOPE` em
  `scripts/get-refresh-token.ts` para `webmasters.readonly` antes de rodar
  `npm run auth`, e remova/ignore a ferramenta de envio de sitemap.
