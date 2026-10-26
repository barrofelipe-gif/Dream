# Facebook (Páginas) no publicador

Publica em Páginas do Facebook (texto/link, foto, várias fotos e vídeo). Graph API v23.0.

## O que já está pronto no código

- `src/lib/social/facebook.ts`: adaptador (publicar, validar, limites, pendências).
- `/api/social/facebook/conectar?loja=bff|moranga`: inicia o login (só admin).
- `/api/social/facebook/callback`: troca o código, gera token de longa duração, lista as Páginas e salva cada uma como conta (token DA PÁGINA, criptografado). Se a Página tem Instagram vinculado, o id vai em `extra.instagramId`.
- Escopos pedidos: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `pages_manage_engagement`.

## Passo a passo para o Felipe

1. Variáveis de ambiente no servidor (Vercel): `FB_APP_ID` = 750653427044489 e `FB_APP_SECRET` = a chave secreta do app (Meta for Developers > app "Bff Fitness Atacado" > Configurações > Básico). Nunca cole a chave em chat ou no código. Faça novo deploy depois.
2. No painel do app, adicione o produto **Login do Facebook para Empresas** (ou "Facebook Login").
3. Em Login do Facebook > Configurações, em **URIs de redirecionamento do OAuth válidos**, adicione: `https://SEU-DOMINIO/api/social/facebook/callback` (o mesmo domínio do painel; sem barra no final).
4. Entre no painel do publicador logado como admin e clique em conectar Facebook para a loja. Na tela do Facebook, escolha **as Páginas** que quer liberar e aceite todas as permissões.
5. Pronto: cada Página aparece como conta. Reconectar é seguro (atualiza a mesma conta).

## Permissões: o que precisa de revisão (App Review)

| Permissão | Para quê | Sem revisão? |
|---|---|---|
| `pages_show_list` | listar as Páginas | Sim, para quem é admin/desenvolvedor/testador do app |
| `pages_manage_posts` | publicar | Sim, só para contas com função no app (você). Para terceiros: exige revisão |
| `pages_read_engagement` | ler a Página e o que acontece nela | Idem |
| `pages_manage_engagement` | responder/moderar comentários (fase 2) | Idem |

Em **modo Desenvolvimento**, quem tem função no app (administrador, desenvolvedor, testador) usa todas as permissões sem revisão, em Páginas que administra. Como as Páginas são suas (BFF e Moranga), isso basta para começar. Atenção: se o app estiver em modo Desenvolvimento, as publicações podem ser visíveis só para quem tem função no app; para ficarem públicas, coloque o app em modo **Ativo/Live** (exige política de privacidade e ícone) e, se a Meta pedir, a revisão abaixo. Se a Página pertencer a um Portfólio Empresarial, o app pode precisar de Verificação da Empresa para acesso avançado.

### Texto pronto para a solicitação de revisão

> Nosso app é uma ferramenta interna de gestão de redes sociais de duas lojas de moda fitness e praia (BFF Fitness Atacado e Moranga Biquínis). Os administradores das Páginas conectam as próprias Páginas via Login do Facebook. **pages_show_list**: listamos as Páginas que o administrador gerencia para ele escolher onde publicar. **pages_manage_posts**: o administrador escreve a legenda, escolhe fotos ou vídeo e agenda ou publica na Página; o app só publica conteúdo criado por ele, nunca de terceiros. **pages_read_engagement**: lemos dados básicos da Página e o status das publicações para mostrar se saíram corretamente. **pages_manage_engagement**: o administrador responde, no painel, aos comentários feitos nas publicações da própria Página. Não vendemos nem compartilhamos dados. Passo a passo para testar: entrar no painel, abrir Redes, clicar em conectar Facebook, escolher a Página, criar uma postagem e publicar. (Anexar vídeo curto de 1 a 2 minutos mostrando esse fluxo.)

## Limites e comportamento

- Texto até 63.206 caracteres. Carrossel = 2 a 10 fotos (fotos não publicadas + `attached_media`). Vídeo por `file_url` (endereço público https).
- Token de Página vindo de token de usuário de longa duração não expira, mas cai se o usuário trocar a senha, sair da função de admin ou remover o app. Aí o erro é "acesso venceu ou foi revogado": reconectar.
- Erros da Graph API são traduzidos (token, permissão, Página sem acesso, limite de publicação).

## Não testado ainda

Nada foi chamado na Meta (sem credenciais). Só validação de tipos. O primeiro teste real deve ser uma postagem de texto numa Página de teste.

## Fase 2: comentários (NÃO implementada)

- **Ler comentários**: `GET /{post-id}/comments` (e `/{page-id}/feed` para listar posts). Exige `pages_read_engagement`.
- **Responder em público**: `POST /{comment-id}/comments` com `message`. Exige `pages_manage_engagement` (e `pages_read_engagement`).
- **Moderar**: `POST /{comment-id}` com `is_hidden=true` esconde; `DELETE /{comment-id}` apaga; curtir via `POST /{comment-id}/likes`.
- **Resposta privada (private reply)**: `POST /{page-id}/messages` com `recipient={"comment_id":"<id>"}`, `message={"text":"..."}`, `messaging_type=RESPONSE`. Exige `pages_messaging` (revisão) e que a Página tenha o app inscrito. Regras: uma resposta privada por comentário, em até 7 dias após o comentário. Depois que o cliente responde, abre-se a janela normal de 24 h para conversa.
- **Webhooks**: no produto Webhooks do app, objeto **Page**, assinar o campo `feed` (comentários chegam com `item=comment`, `verb=add`; também curtidas, posts) e, para conversa por mensagem, `messages` (e opcionalmente `messaging_postbacks`). Inscrever cada Página: `POST /{page-id}/subscribed_apps?subscribed_fields=feed,messages` com o token da Página. O verify token e o endpoint seguem o padrão do webhook do Instagram já existente.
- Permissões novas a pedir na revisão: `pages_messaging` (para private reply).

## Pedido de mudança no contrato

Nenhum por enquanto. Sugestão futura: o painel poder passar `opcoes.link` para postagens de texto com link (já suportado pelo adaptador).
