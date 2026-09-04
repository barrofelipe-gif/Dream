# google-pagespeed-mcp

Servidor MCP para o **Google PageSpeed Insights** — audita qualquer URL
pública e retorna scores de performance/acessibilidade/SEO/boas práticas,
dados reais de Core Web Vitals (quando disponíveis) e as maiores
oportunidades de melhoria. Roda localmente via stdio e se conecta ao
Claude Code / Claude Desktop.

**O mais simples dos servidores deste repositório**: não precisa de OAuth,
login, nem refresh token — só uma API key opcional (grátis).

## Ferramenta disponível

- `pagespeed_analyze_url` — audita uma URL (mobile ou desktop), retorna scores por categoria, Core Web Vitals de campo e o top 10 de oportunidades de melhoria

## Passo 1 — (Opcional, mas recomendado) Criar uma API key grátis

Sem chave, a API funciona mas com limite de taxa bem baixo. Com chave, o
limite sobe bastante — ainda grátis.

1. Acesse https://console.cloud.google.com/ → escolha (ou crie) um projeto.
2. **APIs & Services → Library** → ative **PageSpeed Insights API**.
3. **APIs & Services → Credentials → Create Credentials → API key**. Copie a
   chave (não precisa "Desktop app", é uma chave simples).
4. Opcional: restrinja a chave a essa API só, em **Restrições de API**.

## Passo 2 — Instalar

```bash
cd google-pagespeed-mcp
npm install
cp .env.example .env
```

Preencha `GOOGLE_PAGESPEED_API_KEY` no `.env` (ou deixe em branco pra
testar sem chave, com limite de taxa mais baixo).

## Passo 3 — Build e registro no Claude Code

```bash
npm run build
```

```bash
claude mcp add google-pagespeed -- node "$(pwd)/dist/index.js"
```

Reinicie a sessão do Claude Code e a ferramenta `pagespeed_analyze_url`
aparece disponível.

## Testando sem o Claude Code

```bash
npm run inspector
```

## Segurança

- `.env` nunca é commitado (está no `.gitignore`).
- Só leitura — audita URLs públicas, não muda nada. A API key, se
  vazada, só permite rodar auditorias (sem custo real além de cota), mas
  ainda assim não cole em mensagens de chat.
