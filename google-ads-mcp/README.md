# google-ads-mcp

Servidor MCP para a **Google Ads API** — leitura completa via GAQL e escrita
(campanhas, orçamentos, ad groups, anúncios, keywords, segmentação, e um
endpoint genérico que cobre qualquer outra mutação da API). Roda localmente
via stdio e se conecta ao Claude Code / Claude Desktop.

Uso 100% gratuito: você usa seu próprio developer token do Google Ads e suas
próprias credenciais OAuth do Google Cloud (grátis). Não depende de nenhuma
plataforma paga (Windsor, Supermetrics etc.).

## Ferramentas disponíveis

**Leitura**
- `google_ads_list_accessible_customers` — lista os IDs de conta que seu token acessa
- `google_ads_query` — roda qualquer GAQL (cobre praticamente 100% dos relatórios: campanhas, ad groups, anúncios, keywords, termos de busca, conversões, audiências, orçamentos, histórico de mudanças, recomendações etc.)

**Escrita — atalhos ergonômicos**
- `google_ads_create_campaign_budget` / `google_ads_update_campaign_budget`
- `google_ads_create_campaign` / `google_ads_update_campaign_status` (pausar/ativar/remover)
- `google_ads_add_campaign_criteria` (localização, idioma, dispositivo, negativas em nível de campanha)
- `google_ads_create_ad_group` / `google_ads_update_ad_group`
- `google_ads_add_keywords` / `google_ads_update_keyword`
- `google_ads_create_responsive_search_ad` / `google_ads_update_ad_status`

**Escrita — acesso total**
- `google_ads_mutate` — passthrough direto para qualquer operação de mutate da API (shared sets, conversion actions, listas de negativas em nível de conta, labels, Performance Max, bidding strategies, experiments etc.) — cobre tudo que os atalhos acima não cobrem.

## Passo 1 — Criar as credenciais OAuth no Google Cloud (grátis)

1. Acesse https://console.cloud.google.com/ e crie um projeto (ou use um existente).
2. Vá em **APIs & Services → OAuth consent screen**. Configure como "External" (ou "Internal" se for Workspace), preencha nome do app e seu e-mail. Não precisa de aprovação do Google para uso pessoal em modo "Testing" — só adicione sua própria conta Google em **Test users**.
3. Vá em **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
4. Tipo de aplicativo: **Desktop app**. Dê um nome (ex: "google-ads-mcp") e crie.
5. Copie o **Client ID** e o **Client Secret** gerados.

## Passo 2 — Confirmar/aplicar seu Developer Token

1. Acesse https://ads.google.com/ com a conta que administra a conta de anúncios.
2. Vá em **Tools & Settings → Setup → API Center**.
3. Copie o **Developer Token** (você disse que já tem esse — se for de outro e-mail pessoal, acesse com aquela conta).
4. Verifique o **nível de acesso**:
   - **Test access**: só funciona com contas de teste do Google Ads, não com contas reais. Se for esse o seu caso, você ainda consegue desenvolver e testar tudo aqui, mas para operar a conta real da BFF vai precisar solicitar **Basic access** (formulário simples dentro do próprio API Center, aprovação geralmente em 1-2 dias úteis).
   - **Basic/Standard access**: já pode operar contas reais normalmente.

## Passo 3 — Instalar e gerar o refresh token

```bash
cd google-ads-mcp
npm install
cp .env.example .env
```

Edite `.env` e preencha `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` e
`GOOGLE_ADS_DEVELOPER_TOKEN` com o que você pegou nos passos 1 e 2.

Depois rode, **na sua máquina local** (precisa abrir navegador e fazer login):

```bash
npm run auth
```

Isso abre o navegador, você loga com a conta Google dona da conta de anúncios,
autoriza o app, e o script imprime o `refresh_token` no terminal. Cole-o em
`GOOGLE_ADS_REFRESH_TOKEN` no `.env`.

> ⚠️ **Importante (desde 5 de agosto de 2026):** o Google passou a exigir
> **passkey** para gerar novos refresh tokens da API do Ads. Se aparecer uma
> tela pedindo passkey durante o login, é normal — siga o fluxo do Google (é
> configuração única). Tokens já existentes continuam funcionando sem passkey;
> a exigência é só para *gerar* um novo.

Por fim, preencha `GOOGLE_ADS_CUSTOMER_ID` com o ID da conta de anúncios
(10 dígitos, sem traços — aparece no canto superior direito do Google Ads).
Se você acessa por uma conta gerenciadora (MCC), preencha também
`GOOGLE_ADS_LOGIN_CUSTOMER_ID` com o ID da MCC.

## Passo 4 — Build e registro no Claude Code

```bash
npm run build
```

Registre o servidor (rode a partir da pasta `google-ads-mcp`):

```bash
claude mcp add google-ads -- node "$(pwd)/dist/index.js"
```

Isso grava a config apontando pro binário compilado; as variáveis de `.env`
são carregadas automaticamente pelo servidor (via `dotenv`) quando ele inicia
a partir desta pasta. Reinicie a sessão do Claude Code e as 14 ferramentas
`google_ads_*` aparecem disponíveis.

Se preferir configurar manualmente (Claude Desktop, por exemplo), o bloco é:

```json
{
  "mcpServers": {
    "google-ads": {
      "command": "node",
      "args": ["/caminho/absoluto/para/google-ads-mcp/dist/index.js"],
      "env": {
        "GOOGLE_ADS_CLIENT_ID": "...",
        "GOOGLE_ADS_CLIENT_SECRET": "...",
        "GOOGLE_ADS_DEVELOPER_TOKEN": "...",
        "GOOGLE_ADS_REFRESH_TOKEN": "...",
        "GOOGLE_ADS_CUSTOMER_ID": "...",
        "GOOGLE_ADS_LOGIN_CUSTOMER_ID": ""
      }
    }
  }
}
```

## Testando sem o Claude Code

```bash
npm run inspector
```

Abre o MCP Inspector (interface web local) pra você chamar as ferramentas
manualmente e ver os retornos antes de usar em produção.

## Segurança

- `.env` nunca é commitado (está no `.gitignore`). Nunca cole seu client
  secret, developer token ou refresh token em mensagens de chat.
- Todas as ferramentas de escrita (`operation: "create"/"update"/"remove"`,
  ou qualquer `google_ads_*` que não seja `list_accessible_customers`/`query`)
  fazem mudanças reais na conta assim que chamadas — não há confirmação extra
  dentro do servidor. Peça ao Claude para rodar com `validate_only: true`
  primeiro em `google_ads_mutate` quando quiser só validar sem aplicar.
- `REMOVED` em campanhas/ad groups/anúncios é permanente na API do Google
  Ads (não existe "restaurar").
