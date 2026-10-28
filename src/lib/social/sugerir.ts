import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MAPA } from "@/lib/social/mapaRedes";
import { limitarHashtags, MAX_HASHTAGS_INSTAGRAM } from "@/lib/social/porRede";
import type { Rede } from "@/lib/social/types";

// A chave da conta não é presa a um workspace: a Anthropic exige o ID no cabeçalho (igual ao robô do Instagram).
const client = new Anthropic({
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined,
});
const MODEL = process.env.SOCIAL_IA_MODEL ?? "claude-sonnet-5-5";

// Limites reais de cada rede (os mesmos dos adaptadores): a IA às vezes passa.
const LIMITE_TITULO: Record<Rede, number> = { instagram: 0, facebook: 0, tiktok: 90, youtube: 100, pinterest: 100 };
const LIMITE_LEGENDA: Record<Rede, number> = { instagram: 2200, facebook: 63206, tiktok: 2200, youtube: 5000, pinterest: 800 };

const RedeEnum = z.enum(["instagram", "facebook", "tiktok", "youtube", "pinterest"]);
const TextoRede = z.object({
  rede: RedeEnum,
  titulo: z.string().describe("Título. YouTube e Pinterest: até 100 caracteres com a busca exata no começo. TikTok: até 90 (só fotos). Instagram e Facebook: string vazia."),
  legenda: z.string().describe("Texto/descrição pronto para colar, já com as hashtags no fim e o chamado para o app."),
  hashtags: z.array(z.string()).describe("As hashtags usadas na legenda, com #. Instagram no máximo 5; TikTok 1 a 3; YouTube 3; Facebook 0 a 3; Pinterest 2 a 4."),
  palavrasChave: z.array(z.string()).describe("3 a 6 termos de busca que o post mira (Google, busca da rede e assistentes de IA)."),
  textoNaTela: z.string().describe("Frase curta para escrever no vídeo nos 3 primeiros segundos (gancho). Vazio se for foto."),
  textoAlternativo: z.string().describe("Texto alternativo descritivo da imagem (Instagram e Pinterest); vazio nas outras."),
  perguntaIa: z.string().describe("Pergunta que alguém faria ao ChatGPT, Gemini ou Google e que este post ajuda a responder."),
  porQue: z.string().describe("Uma frase: por que esse texto deve crescer nessa rede."),
});
const Saida = z.object({ redes: z.array(TextoRede), dicaGeral: z.string().describe("Uma dica prática para gravar ou editar este conteúdo.") });
export type Sugestao = z.infer<typeof Saida>;

const REGRAS_BFF = `Marca: BFF Fitness Atacado, moda fitness no atacado direto da fábrica, de Vila Velha (ES), com envio para todo o Brasil.
Fatos que podem aparecer: pedido mínimo de R$ 350 pelo app; sem precisar de CNPJ; peças a partir de R$ 49,00; compra pelo app (link: https://converta.app/redirectbff.html).
Proibido: falar em porcentagem de cashback, inventar preço ou promoção, citar marcas de terceiros (Alo, Lupo, Live…), falar de diferença entre Pix e cartão, prometer prazo de entrega.
Público: revendedoras e lojistas (B2B). Tom brasileiro, direto, com no máximo 2 emojis.
Link: no Instagram e no TikTok o link não é clicável na legenda, então escreva "link na bio"; no Facebook, YouTube (vídeo longo) e Pinterest use o link do app.
Termos de busca que a BFF já mira: moda fitness atacado, roupa fitness atacado, fornecedor de roupa fitness, conjunto fitness canelado, legging atacado, roupa fitness para revender, fábrica de roupa fitness.
Para ser citada por assistentes de IA (ChatGPT, Gemini, AI Overview): em algum ponto do texto diga, com palavras naturais, quem é a BFF, o que vende e para quem, use o nome da peça por extenso e responda a uma pergunta real. Não copie uma frase pronta; varie a cada post.

Jeito de escrever (o mais importante): escreva como a dona da loja falaria com uma revendedora, não como robô de SEO.
- Nunca comece com a palavra-chave seguida de dois pontos ("Moda fitness atacado: …") nem repita a mesma palavra-chave mais de 2 vezes.
- Nada de frases vazias de marketing ("Pronta para transformar sua vida?", "Inscreva-se para ver os bastidores", "chama atenção", "não perca").
- Frases curtas, parágrafos de 1 a 2 linhas, linha em branco entre eles. Condições de compra em lista com ✅ quando couber.
- A primeira linha é o que mais pesa: diga o que a pessoa vai ver ou ganhar, com a peça por extenso, de forma que dê vontade de clicar.
- Use a fala do próprio vídeo (texto na tela) como gancho quando fizer sentido.

YouTube (descrição): linha 1 = o que o vídeo mostra, natural e com a busca principal no meio da frase; linha 2 = "👉 Compre pelo app: <link>"; depois uma lista curta com ✅ das condições; depois 1 frase sobre a BFF; por fim 3 hashtags. Máximo de 600 caracteres em Short. Título: a busca exata no começo, mas soando como título de vídeo de verdade (ex.: "Camiseta fitness com listras no atacado | lançamento BFF"), sem dois pontos depois da palavra-chave.`;

