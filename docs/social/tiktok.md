# TikTok no publicador

Conferido na documentação oficial (developers.tiktok.com) em 26/10/2026: Login Kit (authorize, oauth/token, revoke), Content Posting API (creator_info, video init, photo init, status fetch, media transfer guide, get started).

## O que está pronto no código

- `src/lib/social/tiktok.ts`: adaptador (publicar vídeo e fotos, validar, limites, pendências, renovar).
- `/api/social/tiktok/conectar?loja=bff|moranga` e `/api/social/tiktok/callback`: login do TikTok (só admin).
- Variáveis de ambiente (você cria, eu nunca vejo): `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`. Opcionais: `TIKTOK_REDIRECT_URI` (se quiser fixar o endereço de retorno) e `TIKTOK_APP_AUDITADO=1` (só depois da auditoria aprovada).
- Escopos pedidos: `user.info.basic`, `video.publish`, `video.upload`. Login de app web não exige PKCE (só mobile/desktop), por isso só usamos `state` em cookie.
- Tokens: acesso dura 24 horas, renovação dura 365 dias. O `renovar` troca o token de acesso e guarda o refresh token novo se a TikTok mandar outro. Quem agenda deve chamar `renovar` antes de publicar (ele só renova se faltar menos de 6 h).
- Sem `TIKTOK_APP_AUDITADO=1` o adaptador FORÇA `SELF_ONLY` (só você vê), ignorando a privacidade pedida. Com auditoria, aceita `opcoes.privacidade` (PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, FOLLOWER_OF_CREATOR, SELF_ONLY), limitada ao que a conta permite (consulta `creator_info`).
- Outras opções em `opcoes`: `desativarComentarios`, `desativarDuo`, `desativarStitch`, `musicaAutomatica` (fotos).
- Vídeo: tenta `PULL_FROM_URL`; se a TikTok responder `url_ownership_unverified`, baixa o arquivo e envia em partes (`FILE_UPLOAD`). Fotos só existem por URL (sem plano B): domínio verificado é obrigatório.
- Limites: legenda de vídeo 2.200; fotos: título 90, descrição 4.000, até 35 imagens JPEG/WebP de até 20 MB; vídeo MP4/MOV/WebM, até 4 GB, 23 a 60 fps, 360 a 4096 px, até 10 min (o limite real é por conta, em `max_video_post_duration_sec`). Limite de requisições: 6 inícios de post por minuto por usuário.

## Passo a passo para você

1. Entre em https://developers.tiktok.com com a conta da empresa e clique em Manage apps, Connect an app.
2. Preencha nome, ícone (1024x1024), categoria, descrição, URL dos Termos de Uso e da Política de Privacidade (do site do app).
3. Em Products, adicione **Login Kit** e **Content Posting API** (ative a opção **Direct Post**). Escopos: `user.info.basic`, `video.publish`, `video.upload`.
4. Em Login Kit, Redirect URI: coloque exatamente `https://SEU-DOMINIO/api/social/tiktok/callback` (https, sem parâmetros, sem `#`). Troque SEU-DOMINIO pelo endereço real do app.
5. Verifique o domínio das mídias (Manage apps, URL properties): adicione o domínio onde ficam os arquivos (o endereço público das fotos e vídeos do publicador) e crie o registro DNS (TXT) que o TikTok mostrar. Vale o domínio e subdomínios. A URL da mídia precisa ser https e não pode redirecionar. Se as mídias ficam num domínio que você não controla (ex: o do armazenamento), use um domínio seu apontando para lá.
6. Copie Client key e Client secret para as variáveis `TIKTOK_CLIENT_KEY` e `TIKTOK_CLIENT_SECRET` na Vercel e redeploy.
7. Enquanto o app está em "Sandbox/não auditado", adicione sua conta em Target Users (Sandbox) se pedir, **deixe a conta do TikTok privada** e conecte pelo painel (`urlConectar`).
8. Teste uma postagem: sairá em modo privado. Isso é o esperado até a auditoria.
9. Peça a auditoria (texto abaixo) em Manage apps, Content Posting API, Apply for audit. Aprovada, defina `TIKTOK_APP_AUDITADO=1`.

## Pedido de AUDITORIA

Pontos que a TikTok costuma exigir: o usuário vê e escolhe a privacidade, vê as opções de comentário/duet/stitch, o nome da conta que vai postar, e é avisado antes de publicar; nada é publicado sem ação do usuário; nenhuma marca d'água de terceiros. **Atenção**: o adaptador hoje usa a privacidade vinda do painel; a tela de composição do painel precisa mostrar o seletor de privacidade (valores de `creator_info`) e o aviso de música/conteúdo de marca para passar na revisão. Sem isso a auditoria costuma ser reprovada (pedido de mudança de contrato abaixo).

