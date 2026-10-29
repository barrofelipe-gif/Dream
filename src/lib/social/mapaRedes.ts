/**
 * Conteúdo do "Mapa das redes" (aba Redes › Mapa das redes): agenda-modelo, o que já deu certo nas contas da BFF,
 * o que repetir e o que funciona no mercado, rede por rede. É curadoria manual: os números da BFF foram lidos
 * do coletor de métricas e do YouTube Analytics, e os de mercado de estudos públicos, em LEVANTADO_EM.
 * O Instagram também mostra os números ao vivo (componente SocialMapa).
 */
import type { Rede } from "@/lib/social/types";

export const LEVANTADO_EM = "27/10/2026";

/** bff = dado das nossas contas; o resto segue a força da fonte externa. */
export type Confianca = "oficial" | "estudo" | "secundaria" | "sinal" | "bff";
export type Item = { texto: string; confianca: Confianca; fonte?: string; url?: string };
/** dia: 0 = segunda … 6 = domingo. */
export type Horario = { dia: number; hora: string; formato: string };

export type RedeMapa = {
  rotulo: string;
  cor: string;
  corSuave: string;
  gradiente: string;
  /** Pinterest fica contornado (branco com borda) para não se confundir com o vermelho do YouTube. */
  contornado?: boolean;
  status: string;
  manchete: string;
  resumo: string;
  agenda: Horario[];
  nosso: Item[];
  repetir: string[];
  evitar: string[];
  formatos: { formato: string; veredito: string; texto: string }[];
  alta: Item[];
  atacado: Item[];
  medidas: [string, string][];
  ideias: { titulo: string; como: string }[];
  modelos: { rotulo: string; texto: string }[];
};

export const ORDEM: Rede[] = ["instagram", "tiktok", "facebook", "youtube", "pinterest"];