function regrasDaRede(rede: Rede) {
  const r = MAPA[rede];
  return `${r.rotulo}:\n- Fazer: ${r.repetir.join(" | ")}\n- Evitar: ${r.evitar.join(" | ")}\n- Medidas: ${r.medidas.map(([k, v]) => `${k}: ${v}`).join(" | ")}`;
}

/** Gera título, legenda, hashtags e palavras-chave de cada rede, para um conteúdo descrito em texto (a IA não vê o vídeo). */
export async function sugerirTextos(entrada: { descricao: string; legenda?: string; redes: Rede[]; tipo: "video" | "imagem" | "carrossel" | "texto" }): Promise<Sugestao> {
  const redes = [...new Set(entrada.redes)];
  const resposta = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system: `Você escreve os textos de publicação das redes sociais da BFF, focado em crescer seguidores, alcance, engajamento e cliques, e em aparecer na busca do Google, na busca de cada rede e nas respostas de assistentes de IA.\n\n${REGRAS_BFF}\n\nRegras por rede (de pesquisa de mercado de 2025–2026 e dos números da própria conta):\n${redes.map(regrasDaRede).join("\n\n")}`,
    messages: [
      {
        role: "user",
        content: `Tipo do conteúdo: ${entrada.tipo}.\nO que aparece no conteúdo: ${entrada.descricao || "(não informado)"}\n${entrada.legenda ? `Legenda que já existe (pode reaproveitar e melhorar): ${entrada.legenda}\n` : ""}Escreva um item para cada uma destas redes, nesta ordem: ${redes.join(", ")}. Cada rede tem texto próprio, adaptado ao jeito dela; não repita a mesma legenda.`,
      },
    ],
    output_config: { format: zodOutputFormat(Saida) },
  });
  if (!resposta.parsed_output) throw new Error("A IA não devolveu os textos. Tente de novo.");
  const saida = resposta.parsed_output;
  // Só as redes pedidas, uma vez cada, e os limites reais de cada rede garantidos mesmo se a IA passar:
  // hashtags do Instagram (na lista e no texto), tamanho do título e da legenda.
  const vistas = new Set<Rede>();
  saida.redes = saida.redes
    .filter((r) => redes.includes(r.rede) && !vistas.has(r.rede) && vistas.add(r.rede))
    .map((r) => {
      const ig = r.rede === "instagram";
      return {
        ...r,
        titulo: r.titulo.trim().slice(0, LIMITE_TITULO[r.rede]),
        legenda: (ig ? limitarHashtags(r.legenda, MAX_HASHTAGS_INSTAGRAM) : r.legenda).slice(0, LIMITE_LEGENDA[r.rede]),
        hashtags: ig ? r.hashtags.slice(0, MAX_HASHTAGS_INSTAGRAM) : r.hashtags,
      };
    });
  return saida;
}
