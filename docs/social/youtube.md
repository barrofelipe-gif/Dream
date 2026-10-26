# YouTube no publicador

Publica vídeos (e Shorts) nos canais da BFF e da Moranga pela YouTube Data API v3.
Código: `src/lib/social/youtube.ts`, rotas `src/app/api/social/youtube/conectar` e `callback`.

## O que está pronto

- Conectar o canal por OAuth do Google (`/api/social/youtube/conectar?loja=bff|moranga`), só administrador.
- Renovação automática do acesso (o token dura 1 hora; o refresh token fica criptografado no banco).
- Envio de vídeo por upload retomável, a partir da URL do vídeo, em blocos de 8 MiB.
- Título (até 100), descrição (legenda, até 5.000), privacidade, categoria, tags, Shorts, "feito para crianças", notificar inscritos.
- Miniatura (`thumbnails.set`) quando houver capa; se o canal não puder (não verificado), segue sem ela.

Opções aceitas em `opcoes` da postagem do YouTube:

| opção | valores | padrão |
|---|---|---|
| `privacyStatus` | `public`, `unlisted`, `private` | `public` |
| `categoryId` | id da categoria do YouTube (ex.: `22` Pessoas e blogs, `26` Estilo, `24` Entretenimento) | `22` |
| `tags` | lista ou texto separado por vírgula (até 500 caracteres no total) | nenhuma |
| `shorts` | `true` acrescenta `#Shorts` na descrição e no título (se couber) | `false` |
| `madeForKids` | `true`/`false` | `false` |
| `notifySubscribers` | `false` para não avisar inscritos | avisa |

Shorts: o YouTube trata como Short o vídeo vertical (ou quadrado) de até 3 minutos. Não existe campo "Short" na API: basta o formato certo e a hashtag `#Shorts`.

## Passo a passo no Google Cloud (para o Felipe)

Use o mesmo projeto do Gmail (as variáveis `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` já existem na Vercel).

1. Acesse console.cloud.google.com e escolha o projeto do painel.
2. Menu "APIs e serviços" > "Biblioteca" > procure **YouTube Data API v3** > **Ativar**.
3. "APIs e serviços" > "Tela de consentimento OAuth" > em "Escopos", adicione:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
4. "Credenciais" > abra o cliente OAuth (tipo "Aplicativo da Web") > em "URIs de redirecionamento autorizados" adicione:
   - `https://SEU-DOMINIO-DO-PAINEL/api/social/youtube/callback`
   - (para testar localmente) `http://localhost:3000/api/social/youtube/callback`
5. **Publique o app** (tela de consentimento > "Publicar app" / status "Em produção"). Enquanto estiver em modo **Teste**, o Google expira o refresh token em **7 dias** e o painel pede para reconectar toda semana. Como o escopo de upload é "sensível", o Google pedirá verificação do app (texto pronto abaixo); até a aprovação, o app em produção mostra a tela "app não verificado" (dá para clicar em Avançado e continuar, limite de 100 usuários, que basta aqui).
6. No painel: Redes sociais > YouTube > Conectar. Na tela do Google, escolha o **canal certo** (se o canal for de marca, aparece a lista de canais) e deixe todas as caixas marcadas.
7. Peça a auditoria da API (texto abaixo). Enquanto o projeto de API não for auditado, **todo vídeo enviado fica PRIVADO** (restrição do YouTube para projetos criados depois de 28/07/2020). O vídeo sobe, mas precisa ser tornado público manualmente no YouTube Studio.

## Limitações importantes

- **Tempo da função (Vercel plano gratuito é curto).** O envio acontece dentro de uma chamada só. Por isso há dois limites, ajustáveis por variável de ambiente:
  - `YOUTUBE_MAX_UPLOAD_MB` (padrão 80): vídeo maior que isso é recusado com mensagem clara.
  - `YOUTUBE_UPLOAD_BUDGET_S` (padrão 50): se o envio passar desse tempo, para com erro claro.
  - A função que chama a publicação (rota de postar/agendar/cron, fora destes arquivos) deve exportar `maxDuration` (até 60 s no gratuito; mais com Fluid Compute/plano pago). O adaptador não consegue definir isso sozinho. **Pedido de contrato:** se quiser vídeos grandes, a rota que chama `publicarPost` precisa de `export const maxDuration = 300` ou de uma fila que continue o upload (precisaria guardar a URL da sessão retomável em algum campo do alvo; hoje o contrato não tem onde guardar).
- Vídeo vem de URL pública que informe `Content-Length` (o Vercel Blob informa).
- Miniatura personalizada exige canal verificado por telefone.
- O refresh token também some se o Felipe revogar o acesso ou ficar 6 meses sem uso.

## Cota da API (confira no Google Cloud > Cotas)

Na documentação atual (histórico de revisões): desde 04/12/2025 o upload custa cerca de **100 unidades** (antes ~1.600) e, desde 01/06/2026, `videos.insert` tem balde de cota próprio. O padrão é 10.000 unidades por dia. Se o seu projeto ainda mostrar 1.600 por upload, são cerca de 6 vídeos por dia; confira o painel antes de agendar muitos vídeos.