export const MAPA: Record<Rede, RedeMapa> = {
  instagram: {
    rotulo: "Instagram",
    cor: "#d02a78",
    corSuave: "#fbe7f1",
    gradiente: "linear-gradient(135deg,#7638c9 0%,#c72a7a 55%,#e2492f 100%)",
    status: "Conectado · métricas coletadas",
    manchete: "Foto de cliente e carrossel alcançam mais; Reel de prova de qualidade engaja mais.",
    resumo: "@bfffitness_atacado, 220 mil seguidores. A única rede com números completos no painel.",
    agenda: [
      { dia: 0, hora: "11:30", formato: "Stories" },
      { dia: 1, hora: "11:30", formato: "Stories" },
      { dia: 1, hora: "19:45", formato: "Reels" },
      { dia: 2, hora: "11:30", formato: "Stories" },
      { dia: 2, hora: "12:00", formato: "Reels ou carrossel" },
      { dia: 3, hora: "09:00", formato: "Reels ou feed" },
      { dia: 3, hora: "11:30", formato: "Stories" },
      { dia: 4, hora: "11:30", formato: "Stories" },
      { dia: 5, hora: "08:00", formato: "Reels (seu melhor horário)" },
      { dia: 5, hora: "11:30", formato: "Stories" },
      { dia: 6, hora: "11:30", formato: "Stories" },
      { dia: 6, hora: "20:00", formato: "Reels" },
    ],
    nosso: [
      { texto: "Em 90 dias (93 posts), a foto teve o maior alcance médio (13.197 por post) e o maior número de cliques no link da bio (31 por post). O Reel teve o maior engajamento (2,44%). O carrossel ficou no meio (7.991 de alcance, 2,23%).", confianca: "bff" },
      { texto: "O post nº 1 foi foto de cliente: “Fotos que a gente ama receber 🥰 Todo mundo com macacão BFF!” (29/08), com 40 mil de alcance.", confianca: "bff", fonte: "ver post", url: "https://www.instagram.com/p/Dcolc3EpzOW/" },
      { texto: "Carrossel de humor e estilo espalha por envio: “Damos um jeito nas duas comprinhas 🤌🏻” teve 455 compartilhamentos e “Coisas que acho #chique” teve 234 salvamentos.", confianca: "bff", fonte: "ver post", url: "https://www.instagram.com/p/DeB_rf8Fr5-/" },
      { texto: "O Reel com mais salvamentos e engajamento (4,71%) foi “ATACADO DIRETO DA FÁBRICA, poliamida ZERO transparência, peças a partir de R$ 49” (11/08). Prova de qualidade com preço é o que a revendedora salva.", confianca: "bff", fonte: "ver Reel", url: "https://www.instagram.com/reel/Db6wwRyNMYv/" },
      { texto: "“Pesquise no APP: Montaria” e “Pesquise no APP: Flor de Lírio” ficaram entre os 10 maiores alcances, levando para o app pelo nome da peça.", confianca: "bff" },
      { texto: "Melhor dia sábado (15.203 de alcance médio) e melhor hora 8h, que também é a que mais gera clique na bio (48 por post). Piores: segunda (5.519) e 16h (1.912).", confianca: "bff" },
      { texto: "Stories alcançam pouco (664 por story) e quase não levam ao link (1,9 clique): servem para quem já segue, não para crescer.", confianca: "bff" },
    ],
    repetir: [
      "Foto e vídeo de cliente usando a peça. Pedir a foto no pós-venda e repostar com autorização.",
      "Reel de prova: transparência, tecido e caimento, com “a partir de R$ 49” e pedido mínimo de R$ 350 na tela.",
      "Carrossel de humor ou estilo que dá vontade de mandar para a amiga.",
      "“Pesquise no APP: nome da peça” na legenda.",
      "Postar no sábado e às 8h. Reel de 30 a 60 s.",
      "Marcar a cliente ou criadora (collab): marcar aumenta o alcance.",
    ],
    evitar: [
      "Postar às 16h e concentrar os posts na segunda.",
      "Mais de 5 hashtags (limite oficial desde dez/2025).",
      "Reel com mais de 3 min: não é mostrado para quem não segue.",
      "Repostar o mesmo Reel como teste várias vezes (o Instagram disse que vai punir).",
      "Legenda longa: abaixo de 30 palavras rende mais.",
    ],
    formatos: [
      { formato: "Reels", veredito: "alcance", texto: "Melhor alcance em contas de até 50 mil e 4x mais interações que imagem (Metricool, 24 milhões de posts). Em moda, Reels de look passam de 200 compartilhamentos por post (Dash Social)." },
      { formato: "Carrossel", veredito: "salvamento", texto: "Maior engajamento por seguidor (0,55%, Socialinsider, 35 milhões de posts) e 9x mais salvamentos que imagem (Metricool)." },
      { formato: "Imagem única", veredito: "caindo", texto: "Caiu 22% em alcance e 25% em interações em um ano (Metricool). Na BFF ainda funciona quando é foto de cliente." },
      { formato: "Stories", veredito: "relacionamento", texto: "70% de conclusão em média; as marcas postam 2 por dia (Dash Social). Não alcança gente nova." },
    ],
    alta: [
      { texto: "O sinal mais forte agora é o envio por DM: o Instagram prioriza o post que a pessoa mandaria para uma amiga.", confianca: "oficial", fonte: "Mosseri, jan e out/2026" },
      { texto: "Conteúdo original ganha; conta que só reposta perde alcance desde abril/2026.", confianca: "oficial", fonte: "Instagram, via Buffer", url: "https://buffer.com/resources/instagram-algorithms/" },
      { texto: "Reels de teste (Trial Reels) aparecem primeiro só para quem não segue: bom para testar gancho sem queimar o perfil.", confianca: "oficial", fonte: "help.instagram.com", url: "https://help.instagram.com/1013292530224018" },
      { texto: "Em moda, 2026 premia conteúdo com opinião própria, falando direto com o público. Provador e lookbook foram o forte de 2025.", confianca: "estudo", fonte: "Dash Social, moda", url: "https://www.dashsocial.com/social-media-benchmarks/fashion-industry" },
      { texto: "No Brasil, 73% dizem que o Instagram influencia compras e 67% já compraram por indicação de criador.", confianca: "estudo", fonte: "Opinion Box 2026", url: "https://www.ecommercebrasil.com.br/noticias/instagram-influencia-compras-de-73-dos-usuarios-no-brasil" },
    ],
    atacado: [
      { texto: "Contas de atacado do Brás e do Bom Retiro postam provador e tour de loja, com o pedido mínimo na legenda.", confianca: "sinal" },
      { texto: "O CTA “comente GRUPO” para entrar no grupo de WhatsApp é comum. Para a BFF, o equivalente é “comente APP”, com a automação de comentário mandando o link.", confianca: "sinal" },
      { texto: "Nenhum estudo mede atacado de moda no Instagram: tudo aqui é observação.", confianca: "sinal" },
    ],
    medidas: [
      ["Reels", "9:16, 1080 x 1920. Rende mais com 30 a 60 s"],
      ["Feed", "4:5, 1080 x 1350"],
      ["Carrossel", "Até 20 itens, 4:5"],
      ["Stories", "9:16, até 60 s cada"],
      ["Legenda", "Até 2.200; melhor abaixo de 30 palavras"],
      ["Hashtags", "No máximo 5"],
    ],
    ideias: [
      { titulo: "Teste de transparência", como: "Agachamento com a legging na luz forte, 15 a 30 s, com “ZERO transparência” e “a partir de R$ 49” na tela. Repete o Reel campeão de agosto com peça nova." },
      { titulo: "Todo mundo de BFF", como: "Carrossel com as fotos que as revendedoras mandam. Foi o post nº 1 dos 90 dias." },
      { titulo: "Humor de revendedora", como: "Carrossel no estilo meme com situações da revendedora, como o “Damos um jeito nas duas comprinhas”. Feito para mandar para a amiga." },
      { titulo: "Pesquise no APP", como: "Foto da peça com “Pesquise no APP: nome da peça” na legenda. Leva direto para o app." },
      { titulo: "1 conjunto, 3 looks", como: "O mesmo conjunto canelado no treino, no café e na faculdade. Argumento para a lojista: a cliente compra mais." },
      { titulo: "Comente APP", como: "Reel com “comente APP que eu te mando o link”, ligado na automação de comentários do painel." },
    ],
    modelos: [
      { rotulo: "Legenda de Reels", texto: "Conjunto fitness canelado no atacado, direto da fábrica. 💜\nPedido mínimo de R$ 350 pelo app, sem precisar de CNPJ.\nBaixe o app pelo link da bio e veja todas as cores.\n\n#atacadofitness #modafitnessatacado #conjuntocanelado #roupadeacademia #revendedora" },
      { rotulo: "Texto alternativo da imagem", texto: "Modelo vestindo conjunto fitness canelado rosa, top e legging cintura alta, moda fitness atacado BFF" },
    ],
  },

  tiktok: {
    rotulo: "TikTok",
    cor: "#161616",
    corSuave: "#e1f6f5",
    gradiente: "linear-gradient(135deg,#1b1b1b 0%,#0f1f1f 100%)",
    status: "Conectado em modo teste · posts privados",
    manchete: "Vídeo de 2 a 3 min alcança mais; de 15 a 30 s engaja mais. Live está explodindo no Brasil.",
    resumo: "@bfffitness_atacado conectado no painel. Os posts saem privados até o TikTok aprovar o app.",
    agenda: [
      { dia: 0, hora: "18:30", formato: "Vídeo" },
      { dia: 1, hora: "19:30", formato: "Vídeo" },
      { dia: 3, hora: "20:00", formato: "Vídeo" },
      { dia: 6, hora: "09:00", formato: "Vídeo" },
    ],
    nosso: [
      { texto: "Ainda não temos números do TikTok da BFF: o app do painel está em modo teste e a coleta de métricas do TikTok ainda não foi ligada.", confianca: "bff" },
      { texto: "O ponto de partida é reaproveitar os campeões do Instagram (teste de transparência, foto de cliente, humor), exportados sem a marca d'água do Instagram.", confianca: "bff" },
    ],
    repetir: [
      "Subir os Reels campeões do Instagram como arquivo original, sem marca d'água.",
      "Legenda escrita na tela: mais de 30% assiste sem som.",
      "Mostrar o resultado nos 3 primeiros segundos.",
      "1 hashtag do tema: dá cerca de 5% a mais de views.",
      "Visual menos produzido, gravado no celular.",
    ],
    evitar: [
      "Vídeo com marca d'água de outra rede: não entra no Para Você.",
      "Legenda longa: acima de 90 palavras engaja menos.",
      "Achar que o horário salva: o TikTok diz que conta mais a aprovação do público.",
    ],
    formatos: [
      { formato: "Vídeo de 15 a 30 s", veredito: "engajamento", texto: "Maior engajamento (6%), mas a mediana fica em 1.000 views (Socialinsider, 8 milhões de vídeos de marcas, 2026)." },
      { formato: "Vídeo de 2 a 3 min", veredito: "alcance", texto: "Mediana de 11.136 views, 11x a dos vídeos de 15 a 30 s. O TikTok tem empurrado vídeos de 1 a 3 min que seguram a atenção." },
      { formato: "Carrossel de fotos", veredito: "teste barato", texto: "Média de 5.890 views contra 32.895 do vídeo (Metricool, 2,3 milhões de posts). Serve para testar assunto." },
      { formato: "LIVE", veredito: "venda", texto: "No Brasil, em um ano, o número de lives por dia ficou 20x maior e o faturamento vindo de lives ficou 161x maior (TikTok)." },
    ],
    alta: [
      { texto: "Arrumar-se para o treino (GRWM), look do dia (OOTD) e prova de várias peças (haul) são os vídeos de roupa que mais convertem, desde que pareçam naturais.", confianca: "secundaria", fonte: "GetHookd, jul/2026" },
      { texto: "O TikTok Shop BR diz que vídeo de moda vende mostrando caimento, combinação e detalhe da peça. Moda cresceu 154% no 1º semestre de 2026, e calça feminina é o item de moda mais vendido.", confianca: "oficial", fonte: "E-Commerce Brasil, set/2026", url: "https://www.ecommercebrasil.com.br/noticias/vendas-de-moda-no-tiktok-shop-crescem-154-no-primeiro-semestre" },
      { texto: "A busca já gera quase 4% das impressões e as views vindas de hashtag cresceram 114%: o algoritmo lê a fala e o texto na tela.", confianca: "estudo", fonte: "Metricool 2026", url: "https://metricool.com/pt/estudo-tiktok/" },
      { texto: "Caso parecido com a BFF: a Natura transformou as consultoras em criadoras. Foram 52 mil lives em 2025, 60% feitas por elas, com engajamento 3x maior.", confianca: "oficial", fonte: "TikTok Newsroom BR", url: "https://newsroom.tiktok.com/tiktok-shop-cresce-102-vezes-em-seu-primeiro-ano-no-brasil?lang=pt-BR" },
      { texto: "Spark Ads (impulsionar um vídeo orgânico) tem taxa de conclusão 134% maior que o anúncio comum.", confianca: "oficial", fonte: "TikTok for Business" },
    ],
    atacado: [
      { texto: "@omodacenter (Santa Cruz do Capibaribe) apresenta fornecedores com box e setor, inclusive de moda fitness.", confianca: "sinal", url: "https://www.tiktok.com/@omodacenter/video/7696905560238640405", fonte: "ver vídeo" },
      { texto: "@laudynnec faz “fonte secreta: melhores marcas fitness para revenda” em Goiânia, com tour de loja.", confianca: "sinal", url: "https://www.tiktok.com/@laudynnec/video/7547442026762046776", fonte: "ver vídeo" },
      { texto: "@rafaellasenabras faz “onde comprar fitness no atacado no Brás”. O padrão é tour, provador e o argumento de pedido mínimo e margem.", confianca: "sinal", url: "https://www.tiktok.com/@rafaellasenabras/video/7487755725901532421", fonte: "ver vídeo" },
      { texto: "Os polos de Fortaleza já montam espaços só para live de moda.", confianca: "sinal" },
      { texto: "O TikTok Shop é varejo para consumidor final e não combina com o pedido mínimo de R$ 350: o uso é o vídeo levando para o app (dedução, não confirmada na política).", confianca: "sinal" },
    ],
    medidas: [
      ["Vídeo", "9:16, 1080 x 1920"],
      ["Duração", "15 a 30 s para engajar; 2 a 3 min para alcançar"],
      ["Gancho", "Primeiros 3 segundos"],
      ["Legenda", "Abaixo de 30 palavras"],
      ["Hashtags", "1 a 3 do tema"],
      ["Frequência", "3 a 5 por semana; mais posts, mais views por post"],
    ],
    ideias: [
      { titulo: "Provador de 2 minutos", como: "5 peças provadas em sequência, com o preço de atacado na tela. Duração de alcance (2 a 3 min)." },
      { titulo: "POV: revendedora recebendo o pedido", como: "Abrindo a caixa de um pedido de R$ 350 e mostrando quanto vira na revenda." },
      { titulo: "Arrume-se para o treino", como: "GRWM com um conjunto BFF, legenda na tela e o nome da peça para pesquisar no app." },
      { titulo: "Live de novidades", como: "Live semanal mostrando o que chegou, no modelo da Natura: chamar revendedoras BFF para fazer junto." },
      { titulo: "Fonte da revendedora", como: "No formato “onde comprar fitness no atacado direto da fábrica”, que é o que as contas de polo fazem." },
    ],
    modelos: [
      { rotulo: "Legenda de TikTok", texto: "Conjunto canelado fitness atacado: 3 looks com a mesma peça. Pedido mínimo R$ 350 no app, link na bio. #atacadofitness #conjuntocanelado #modafitness" },
    ],
  },

  facebook: {
    rotulo: "Facebook",
    cor: "#1877f2",
    corSuave: "#e4eefd",
    gradiente: "linear-gradient(135deg,#2a83f6 0%,#0f55c4 100%)",
    status: "Página conectada · sem métricas ainda",
    manchete: "Foto e álbum alcançam mais; vídeo original virou Reel e dobrou de views.",
    resumo: "Página BFF Fitness Atacado conectada no publicador.",
    agenda: [
      { dia: 0, hora: "12:00", formato: "Vídeo ou Reels" },
      { dia: 1, hora: "09:30", formato: "Vídeo ou Reels" },
      { dia: 2, hora: "09:30", formato: "Vídeo ou Reels" },
      { dia: 3, hora: "09:00", formato: "Vídeo ou Reels" },
    ],
    nosso: [{ texto: "A Página está conectada no publicador, mas a coleta de métricas do Facebook ainda não existe no painel. Ainda não sabemos o que deu certo aqui.", confianca: "bff" }],
    repetir: [
      "Postar o mesmo vídeo do Instagram, original da BFF e sem marca d'água.",
      "Álbum de fotos de lançamento: álbum e imagem são os formatos que mais alcançam no Facebook.",
      "Texto direto com “moda fitness atacado” e o link do app.",
    ],
    evitar: [
      "Post só com link: é o pior formato em alcance (0,20%) e engajamento (0,05%).",
      "Juntar clipes ou repostar sem acrescentar nada: o Facebook rebaixa a página.",
    ],
    formatos: [
      { formato: "Imagem e álbum", veredito: "alcance", texto: "Alcance de 1,20% (imagem) e 1,15% (álbum) dos seguidores, os maiores da rede (Socialinsider, ago/2026)." },
      { formato: "Reels", veredito: "engajamento", texto: "Engajamento de 0,18%. Views e tempo assistido de Reels originais quase dobraram no 2º semestre de 2025 (Meta)." },
      { formato: "Texto (status)", veredito: "conversa", texto: "Maior engajamento (0,20%), mas alcance menor (0,80%)." },
      { formato: "Link", veredito: "pior", texto: "0,20% de alcance e 0,05% de engajamento." },
    ],
    alta: [
      { texto: "Todo vídeo virou Reel, sem limite de duração (jun/2025).", confianca: "oficial", fonte: "about.fb.com", url: "https://about.fb.com/news/2025/06/making-it-easier-create-videos-facebook/" },
      { texto: "O Facebook premia quem cria conteúdo original e rebaixa quem só junta clipes (mar/2026).", confianca: "oficial", fonte: "about.fb.com", url: "https://about.fb.com/news/2026/03/rewarding-original-creators-on-facebook/" },
      { texto: "Reels de 2 a 3 min têm o maior engajamento (0,50%).", confianca: "estudo", fonte: "Socialinsider, vídeo", url: "https://www.socialinsider.io/social-media-benchmarks/social-media-video-statistics" },
      { texto: "Páginas ganharam 23% de seguidores em 2025, contra 12% em 2024.", confianca: "estudo", fonte: "Socialinsider" },
      { texto: "A aba Amigos (mar/2025) mostra só posts de amigos: a Página depende de Reels e de compartilhamento para aparecer.", confianca: "oficial", fonte: "about.fb.com" },
    ],
    atacado: [
      { texto: "Páginas e grupos do Bom Retiro postam vídeo com “compre pelo WhatsApp” e “saiba mais no privado”.", confianca: "sinal" },
      { texto: "Não há estudo de moda no Facebook. Os grupos de revendedoras são um canal a testar.", confianca: "sinal" },
    ],
    medidas: [
      ["Reels", "9:16, 1080 x 1920; 2 a 3 min engaja mais"],
      ["Foto", "1:1 ou 4:5"],
      ["Link", "Imagem 1200 x 630 vem da página do site"],
      ["Texto", "Sem limite prático"],
    ],
    ideias: [
      { titulo: "Álbum de lançamento", como: "Todas as cores da peça nova em um álbum, com o link do app no texto." },
      { titulo: "2 minutos na fábrica", como: "Vídeo original mostrando produção e estoque: 2 a 3 min é a faixa que mais engaja no Facebook." },
      { titulo: "Revendedora conta", como: "Depoimento de revendedora sobre quanto vende com o pedido mínimo de R$ 350." },
    ],
    modelos: [
      { rotulo: "Texto de post com vídeo", texto: "Moda fitness atacado: conjunto canelado direto da fábrica.\nPedido mínimo de R$ 350 pelo app da BFF Fitness Atacado, sem precisar de CNPJ e com envio para todo o Brasil.\nBaixe o app e veja todas as cores: https://converta.app/redirectbff.html" },
    ],
  },

  youtube: {
    rotulo: "YouTube",
    cor: "#e01b1b",
    corSuave: "#fde5e5",
    gradiente: "linear-gradient(135deg,#f22c2c 0%,#c40d0d 100%)",
    status: "Canal conectado · parado desde abril",
    manchete: "A revendedora procura “onde comprar” e “como revender”, e nenhuma fábrica domina essa busca.",
    resumo: "@bfffitnessatacado: 55 inscritos e 37 vídeos.",
    agenda: [
      { dia: 2, hora: "13:00", formato: "Shorts" },
      { dia: 3, hora: "16:00", formato: "Shorts" },
      { dia: 4, hora: "16:00", formato: "Shorts" },
      { dia: 6, hora: "10:00", formato: "Vídeo longo" },
    ],
    nosso: [
      { texto: "Nos últimos 12 meses o canal teve 440.672 views, mas só 1.031 nos últimos 90 dias. O último envio foi um lote de 11 Shorts em 29/04/2026.", confianca: "bff" },
      { texto: "Média de 13 s assistidos por view e só 17 inscritos ganhos em 12 meses: os Shorts trouxeram view, não trouxeram inscrito.", confianca: "bff" },
      { texto: "Temas que já existem no canal: “O que nossas clientes falam”, “Teste de transparência na prática”, “Comece seu negócio com R$ 350” e conjuntos por cor.", confianca: "bff" },
    ],
    repetir: [
      "Voltar a postar: 3 Shorts por semana.",
      "Teste de transparência e depoimento de cliente, que já existem no canal.",
      "Título com a busca exata: “moda fitness atacado”, “fornecedor de roupa fitness”.",
      "Vídeo longo para a revendedora, de 8 a 15 min.",
    ],
    evitar: [
      "Subir um lote de vídeos num dia e passar meses sem postar.",
      "Só Shorts: não viram inscrito. A revendedora assiste vídeo longo.",
    ],
    formatos: [
      { formato: "Shorts", veredito: "views", texto: "200 bilhões de views por dia (YouTube). A maior média de views entre as redes, mas engajamento de 0,30% (Socialinsider, 69 milhões de vídeos)." },
      { formato: "Vídeo de 8 a 15 min", veredito: "confiança", texto: "Os vídeos que vencem a busca “como revender roupa fitness” têm de 5 a 17 min e chegam a 86,9 mil views." },
      { formato: "Vlog de 20 a 45 min", veredito: "tour", texto: "Vlogs de visita ao Brás têm de 5 a 10 mil views e são os primeiros na busca “fornecedor roupa fitness”." },
      { formato: "Live", veredito: "sem dado", texto: "Não há estudo confiável de 2025–2026 sobre live no YouTube." },
    ],
    alta: [
      { texto: "No Brasil, 58% procuram vídeo do produto antes de comprar e 56% preferem ver uma pessoa comum usando o produto; só 30% citam conteúdo da própria marca.", confianca: "estudo", fonte: "Opinion Box, YouTube no Brasil 2026" },
      { texto: "Mais de 25 milhões de brasileiros fizeram buscas de compra no YouTube em jul/2025.", confianca: "oficial", fonte: "blog do YouTube", url: "https://blog.youtube/intl/pt-br/news-and-events/yt-shopping-afiliados-brasil/" },
      { texto: "O YouTube testa título e capa sozinho (Test & Compare) desde dez/2025 e escolhe o vencedor pelo tempo assistido.", confianca: "secundaria", fonte: "monitoryt.com" },
      { texto: "O YouTube Shopping no Brasil só aceita Mercado Livre e Shopee e exige 5 mil inscritos: não dá para marcar produto do app da BFF.", confianca: "oficial", fonte: "blog do YouTube, nov/2025" },
    ],
    atacado: [
      { texto: "Busca “atacado moda fitness”: no topo há vídeos de 5 a 11 anos atrás, com poucas views. Ninguém domina essa busca hoje.", confianca: "sinal" },
      { texto: "Busca “fornecedor roupa fitness”: vlogs recentes de visita a fábrica e loja no Brás, de 20 a 43 min, com 5 a 10 mil views.", confianca: "sinal" },
      { texto: "Busca “como revender roupa fitness”: educadoras com vídeos de 5 a 17 min (Amanda Cabral, 86,9 mil views; Karen Cavalcanti, 41,6 mil).", confianca: "sinal" },
      { texto: "Provador de legging (try-on) no topo é só de marcas de fora (Gymshark, Alphalete), com até 1,38 milhão de views. Não há provador brasileiro de atacado: espaço livre.", confianca: "sinal" },
    ],
    medidas: [
      ["Shorts", "9:16, até 3 min; a maioria com menos de 60 s"],
      ["Vídeo longo", "16:9; 8 a 15 min para a revendedora"],
      ["Título", "Até 100 caracteres, com a busca exata no começo"],
      ["Descrição", "Até 5.000; link clicável só no vídeo longo"],
      ["Hashtags", "As 3 primeiras aparecem acima do título"],
    ],
    ideias: [
      { titulo: "Como revender roupa fitness com R$ 350", como: "Vídeo de 8 a 12 min: margem, pedido mínimo, como vender no Instagram e no WhatsApp, terminando no app." },
      { titulo: "Tour pela fábrica BFF", como: "Vlog de 15 a 20 min mostrando produção, tecido e estoque. Concorre com os vlogs do Brás." },
      { titulo: "Provador de atacado: 10 peças", como: "Try-on de 8 a 12 min com preço de atacado. No Brasil ninguém faz." },
      { titulo: "Teste de transparência", como: "Short de 20 a 40 s, o mesmo do Reel campeão do Instagram." },
      { titulo: "Revendedora conta quanto vende", como: "Depoimento: 56% dos brasileiros preferem pessoa comum mostrando o produto." },
    ],
    modelos: [
      { rotulo: "Título do Short", texto: "Conjunto canelado fitness atacado: provando P, M e G" },
      { rotulo: "Descrição", texto: "Moda fitness atacado direto da fábrica. Conjunto canelado em vários tamanhos e cores, pedido mínimo de R$ 350 pelo app da BFF Fitness Atacado, sem CNPJ e com envio para todo o Brasil.\nBaixe o app: https://converta.app/redirectbff.html\n\n#atacadofitness #modafitness #conjuntocanelado" },
    ],
  },

  pinterest: {
    rotulo: "Pinterest",
    cor: "#e60023",
    corSuave: "#fde6ea",
    gradiente: "#e60023",
    contornado: true,
    status: "Aguardando aprovação do Pinterest",
    manchete: "Funciona como buscador: o título com a palavra buscada vale mais que o horário.",
    resumo: "O acesso do painel ao Pinterest ainda aguarda aprovação.",
    agenda: [
      { dia: 1, hora: "10:30", formato: "Pin de vídeo" },
      { dia: 2, hora: "11:00", formato: "Pin de imagem" },
      { dia: 3, hora: "10:30", formato: "Pin de imagem" },
      { dia: 4, hora: "10:30", formato: "Pin de vídeo" },
    ],
    nosso: [{ texto: "Ainda não temos conta conectada nem números: o acesso do painel aguarda aprovação do Pinterest.", confianca: "bff" }],
    repetir: [
      "Título com a busca exata na frente: “conjunto canelado academia atacado”.",
      "Uma pasta (board) por tipo de peça, com palavra-chave no nome.",
      "Fotos de catálogo em 2:3.",
    ],
    evitar: ["Pin sem descrição: é a descrição que alimenta a busca.", "Esperar resultado rápido: o Pin vive meses na busca."],
    formatos: [
      { formato: "Pin de vídeo", veredito: "alcance", texto: "Cerca de 3,2x o engajamento do Pin estático em anúncios, segundo números do Pinterest repassados por terceiros (Adello, 2026)." },
      { formato: "Pin de imagem", veredito: "clique", texto: "É o formato de quem já quer comprar: leva clique para a loja (comunidade do Pinterest)." },
      { formato: "Carrossel", veredito: "catálogo", texto: "De 2 a 10 cards, também no orgânico (Pinterest)." },
    ],
    alta: [
      { texto: "No Verão 2026 o esporte virou estética: “female jersey outfit” +494%, “Brazil jersey outfit women” +302%, “baddie tracksuit outfit” +276% e a volta da capri (dados globais, ano de Copa).", confianca: "oficial", fonte: "Pinterest, Summer Trend Report 2026", url: "https://newsroom.pinterest.com/news/summer-trend-report-2026/" },
      { texto: "O Pinterest Predicts 2026 não traz nenhuma tendência de roupa fitness ou moda praia.", confianca: "oficial", fonte: "Pinterest Predicts 2026" },
      { texto: "97% das principais buscas não citam marca: quem escreve a palavra certa aparece.", confianca: "oficial", fonte: "Pinterest Brasil" },
    ],
    atacado: [
      { texto: "Não há dado de atacado no Pinterest. O uso para a BFF é levar a busca de look para o catálogo do app.", confianca: "sinal" },
      { texto: "Pins de produto do catálogo mostram preço e estoque, mas dependem da integração com a loja.", confianca: "secundaria" },
    ],
    medidas: [
      ["Imagem", "2:3, 1000 x 1500"],
      ["Vídeo", "9:16, 4 s a 5 min"],
      ["Título", "Até 100; os 40 primeiros aparecem"],
      ["Descrição", "Até 800"],
      ["Carrossel", "2 a 10 cards"],
    ],
    ideias: [
      { titulo: "Look com capri", como: "A capri voltou no Pinterest e subiu 50% no Google Trends BR. Pin com o look completo e o título “legging capri academia”." },
      { titulo: "Camisa do Brasil e legging", como: "“Brazil jersey outfit” subiu 302%: look de camisa do Brasil com legging e top BFF." },
      { titulo: "Pasta Looks academia 2026", como: "Board com a palavra buscada no nome, um Pin por conjunto, apontando para a categoria do app." },
    ],
    modelos: [
      { rotulo: "Título do Pin", texto: "Look academia 2026: conjunto fitness canelado" },
      { rotulo: "Descrição do Pin", texto: "Conjunto fitness canelado para academia e para o dia a dia. Moda fitness atacado direto da fábrica, pedido mínimo de R$ 350 pelo app, sem CNPJ. Veja looks de academia, legging, top e conjuntos para revender. #modafitness #atacadofitness #looksacademia2026" },
    ],
  },
};

