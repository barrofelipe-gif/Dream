# google-sheets-mcp

Servidor MCP para o **Google Sheets** — ler e escrever intervalos de
células, adicionar linhas, criar planilhas/abas, e operações avançadas
(formatação, ordenação etc.) via `batchUpdate`. Roda localmente via stdio e
se conecta ao Claude Code / Claude Desktop.

Uso 100% gratuito: você usa suas próprias credenciais OAuth do Google Cloud
(grátis). Substitui gerar um `.xlsx` novo toda vez — eu leio/escrevo direto
numa planilha viva e compartilhada.

## Ferramentas disponíveis

**Valores**
- `sheets_get_values` — lê um intervalo (ex: `Sheet1!A1:D20`)
- `sheets_update_values` — sobrescreve um intervalo
- `sheets_append_values` — adiciona linhas no fim de uma tabela
- `sheets_clear_values` — apaga o conteúdo de um intervalo (sem desfazer)

**Planilha/abas**
- `sheets_get_metadata` — título, abas e ids de uma planilha
- `sheets_create_spreadsheet` — cria uma planilha nova
- `sheets_add_sheet` — adiciona uma aba numa planilha existente
- `sheets_batch_update` — passthrough bruto pra formatação, ordenação, inserir/apagar linhas, etc.

## Passo 1 — Criar/reaproveitar as credenciais OAuth no Google Cloud (grátis)

Se você já criou um OAuth client "Desktop app" pros outros servidores
`google-*-mcp` deste repositório, reaproveite o mesmo Client ID/Secret — só
precisa ativar a API certa no mesmo projeto:

1. Acesse https://console.cloud.google.com/ → escolha o projeto.
2. **APIs & Services → Library** → ative **Google Sheets API**.
3. Se for criar do zero: **APIs & Services → Credentials → Create Credentials
   → OAuth client ID**, tipo **Desktop app**.

## Passo 2 — Instalar e gerar o refresh token

```bash
cd google-sheets-mcp
npm install
cp .env.example .env
```

Preencha `GOOGLE_SHEETS_CLIENT_ID` e `GOOGLE_SHEETS_CLIENT_SECRET` no
`.env`. Depois rode, **na sua máquina local** (precisa abrir navegador):

```bash
npm run auth
```

Loga com a conta Google (a mesma que é dona ou tem acesso às planilhas que
você vai usar), autoriza, e cole o `refresh_token` em
`GOOGLE_SHEETS_REFRESH_TOKEN`.

## Passo 3 — Build e registro no Claude Code

```bash
npm run build
```

```bash
claude mcp add google-sheets -- node "$(pwd)/dist/index.js"
```

Reinicie a sessão do Claude Code e as 8 ferramentas `sheets_*` aparecem
disponíveis.

## Testando sem o Claude Code

```bash
npm run inspector
```

## Segurança

- `.env` nunca é commitado (está no `.gitignore`). Nunca cole seu client
  secret ou refresh token em mensagens de chat.
- O escopo `spreadsheets` dá acesso de leitura E escrita a qualquer
  planilha que a conta autenticada consiga abrir — não só as que você criar
  por aqui. `sheets_update_values`/`sheets_clear_values`/`sheets_batch_update`
  fazem mudanças reais assim que chamados, sem confirmação extra dentro do
  servidor.
