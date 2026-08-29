# Painel de Pendências

Sistema web com login que centraliza pendências de trabalho por categoria
(Processos, Empresa BFF, E-mails, Viagens), com quadro estilo Kanban de
colunas totalmente customizáveis (criar, renomear, reordenar e excluir),
filtros, ditado por voz (inclusive um "ditado inteligente" que organiza uma
frase falada nos campos certos) e sincronização automática de e-mails
pendentes do Gmail.

**Fase 1**: uso individual, um único login (painel pessoal — Processos,
Empresa BFF, E-mails, Viagens).
**Fase 2** (em construção): aba **BFF Fitness** — mapa da empresa por setor
(Financeiro, Marketing/Vendas, Estoque/Logística, Clientes, Suporte,
Jurídico, Desenvolvimento de Produto), com login por pessoa e acesso
configurável por setor (`/admin/usuarios`). Ver seção 9.

## Stack

- **Next.js 16** (App Router) + TypeScript + Tailwind CSS
- **Prisma 6** como ORM, Postgres como banco
- **NextAuth (Auth.js) v5** — login por e-mail/senha (credentials)
- **googleapis** — integração com Gmail (OAuth 2.0, escopo somente leitura)
- **@hello-pangea/dnd** — quadro Kanban com arrastar e soltar
- **Web Speech API** (nativa do navegador) — ditado por voz, sem custo
- **Claude API** (`@anthropic-ai/sdk`, modelo `claude-opus-5`) — organiza o
  texto ditado nos campos certos da pendência ("ditado inteligente")
- Pensado pra rodar 100% nos planos gratuitos: **Vercel** (hospedagem +
  cron), **Neon** ou **Supabase** (Postgres)

---

## 1. Rodando localmente

```bash
npm install
cp .env.example .env
```

Preencha o `.env`:

| Variável | Como gerar |
|---|---|
| `DATABASE_URL` | URL de um Postgres (local, Neon ou Supabase — veja seção 2) |
| `AUTH_SECRET` | `npx auth secret` ou `openssl rand -base64 32` |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` | o e-mail e senha que você vai usar pra logar |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | veja seção 4 (Gmail) — pode deixar em branco por enquanto |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) — opcional; sem ela o app funciona normal, só o "Ditar pendência" fica desativado |

Depois:

```bash
npx prisma db push     # cria as tabelas no banco
npm run seed            # cria seu usuário de login
npm run dev              # http://localhost:3000
```

---

## 2. Banco de dados (Neon ou Supabase — plano gratuito)

**Neon** (recomendado, mais simples pra Postgres puro):
1. Crie conta em [neon.tech](https://neon.tech) → **New Project**.
2. Copie a **Connection string** (formato `postgresql://...`) — já vem com
   `?sslmode=require`, mantenha assim.
3. Cole em `DATABASE_URL` no `.env` (local) e depois nas variáveis de
   ambiente da Vercel (produção).