const minutosDe = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/** Brasil sem horário de verão desde 2019: Brasília é sempre UTC-3. */
const BRASILIA_MS = -3 * 3600_000;

/**
 * Os próximos `n` horários bons de uma rede pela agenda-modelo, a partir de agora (10 min de folga), pulando
 * horários que já têm postagem agendada nessa rede (menos de 45 min de distância). Os dias e horas são de
 * Brasília, seja qual for o fuso do navegador.
 */
export function proximosHorarios(rede: Rede, n: number, ocupados: Date[] = [], agora = new Date()): { quando: Date; hora: string; formato: string }[] {
  const out: { quando: Date; hora: string; formato: string }[] = [];
  const livre = (d: Date) => ![...ocupados, ...out.map((o) => o.quando)].some((o) => Math.abs(o.getTime() - d.getTime()) < 45 * 60_000);
  // Stories ficam de fora: o publicador posta feed, Reels e vídeo, não Stories.
  const agenda = MAPA[rede].agenda.filter((x) => !/^Stories$/i.test(x.formato));
  if (!agenda.length) return out;
  const br = new Date(agora.getTime() + BRASILIA_MS); // campos UTC = relógio de Brasília
  for (let off = 0; off < 60 && out.length < n; off++) {
    const dia = new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() + off));
    const w = (dia.getUTCDay() + 6) % 7;
    for (const s of agenda.filter((x) => x.dia === w).sort((a, b) => minutosDe(a.hora) - minutosDe(b.hora))) {
      const quando = new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), Number(s.hora.slice(0, 2)), Number(s.hora.slice(3, 5))) - BRASILIA_MS);
      if (quando.getTime() > agora.getTime() + 10 * 60_000 && livre(quando)) out.push({ quando, hora: s.hora, formato: s.formato });
      if (out.length >= n) break;
    }
  }
  return out;
}

