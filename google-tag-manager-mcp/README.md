# google-tag-manager-mcp

Servidor MCP para o **Google Tag Manager (GTM)** — leitura e escrita de tags,
triggers, variáveis, pastas, clients (server-side), zones e templates, além
de criação e publicação de versões de container. Roda localmente via stdio e
se conecta ao Claude Code / Claude Desktop.

Uso 100% gratuito: você usa suas próprias credenciais OAuth do Google Cloud
(grátis, sem developer token). Não depende de nenhuma plataforma paga.

## Ferramentas disponíveis

**Descoberta**
- `gtm_list_accounts` — contas GTM que o token acessa
- `gtm_list_containers` — containers (web, AMP, iOS, Android, server) de uma conta
- `gtm_list_workspaces` — workspaces (áreas de rascunho) de um container

**Entidades — leitura e escrita genéricas** (`entity_type`: `tags` | `triggers` | `variables` | `folders` | `clients` | `zones` | `templates`)
- `gtm_list_entities` — lista entidades de um tipo num workspace
- `gtm_get_entity` — pega a definição completa de uma entidade
- `gtm_create_entity` — cria uma entidade nova (corpo bruto da API)
- `gtm_update_entity` — substitui a definição de uma entidade existente
- `gtm_delete_entity` — apaga uma entidade (sem desfazer)

**Versões e publicação**
- `gtm_list_versions` — histórico de versões publicadas (e arquivadas, opcional)
- `gtm_create_version` — tira um "snapshot" do workspace (equivalente a "Enviar" na UI)
- `gtm_publish_version` — publica uma versão pro tráfego real (equivalente a "Publicar")

## Passo 1 — Criar/reaproveitar as credenciais OAuth no Google Cloud (grátis)

Se você já criou um OAuth client "Desktop app" pros outros servidores
`google-*-mcp` deste repositório (ou pro Gmail), pode **reaproveitar o mesmo
Client ID/Secret** — só precisa garantir que a API certa está ativada no
mesmo projeto:

1. Acesse https://console.cloud.google.com/ → escolha o projeto.
2. **APIs & Services → Library** → ative **Tag Manager API**.
3. Se for criar do zero: **APIs & Services → Credentials → Create Credentials
   → OAuth client ID**, tipo **Desktop app**.

## Passo 2 — Instalar e gerar o refresh token

```bash
cd google-tag-manager-mcp
npm install
cp .env.example .env
```

Preencha `GOOGLE_TAG_MANAGER_CLIENT_ID` e `GOOGLE_TAG_MANAGER_CLIENT_SECRET`
no `.env`. Depois rode, **na sua máquina local** (precisa abrir navegador):

```bash
npm run auth
```

Loga com a conta Google que administra o GTM, autoriza, e o script imprime o
`refresh_token`. Cole em `GOOGLE_TAG_MANAGER_REFRESH_TOKEN`.

Opcional: preencha `GOOGLE_TAG_MANAGER_ACCOUNT_ID` e
`GOOGLE_TAG_MANAGER_CONTAINER_ID` (os ids numéricos — aparecem no
`gtm_list_accounts`/`gtm_list_containers`, não confundir com o "GTM-XXXXXXX"
mostrado na UI) pra não precisar passar em toda chamada.

## Passo 3 — Build e registro no Claude Code

```bash
npm run build
```

```bash
claude mcp add google-tag-manager -- node "$(pwd)/dist/index.js"
```

Reinicie a sessão do Claude Code e as 11 ferramentas `gtm_*` aparecem
disponíveis.

Configuração manual (Claude Desktop):

```json
{
  "mcpServers": {
    "google-tag-manager": {
      "command": "node",
      "args": ["/caminho/absoluto/para/google-tag-manager-mcp/dist/index.js"],
      "env": {
        "GOOGLE_TAG_MANAGER_CLIENT_ID": "...",
        "GOOGLE_TAG_MANAGER_CLIENT_SECRET": "...",
        "GOOGLE_TAG_MANAGER_REFRESH_TOKEN": "...",
        "GOOGLE_TAG_MANAGER_ACCOUNT_ID": "",
        "GOOGLE_TAG_MANAGER_CONTAINER_ID": ""
      }
    }
  }
}
```

## Fluxo típico (criar uma tag e publicar)

1. `gtm_list_accounts` → `gtm_list_containers` → `gtm_list_workspaces` pra achar o `workspace_path`.
2. `gtm_create_entity` (`entity_type: "tags"`) com o corpo da tag — ou `gtm_get_entity` numa tag parecida primeiro pra copiar o formato.
3. `gtm_create_version` no mesmo `workspace_path` → recebe um `containerVersion.path`.
4. `gtm_publish_version` com esse `version_path` — isso já afeta o tráfego real, não tem "ambiente de teste" depois desse passo.

## Testando sem o Claude Code

```bash
npm run inspector
```

## Segurança

- `.env` nunca é commitado (está no `.gitignore`). Nunca cole seu client
  secret ou refresh token em mensagens de chat.
- O escopo padrão inclui **edição e publicação** (não só leitura), porque
  `gtm_create_entity`/`gtm_update_entity`/`gtm_delete_entity`/`gtm_publish_version`
  fazem mudanças reais assim que chamadas — não há confirmação extra dentro
  do servidor. `gtm_publish_version` em particular afeta o site/app real
  imediatamente. Se você só quer leitura, edite `SCOPE` em
  `scripts/get-refresh-token.ts` para conter apenas
  `tagmanager.readonly` antes de rodar `npm run auth`.
- `gtm_delete_entity` é permanente — não existe "restaurar" pela API.
