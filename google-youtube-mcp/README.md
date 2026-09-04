# google-youtube-mcp

Servidor MCP para o **YouTube** — canal, vídeos (metadados e edição),
comentários e relatórios do YouTube Analytics (visualizações, tempo
assistido, inscritos ganhos, receita estimada). Roda localmente via stdio e
se conecta ao Claude Code / Claude Desktop.

Uso 100% gratuito: você usa suas próprias credenciais OAuth do Google Cloud
(grátis).

## Ferramentas disponíveis

**Canal e vídeos**
- `yt_get_my_channel` — info do canal autenticado (inscritos, views, playlist de uploads)
- `yt_list_channel_videos` — lista vídeos de uma playlist de uploads
- `yt_get_video` — detalhes e estatísticas de um vídeo
- `yt_update_video` — atualiza título/descrição/tags/privacidade

**Comentários**
- `yt_list_comments` — lista comentários de um vídeo
- `yt_reply_comment` — responde um comentário

**Analytics**
- `yt_get_analytics` — relatório do YouTube Analytics: qualquer métrica (views, tempo assistido, inscritos, receita) × dimensão (dia, vídeo, país, fonte de tráfego, dispositivo) num período

## Passo 1 — Criar/reaproveitar as credenciais OAuth no Google Cloud (grátis)

Se você já criou um OAuth client "Desktop app" pros outros servidores
`google-*-mcp` deste repositório, reaproveite o mesmo Client ID/Secret — só
precisa ativar as APIs certas no mesmo projeto:

1. Acesse https://console.cloud.google.com/ → escolha o projeto.
2. **APIs & Services → Library** → ative **YouTube Data API v3** e
   **YouTube Analytics API**.
3. Se for criar do zero: **APIs & Services → Credentials → Create Credentials
   → OAuth client ID**, tipo **Desktop app**.

## Passo 2 — Instalar e gerar o refresh token

```bash
cd google-youtube-mcp
npm install
cp .env.example .env
```

Preencha `GOOGLE_YOUTUBE_CLIENT_ID` e `GOOGLE_YOUTUBE_CLIENT_SECRET` no
`.env`. Depois rode, **na sua máquina local** (precisa abrir navegador):

```bash
npm run auth
```

Loga com a conta Google dona do canal, autoriza, e cole o `refresh_token`
em `GOOGLE_YOUTUBE_REFRESH_TOKEN`.

## Passo 3 — Build e registro no Claude Code

```bash
npm run build
```

```bash
claude mcp add google-youtube -- node "$(pwd)/dist/index.js"
```

Reinicie a sessão do Claude Code e as 7 ferramentas `yt_*` aparecem
disponíveis.

## Testando sem o Claude Code

```bash
npm run inspector
```

## Segurança

- `.env` nunca é commitado (está no `.gitignore`). Nunca cole seu client
  secret ou refresh token em mensagens de chat.
- O escopo `youtube` (não `.readonly`) inclui escrita, porque
  `yt_update_video` e `yt_reply_comment` alteram o canal real assim que
  chamados — sem confirmação extra dentro do servidor. Se você só quer
  leitura, troque o escopo em `scripts/get-refresh-token.ts` para
  `https://www.googleapis.com/auth/youtube.readonly` antes de rodar
  `npm run auth`.