/**
 * Todos os horários bons de uma rede num dia (AAAA-MM-DD, calendário de Brasília), do mais cedo ao mais tarde.
 * Horário que já passou (ou está a menos de 10 min) não entra; os que colidem com postagem já agendada vêm marcados como ocupados.
 */
export function horariosDoDia(rede: Rede, dia: string, ocupados: Date[] = [], agora = new Date()): { quando: Date; hora: string; formato: string; ocupado: boolean }[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return [];
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const w = (new Date(base).getUTCDay() + 6) % 7;
  return MAPA[rede].agenda
    .filter((x) => x.dia === w && !/^Stories$/i.test(x.formato))
    .sort((a, b) => minutosDe(a.hora) - minutosDe(b.hora))
    .map((x) => ({ quando: new Date(base + minutosDe(x.hora) * 60_000 - BRASILIA_MS), hora: x.hora, formato: x.formato }))
    .filter((x) => x.quando.getTime() > agora.getTime() + 10 * 60_000)
    .map((x) => ({ ...x, ocupado: ocupados.some((o) => Math.abs(o.getTime() - x.quando.getTime()) < 45 * 60_000) }));
}

/** Hoje no calendário de Brasília (AAAA-MM-DD), seja qual for o fuso do navegador. */
export function hojeEmBrasilia(agora = new Date()): string {
  return new Date(agora.getTime() + BRASILIA_MS).toISOString().slice(0, 10);
}

/** Valor para o campo datetime-local (AAAA-MM-DDTHH:MM) no relógio local. */
export function paraCampoData(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