### Texto pronto (inglês, que é o idioma do formulário)

> App: Dream Review Social Publisher. Internal publishing tool used by two Brazilian apparel businesses (BFF Fitness Atacado, fitness wholesale; Moranga Biquinis, swimwear) to publish their own brand content to their own TikTok business accounts. We use Login Kit (user.info.basic) to connect the business owner's own TikTok account and Content Posting API Direct Post (video.publish, video.upload) to publish product videos and photo posts that the owner prepared in our dashboard.
> Flow: the signed-in administrator connects the TikTok account with OAuth; in the composer he uploads a video or photos and writes the caption; the app queries creator_info and shows the account nickname, the allowed privacy options (the user must choose one, there is no default), and the comment, duet and stitch toggles; the user then clicks Publish. Content is never posted without an explicit click; no automated posting without the user's preparation, no scraping, no reposting of other people's content. We do not store user videos beyond the time needed to publish, tokens are encrypted at rest, and the user can disconnect at any time. Media is served from our verified domain (URL ownership verified in the developer portal). Expected volume: under 10 posts per day.

### Roteiro do vídeo de demonstração (2 a 3 min, tela real do app em produção, sem cortes)

1. Mostre o app abrindo no painel de redes sociais, conta TikTok desconectada (0:00 a 0:15).
2. Clique em Conectar TikTok: tela de autorização da TikTok com os 3 escopos, aceite; volta ao painel com o nome da conta conectada (0:15 a 0:45).
3. Crie uma postagem: envie um vídeo e escreva a legenda (0:45 a 1:15).
4. Mostre os campos que vêm da TikTok: nome da conta, seletor de privacidade (sem valor pré-marcado), interações (comentário, duet, stitch) e a declaração sobre conteúdo de marca (1:15 a 1:50).
5. Clique em Publicar, mostre o acompanhamento do status até "publicado" (1:50 a 2:20).
6. Abra o TikTok e mostre o post publicado na conta (2:20 a 2:50).
7. Mostre onde desconectar a conta (2:50 a 3:00). Fale (ou legende) o que cada permissão faz.

## Fase 2: comentários

A verdade, com o que a TikTok oferece hoje:

- Conta comum / criador (a que a BFF e a Moranga têm): **não existe API pública para ler ou responder comentários**. Login Kit, Display API e Content Posting API não trazem comentários. A Research API lê comentários públicos, mas é só para pesquisadores acadêmicos e sem resposta.
- Conta **TikTok Business** (API for Business / Business API, app e aprovação separados do developers.tiktok.com): há endpoints de comentários (listar, responder, ocultar, excluir) para contas de negócio vinculadas a um app aprovado. Exige conta Business, app no portal Business e aprovação de escopos; o fluxo é diferente do Login Kit usado aqui. Não confirmei os endpoints atuais nesta rodada (a página não foi lida), então trate como caminho a verificar antes de prometer.
- Alternativas sem API: responder no próprio app do TikTok (ou TikTok Studio), ou ferramentas aprovadas de terceiros.
- Recomendação: não construir a fase 2 do TikTok até a conta virar Business e você aprovar o app Business. Instagram e YouTube cobrem comentários com mais segurança.

## Pedidos de mudança de contrato (para quem cuida do painel/tipos)

- O compositor precisa de um seletor de privacidade para TikTok alimentado por `creator_info` (hoje só se descobre ao publicar). Sugestão: método opcional `RedeAdapter.opcoesConta?(conta)` devolvendo privacidades permitidas e flags de comentário/duet/stitch.
- `opcoes` usadas: `privacidade`, `desativarComentarios`, `desativarDuo`, `desativarStitch`, `musicaAutomatica`.
- A conta salva fica com `username` vazio (só `display_name`); o @ só vem com o escopo `user.info.profile` (não pedido). Se o painel precisar do @, adicionar o escopo e o campo `username` em `fields`.
- `renovar` precisa ser chamado pelo agendador/publicar antes de usar o token (24 h).

## Não testado

Nada foi executado contra a TikTok (sem credenciais). Pontos que só se confirmam com o app real: formato exato do `PUT` do envio em partes, se `unaudited` bloqueia contas públicas mesmo com SELF_ONLY, e `publicaly_available_post_id` (só vem após moderação, em modo privado vem vazio e usamos o `publish_id`).