**Supabase** (alternativa, se já usa Supabase por outro motivo):
1. Crie um projeto em [supabase.com](https://supabase.com).
2. Em **Project Settings → Database → Connection string**, use a URL no
   modo **Transaction** (porta 6543) para produção na Vercel (funções
   serverless) — mantenha o `?sslmode=require`.

Depois de configurar, rode `npx prisma db push` para criar as tabelas.

---

## 3. Deploy na Vercel

1. Suba este repositório no GitHub (já deve estar em
   `barrofelipe-gif/dream`, branch `claude/painel-pendencias-jcv4lq` — dá
   pra abrir um PR pra `main`/produção quando estiver satisfeito).
2. Em [vercel.com](https://vercel.com) → **Add New → Project** → importe o
   repositório.
3. Em **Environment Variables**, adicione todas as variáveis do `.env`
   (menos as que são só de seed, se preferir rodar o seed uma vez local
   apontando pro banco de produção).
4. Deploy. Você recebe uma URL tipo `painel-pendencias.vercel.app`.
5. Rode o seed apontando pro banco de produção (uma vez só, do seu
   computador ou daqui):
   ```bash
   DATABASE_URL="<url de produção>" npm run seed
   ```

O `vercel.json` já configura o cron job de sincronização do Gmail (roda de
hora em hora) — a Vercel ativa automaticamente ao detectar o arquivo.

---

## 4. Domínio próprio

1. Em **Vercel → Project → Settings → Domains**, adicione o domínio ou
   subdomínio que você quiser usar (ex: `painel.seudominio.com.br`).
2. A Vercel mostra o registro DNS exato a criar (normalmente um `CNAME`
   apontando pro subdomínio, ou um `A` se for o domínio raiz).
3. Entre no painel do seu registrador (Registro.br, GoDaddy, Cloudflare
   etc.) e crie esse registro.
4. Aguarde a propagação (geralmente minutos, pode levar até algumas horas)
   — a Vercel confirma automaticamente quando detecta o DNS certo e emite
   o certificado HTTPS.

*Decisão em aberto: qual domínio/subdomínio exato usar — me diga quando
for configurar essa parte.*

---

## 5. Conectar o Gmail (Google Cloud Console)

Critério adotado para "e-mail pendente": **o próprio Gmail com uma label
chamada "Pendente"**. Você marca manualmente (ou com um filtro automático
do Gmail) os e-mails que quer ver no painel, e o sistema cria essa label
sozinho na primeira sincronização, se ela ainda não existir.

Passo a passo pra criar as credenciais OAuth:

1. Acesse [console.cloud.google.com](https://console.cloud.google.com) e
   crie um projeto novo (ou use um existente).
2. **APIs e serviços → Biblioteca** → ative a **Gmail API**.
3. **APIs e serviços → Tela de consentimento OAuth**:
   - Tipo de usuário: **Externo** (ou Interno, se sua conta Google for
     Workspace com domínio próprio).
   - Preencha nome do app ("Painel de Pendências"), e-mail de suporte.
   - Em **Escopos**, adicione `gmail.readonly` e `gmail.labels`.
   - Em **Usuários de teste** (se o app ficar em modo "Teste"), adicione
     seu próprio e-mail — assim você consegue autorizar sem precisar
     publicar o app publicamente.
4. **APIs e serviços → Credenciais → Criar credenciais → ID do cliente
   OAuth**:
   - Tipo de aplicativo: **Aplicativo da Web**.
   - **URIs de redirecionamento autorizados**, adicione:
     - `http://localhost:3000/api/gmail/callback` (para testar local)
     - `https://SEU_DOMINIO/api/gmail/callback` (produção)
5. Copie o **Client ID** e o **Client Secret** gerados para
   `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (local e na Vercel), e
   ajuste `GOOGLE_REDIRECT_URI` para a URL de produção.
6. No app, vá em **Conectar Gmail** (link no menu lateral) e autorize.

> Se você reconectar depois de já ter autorizado uma vez, o Google às
> vezes não reenvia o `refresh_token`. Se isso acontecer, revogue o acesso
> em [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
> e conecte de novo.

---

## 6. Colunas do Kanban

Cada categoria (Processos, Empresa BFF, E-mails, Viagens) tem seu próprio
conjunto de colunas — nascem 3 padrão (Pendente / Em andamento / Concluído)
na primeira vez que você abre a categoria, e dali pra frente:

- **Renomear**: clique no título da coluna.
- **Adicionar**: botão "+ Nova coluna" no fim do quadro.
- **Reordenar**: setas ◀ ▶ que aparecem ao passar o mouse no título.
- **Excluir**: "×" ao passar o mouse — só deixa excluir coluna vazia (sem
  mover os cards pra outra coluna primeiro, o excluir é bloqueado).

Como colunas são por categoria, a visão "Todas as categorias" não dá pra
misturar quadros diferentes num só — ela vira um resumo somente-leitura em
2 grupos (Em aberto / Concluído). Pra arrastar cards e editar colunas,
escolhe uma categoria no menu lateral.

## 7. Ditado por voz

Dois níveis, os dois grátis de usar (só o segundo depende da chave da
Anthropic):

- **Por campo**: o ícone de microfone ao lado de Título e Detalhes no modal
  dita só aquele campo (Web Speech API do navegador — Chrome/Edge).
- **Ditado inteligente**: botão "Ditar pendência" no topo do painel — fala
  a pendência inteira numa frase só ("responder o fornecedor tal sobre
  pagamento, prioridade alta, prazo sexta-feira, categoria BFF financeiro")
  e o Claude organiza automaticamente em título, categoria, prioridade,
  prazo etc. A transcrição fica editável antes de enviar, pra corrigir erro
  de reconhecimento de voz, e o formulário final ainda abre pra revisão —
  nada salva sem você conferir e clicar em Salvar.

## 8. BFF Fitness — Mapa da Empresa (Fase 2, em construção)

Aba separada do painel pessoal, pra acompanhar a saúde da empresa por setor
(Financeiro, Marketing/Vendas, Estoque, Logística, Clientes, Suporte e
Pós-venda, Jurídico, Desenvolvimento de Produto — RH ainda não entrou).

**Visão Central** (`/empresa`): visual de "central de comando" — os
setores aparecem como nós conectados ao redor do núcleo BFF, cada um com
semáforo (verde/amarelo/vermelho/cinza-sem-dado); um setor em vermelho
pulsa, e o núcleo assume a pior cor entre os setores visíveis. Clica num
nó pra abrir o detalhe daquele setor. Hoje todo setor nasce cinza (sem
fonte de dado ligada ainda) — o componente (`src/components/EmpresaHub.tsx`)
já aceita status real por setor assim que a Tray entrar.

**Acesso por setor**: `/admin/usuarios` (só visível pra quem é `role=admin`)
— cria login pra cada pessoa e marca quais setores ela vê. Admin sempre vê
todos os setores; membro só vê o que foi liberado. A Visão Central mostra
só os setores daquele usuário.

**Fonte de dado — Tray Commerce** (`src/lib/tray.ts`): integração OAuth2
direta com a API REST da Tray (confirmada contra developers.tray.com.br).
Fluxo: `/conectar-tray` (admin-only) → `/api/tray/connect` redireciona pro
`auth.php` da loja → depois de autorizar, `/api/tray/callback` troca o
`code` por `access_token`/`refresh_token` (guardados criptografados em
`TrayConnection`, uma única linha — é conexão da empresa, não por usuário).
`getValidAccessToken()` renova sozinho quando o token expira. Falta:
- **testar o handshake completo de verdade** (só dá pra fechar o login
  numa aba de navegador de verdade, com HTTPS — não rola de dentro da
  sandbox de dev);
- ligar `trayGet()` nos setores (Estoque, Logística, Marketing/Vendas,
  Clientes) — hoje o client existe mas nenhum setor ainda chama ele;
- o CRM completo de Clientes pedido pelo usuário.

## 9. Atribuir pendência pra outra pessoa

No painel pessoal, ao criar uma pendência aparece "Atribuir para" quando
existe mais de um usuário no sistema. Escolhendo outra pessoa:

- a pendência entra direto no quadro dela (categoria/coluna dela, não a sua);
- toda vez que ela abrir o painel, aparece um aviso ("Você tem N pendências
  que alguém te enviou", com quantas estão atrasadas) até ela concluir todas;
- o card mostra "de {seu nome}", e o modal guarda o histórico: quando foi
  enviada (`createdAt`) e quando foi concluída (`completedAt`, marcado
  sozinho ao mover o card pra uma coluna "concluído").

Serve pra não perder pendência delegada no meio do trabalho — o pedido
original foi justamente esse: "toda vez que ele entrar, vai aparecer
alerta [...] isso cria um histórico de trabalho e hora de envio e hora de
execução".

## 10. Estrutura do projeto

```
prisma/schema.prisma       modelo de dados (User, Item, Column, SectorAccess, GmailConnection, TrayConnection)
prisma/seed.ts              cria o usuário inicial
src/auth.ts                  configuração do NextAuth (credentials)
src/proxy.ts                  protege as rotas (redireciona pra /login)
src/lib/gmail.ts              OAuth + sincronização do Gmail
src/lib/tray.ts               OAuth + client REST da Tray Commerce
src/lib/crypto.ts             criptografia de tokens (AES-256-GCM) — Gmail e Tray
src/lib/columns.ts            colunas padrão criadas sob demanda por categoria
src/lib/anthropic.ts          ditado inteligente (Claude API)
src/lib/sectors.ts            setores da aba BFF Fitness (nomes/descrições/ícones)
src/lib/sectorStatus.ts       paleta do semáforo (verde/amarelo/vermelho/sem-dado)
src/lib/permissions.ts        quem vê qual setor (admin = tudo, membro = SectorAccess)
src/components/EmpresaHub.tsx  visual de rede/central de comando da Visão Central
src/app/painel/                painel pessoal (Kanban)
src/app/empresa/                Visão Central + detalhe de cada setor (BFF Fitness)
src/app/admin/usuarios/        criar usuário e marcar acesso por setor
src/app/conectar-gmail/        tela de conexão com o Gmail
src/app/conectar-tray/         tela de conexão com a Tray (admin-only)
src/app/api/items/             CRUD de pendências + ditado inteligente + atribuição
src/app/api/columns/           CRUD de colunas do Kanban (própria + de quem você atribui)
src/app/api/admin/users/       CRUD de usuários e acesso por setor
src/app/api/gmail/             conectar/sincronizar/desconectar Gmail
src/app/api/tray/              conectar/status/desconectar Tray
src/app/api/cron/sync-gmail/   endpoint chamado pelo cron da Vercel
vercel.json                    agenda do cron (a cada hora)
```

## Decisões em aberto

- **Domínio/subdomínio exato** a usar em produção.
- **Notificação por e-mail/WhatsApp** quando algo fica atrasado — fora do
  escopo da Fase 1, mas o modelo de dados já suporta adicionar depois
  (basta um novo cron olhando `Item.due` e `Column.isDone`).
- **Testar o login da Tray de ponta a ponta** — código pronto (ver seção 8),
  mas o clique de autorização precisa de um navegador de verdade com HTTPS;
  fica pra quando o app for publicado (ou testado por túnel).
- **Números-alvo dos semáforos** de cada setor (margem mínima, teto de
  taxa de cartão, dias de caixa seguros, dias sem comprar = cliente
  "sumido", teto de frete por estado) — nascem como campos configuráveis,
  não fixos no código; o usuário sobe os valores depois.
- **Histórico pra tendência** (reclamação crescendo, recorrência caindo)
  — precisa de snapshots periódicos; ainda não implementado.
- **Fontes sem sistema hoje** — produção/fábrica, fornecedores, funil da
  estilista (Desenvolvimento de Produto): entram por planilha ou
  lançamento manual no próprio painel; a decidir qual.
- **E-mail da BFF** (setor Suporte) — conexão separada do Gmail pessoal já
  conectado; ainda não implementada.