Outros custos: `channels.list` 1, `thumbnails.set` 50, `commentThreads.list` 1, `comments.insert` 50.

## Textos prontos

### Pedido de verificação do app (tela de consentimento)

> Nosso aplicativo é um painel interno de gestão de redes sociais de duas lojas de moda brasileiras (BFF Fitness Atacado e Moranga Biquínis). Ele permite que os administradores da própria empresa publiquem vídeos nos canais do YouTube que a própria empresa possui. Escopo `youtube.upload`: necessário para enviar os vídeos de divulgação de produtos (videos.insert) e a miniatura. Escopo `youtube.readonly`: usado apenas para identificar qual canal o administrador conectou (channels.list com mine=true) e exibir o nome do canal. Não usamos dados do YouTube para publicidade, não vendemos nem compartilhamos dados, não acessamos canais de terceiros e só administradores autorizados usam o painel. Os tokens ficam criptografados no nosso banco e o acesso pode ser revogado a qualquer momento. Política de privacidade: [URL DA POLÍTICA]. Vídeo de demonstração: [LINK DO VÍDEO NÃO LISTADO mostrando a tela de consentimento, a conexão do canal e a publicação de um vídeo].

### Pedido de auditoria e aumento de cota (YouTube API Services - Audit and Quota Extension Form)

> Empresa: [RAZÃO SOCIAL], CNPJ [CNPJ], site [URL]. Projeto do Google Cloud: [ID DO PROJETO]. Uso: ferramenta interna, de uso exclusivo da nossa empresa, para publicar vídeos de divulgação (incluindo Shorts) nos nossos próprios canais do YouTube (BFF Fitness Atacado e Moranga Biquínis), junto com outras redes sociais. Métodos usados: videos.insert (upload retomável), thumbnails.set e channels.list (mine=true). Não coletamos dados de espectadores, não exibimos dados do YouTube a terceiros, não armazenamos conteúdo do YouTube além do id e do link do vídeo que nós mesmos publicamos, e não usamos os dados para publicidade. Cumprimos os Termos de Serviço dos Serviços de API do YouTube e a Política de Privacidade do Google. Os tokens OAuth ficam criptografados; qualquer administrador pode revogar o acesso em myaccount.google.com/permissions e pelo painel. Volume previsto: de 3 a 10 vídeos por dia somando os dois canais (cota padrão de 10.000 unidades é suficiente na maior parte do tempo; pedimos a auditoria principalmente para que os vídeos enviados pela API deixem de ficar restritos ao modo privado). Pedimos: (1) conclusão da auditoria de conformidade, removendo a restrição de vídeos privados em projetos não verificados; (2) se aplicável, aumento de cota para [X] unidades por dia. Contato: [E-MAIL]. Vídeo de demonstração: [LINK].

Onde enviar: formulário "YouTube API Services - Audit and Quota Extension Form" (procure por esse nome em developers.google.com/youtube/v3/guides/quota_and_compliance_audits). A resposta pode levar semanas; guarde o e-mail de confirmação.

## Fase 2: comentários (NÃO implementado)

Para ler e responder comentários dos vídeos:

- Escopo extra: `https://www.googleapis.com/auth/youtube.force-ssl`. Precisa estar na tela de consentimento e o canal tem de ser reconectado (nova autorização).
- Listar comentários dos vídeos do canal: `GET /youtube/v3/commentThreads?part=snippet,replies&allThreadsRelatedToChannelId=ID_DO_CANAL` (ou `videoId=...`), com `maxResults` até 100 e `pageToken`. Custo: **1 unidade** por chamada.
- Responder: `POST /youtube/v3/comments?part=snippet` com `snippet.parentId` = id do comentário principal e `snippet.textOriginal` = resposta. Custo: **50 unidades**.
- Comentário novo no vídeo: `POST /youtube/v3/commentThreads?part=snippet`. Custo: 50 unidades.
- Moderar/ocultar: `comments.setModerationStatus` (50 unidades).
- Não há webhook de comentários no YouTube: precisa de consulta periódica (cron). Com 10.000 unidades por dia, 100 respostas custam 5.000; listar a cada 15 minutos custa ~96 unidades por dia.

## O que não foi testado

Nada foi testado de ponta a ponta: não há credenciais do Google nem canal de teste neste ambiente. Foi verificado apenas que o código compila (`npx tsc --noEmit`). Ao conectar o primeiro canal, publique um vídeo curto como `private` para validar o fluxo.

## Fontes confirmadas na documentação do Google

- Upload retomável (sessão via `Location`, blocos múltiplos de 256 KB, `Content-Range`, 308/200/201): developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- Custos de cota: developers.google.com/youtube/v3/determine_quota_cost e histórico de revisões (04/12/2025 e 01/06/2026)
- Restrição de vídeos privados para projetos não verificados (28/07/2020): developers.google.com/youtube/v3/revision_history
- `videos.insert` (escopos, categoryId, limites): developers.google.com/youtube/v3/docs/videos/insert
