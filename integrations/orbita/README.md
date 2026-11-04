# Órbita no Growth

Versão 0.18.1. Entrada: `/areas/growth/papeis/instagram#crescimento`.

Patch opcional do leitor do Radar para barras planas de ícones/contagens. O painel aceita a extensão 0.18.0 ou posterior; o mínimo de conexão e suas mensagens permanecem 0.18.0. Comandos, permissões e comportamento de fila não mudaram neste patch.

O componente `InstagramOrbita` oferece a entrada para `/api/growth/orbita/painel`, um painel completo no mesmo app e login, com link de volta ao Growth. A entrada não depende de iframe; uma falha de recarga observada na incorporação motivou essa escolha. HTML, JavaScript, CSS, ícone, download e verificação de sessão exigem o login de administrador. A regra específica do Next permite iframe somente do próprio app; o restante mantém os cabeçalhos existentes. `outputFileTracingIncludes` inclui explicitamente os arquivos da integração no pacote serverless. Nenhuma tabela, credencial ou variável de ambiente nova.

Os arquivos compilados ficam em `assets/`, fora de `public/`, e são servidos por uma lista fixa no Route Handler. O painel hospedado usa um bundle único esbuild, sem import dinâmico de chunks externos. `setup.css` pertence à integração do app. O código-fonte completo da Órbita acompanha a pasta em `orbita-codigo-fonte-0.18.1.zip`; para atualizar, extraia em um checkout separado, instale com `npm ci` e execute `npm test` e `npm run build`. Copie `dist/hosted.js`, `dist/hosted.css`, `public/orbita.svg` e o ZIP da extensão para `assets/`. Atualize juntos a versão e a lista de arquivos em `src/lib/orbita-hosting.ts`.

## Funcionamento e limites do teste

- O usuário escolhe explicitamente extensão ou modo manual antes de ler os dados. A atualização opcional 0.18.1 é instalada ou recarregada pelo usuário no Chrome/Edge; a extensão 0.18.0 continua aceita. Não é uma instalação pela Chrome Web Store.
- O conector é um content script em mundo isolado, restrito aos dois hosts HTTPS e à rota exata do painel; não há `externally_connectable`. Confere a sessão do app antes de cada mensagem. O worker também valida o remetente, a conta ativa e os controles já existentes de execução.
- `chrome.storage.local` continua em `TRUSTED_CONTEXTS`. O conector envia somente avisos após confirmações. Leituras locais periódicas, a cada 15 segundos com o painel visível, refletem alarmes e alterações no painel nativo; não consultam o Instagram nem repetem ações.
- A conexão usa as contas e os dados da extensão deste navegador. Não inicia a fila, não verifica por si só a sessão Instagram e não altera avisos/tentativas consumidas. Uma conta executa por vez. O @ selecionado na Órbita é independente da empresa selecionada no atendimento do app.
- O Ciclo de prospecção começa desativado. Prazo e política exigem escolha explícita; o vencimento apenas organiza a revisão. A fila distingue seguir/deixar de seguir e compartilha teto, intervalo e lote. O worker exige a seleção exata de IDs/ações para iniciar unfollow. A validação do clique de deixar de seguir usou somente DOM fictício; nenhuma relação real foi alterada por esse teste.
- Capas de publicações vêm de `thumbnail_url`/`media_url` de imagem já salvos na coleta, com as CDNs HTTPS existentes. Reimportar o mesmo relatório enriquece capas sem criar outra medição; ID/data/métricas existentes são preservados. Arquivos de vídeo não são usados como capa e falhas de imagem têm fallback visível.
- Campanhas por perfil agrupam seguidores, comentários e curtidas preservando fontes separadas. A leitura da própria rede usa somente nomes carregados da conta confirmada e salva uma medição parcial; não comprova ausência. Os estados sem dados orientam quais medições faltam, sem estimar clientes ou atribuir canais desconhecidos.
- A conferência explícita de um follow incerto apenas lê o estado observado no Instagram, com data/conta/origem separadas. Não comprova a ação original nem habilita unfollow. Não seguindo permite retorno manual à revisão com confirmação explícita; Seguindo/Solicitado não permitem. Tentativas consumidas são preservadas e a leitura não retoma o lote.
- O modo manual usa chaves por usuário e navegador. Recusa escopo ausente. Não sincroniza entre computadores, não coleta e não executa ações. Isso não equivale a criptografia dos dados locais.
- A sessão do app é verificada na abertura, ao retornar à aba e periodicamente. Redirecionamento, resposta inválida ou falha de verificação bloqueiam a tela e pedem reabertura. Dados locais são preservados; o controle da fila continua na extensão.
- Insights oficiais automáticos, atribuição individual de anúncio e tendências globais não foram implementados por esta publicação. As integrações existentes de atendimento e publicação do app permanecem separadas.

## Validação

`node --import tsx --test tests/orbita-hosting.test.ts` confere o HTML/CSP, o escopo e a lista de arquivos. `npm run build` confere o app completo. Os testes de navegador da integração usam sessão simulada, contas fictícias e uma extensão real em perfil descartável; não executam ações no Instagram. O relatório da versão está no arquivo-fonte da Órbita em `docs/PUBLICACAO-GROWTH.md`.

## Coleta existente e identidade — 0.16.0

`GET /api/growth/orbita/insights` oferece leitura administrativa dos payloads originais já salvos em SocialConta/SocialMetricaConta/SocialMetricaPost. Sem nova chamada Meta, decriptação, escrita, tabela ou permissão. Seleção por @ exato e origem explícita em ambiguidades. Campos padrão zero das colunas não são evidência. Alcance de vários dias não é somado; cobertura desconhecida permanece desconhecida e mídias lifetime são separadas. A prévia mostra os limites e requer importação explícita.

`/session` e a consulta devolvem userScope pseudônimo; o painel e o relay recusam troca de usuário. Gravações locais revalidam o ator. A versão da extensão deve ser >=0.18.0 para o protocolo com prazo e identidade. O guia de instalação permanece acessível depois de montar o dashboard.
