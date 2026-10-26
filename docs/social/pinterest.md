# Pinterest no publicador

O que o código faz: conecta a conta (OAuth), lista os quadros e cria pins (imagem, carrossel de 2 a 5 imagens e vídeo).
Arquivos: `src/lib/social/pinterest.ts` e `src/app/api/social/pinterest/{conectar,callback,boards}`.

## Passo a passo para o Felipe

1. Entre em https://developers.pinterest.com com a conta Pinterest **comercial** de cada loja (ou uma conta sua que administre os perfis) e clique em **My apps > Connect app**.
2. Preencha nome do app, descrição (veja o texto pronto abaixo), site e **política de privacidade** (precisa abrir publicamente num domínio da empresa; o Pinterest recusa sem isso).
3. Em **Redirect URIs**, cadastre exatamente (troque pelo domínio real do painel, sem barra no final):
   `https://SEU-DOMINIO/api/social/pinterest/callback`
4. Copie o **App ID** e o **App secret** e coloque na Vercel (nunca no chat): `PINTEREST_APP_ID` e `PINTEREST_APP_SECRET`.
5. Enquanto o app estiver só com acesso **Trial**, ligue também `PINTEREST_SANDBOX=1`. Com isso os pins são criados na API de testes e NÃO aparecem no Pinterest de verdade.
6. No painel, clique em conectar Pinterest (`/api/social/pinterest/conectar?loja=bff` ou `moranga`) logado como admin.
7. Escolha o quadro pela rota `/api/social/pinterest/boards?contaId=...` (o painel deve chamar essa rota para montar a lista).
8. Peça o acesso **Standard** (abaixo). Quando aprovado, **remova** `PINTEREST_SANDBOX` e reconecte a conta.

## O que foi confirmado na documentação / fontes

- Autorização: `https://www.pinterest.com/oauth/` com `client_id`, `redirect_uri`, `response_type=code`, `scope` (separados por vírgula) e `state`.
- Token: `POST https://api.pinterest.com/v5/oauth/token`, autenticação Basic (app id:secret), `grant_type=authorization_code` + `code` + `redirect_uri`. Renovar: `grant_type=refresh_token`. `continuous_refresh=true` deixa o refresh token renovável de forma contínua.
- Escopos usados: `boards:read`, `pins:read`, `pins:write`, `user_accounts:read` (escopo `boards:write` existe, não usamos).
- `POST /v5/pins`: `board_id`, `title` (até 100), `description` (até 800), `link` (até 2048), `alt_text` (até 500), `media_source` com `source_type` = `image_url` (`url`), `multiple_image_urls` (`items`, 2 a 5) ou `video_id` (`media_id`, opcional `cover_image_url`).
- Vídeo: `POST /v5/media {media_type:"video"}` devolve `media_id`, `upload_url`, `upload_parameters`; envia-se multipart (parâmetros + campo `file`, sem Authorization); acompanhar `GET /v5/media/{id}` até `succeeded` (estados: registered, processing, succeeded, failed).
- Trial: pins criados se comportam como pins de sandbox e só são lidos por ID (não aparecem listados). Standard: libera pins em produção e limites maiores.
- Fontes consultadas: central da comunidade Pinterest (FAQ da API), guias de integração (postproxy.dev, bundle.social). A documentação oficial em developers.pinterest.com é renderizada por JavaScript e não pôde ser lida automaticamente.

### Incertezas que precisam de teste real (não deu para testar sem credenciais)
- Tempo de vida exato dos tokens (fontes dizem ~30 dias o acesso e ~60 dias o refresh; o código usa o `expires_in` devolvido).
- Se o sandbox exige o token gerado pela própria API sandbox (o código usa o host sandbox também no `/oauth/token` quando `PINTEREST_SANDBOX=1`; se o Pinterest recusar, gerar o token sandbox pela página do app e ajustar).
- Forma exata de cada item do carrossel (usamos `{url, link}`; a doc oficial também aceita `title` e `description` por item).
- Relatos de erro 401 em vídeo durante o Trial e erro "consumer type not supported" enquanto o acesso está pendente.

## Pedido do acesso Standard

**Texto pronto (inglês, que é o idioma do formulário):**

> Our app, "BFF Publisher", is an internal tool used by two Brazilian apparel businesses (BFF Fitness Atacado, wholesale activewear, and Moranga Biquínis, swimwear) to schedule and publish their own product content to their own Pinterest business accounts. A store administrator signs in, connects the store's Pinterest account through the official OAuth 2.0 flow, chooses one of the account's boards, and publishes image, carousel or video Pins with a title, description, alt text and a destination link to the store's product pages. We request the scopes user_accounts:read (to show which account is connected), boards:read (to let the admin choose a board), pins:write (to create Pins) and pins:read (to confirm the created Pin). We only access accounts owned by the businesses that authorize the app, we never collect Pinterest passwords, and tokens are stored encrypted server-side. We do not use Pinterest data for advertising, resale or any purpose other than publishing content the account owner created.

**Roteiro do vídeo de demonstração (2 a 3 minutos, gravação de tela com a integração real, sem wireframes):**

1. Mostrar o painel do publicador logado como administrador e a URL do domínio.
2. Clicar em "Conectar Pinterest": mostrar a tela de autorização do Pinterest (domínio pinterest.com), os escopos pedidos e clicar em Permitir. Deixar visível que nenhuma senha é digitada no app.
3. Voltar ao painel mostrando a conta conectada (nome do perfil).
4. Abrir a lista de quadros carregada da API e escolher um.
5. Montar uma publicação: imagem, título, descrição, texto alternativo e link de destino. Publicar.
6. Abrir o Pinterest (conta de teste/sandbox) e mostrar o pin criado (ou, no Trial, a resposta com o id do pin).
7. Repetir rapidamente com um carrossel e, se possível, um vídeo.
8. Mostrar como desconectar a conta.

Antes de enviar: faça algumas chamadas de teste no Trial (o Pinterest recomenda), tenha a política de privacidade pública e o app com descrição completa. O pedido é negado se o vídeo não mostrar o login/OAuth real ou a integração ao vivo.

## Pedidos de mudança no contrato

Nenhum por enquanto. Sugestão para o painel: expor `opcoes` do Pinterest como `boardId` (obrigatório), `titulo`, `link`, `altTexto`; a descrição vem da legenda.

## Fase 2: comentários e engajamento por API

Verdade sobre as limitações:
- A API v5 permite **ler** dados dos seus pins e analytics (`pins:read`, `GET /pins/{id}/analytics`, impressões, salvamentos, cliques) com a conta autorizada. Isso é viável.
- **Comentários de pins: a API v5 pública não oferece listar, ler nem responder comentários** (até onde foi possível confirmar; não vi endpoint de comentários na referência pública). Responder comentários automaticamente, como no Instagram, provavelmente não é possível; fazer isso por automação de navegador viola os termos e arrisca o perfil.
- Também não há webhooks de engajamento para apps comuns.
- O que dá para entregar: painel de desempenho por pin (impressões, saves, cliques no link) puxado por polling, e relatório por quadro. Requer Standard para dados de pins de produção.
- Confirmar o ponto dos comentários na referência oficial (https://developers.pinterest.com/docs/api/v5/) antes de prometer qualquer coisa.
