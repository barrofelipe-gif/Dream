import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { RedeComentario } from "@/lib/social/comentarios";

// Mesmo padrão do sugerir.ts: a chave não é presa a um workspace, o ID vai no cabeçalho.
const client = new Anthropic({
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined,
});
const MODEL = process.env.COMENTARIOS_IA_MODEL ?? process.env.SOCIAL_IA_MODEL ?? "claude-sonnet-5-5";

const APP_BFF = "https://converta.app/redirectbff.html";

const REGRAS: Record<"bff" | "moranga", string> = {
  bff: `Marca: BFF Fitness Atacado, moda fitness no ATACADO direto da fábrica, de Vila Velha (ES), com envio para todo o Brasil. Público: revendedoras e lojistas.
Fatos que você pode usar (só estes): pedido mínimo de R$ 350; não precisa de CNPJ; peças a partir de R$ 49,00; a compra é pelo app (link: ${APP_BFF}); não temos catálogo, os produtos estão no app.
Pergunta de preço ou "quanto custa": diga que as peças começam em R$ 49,00 no atacado, pedido mínimo de R$ 350, e que os valores de cada peça estão no app.`,
  moranga: `Marca: Moranga Biquínis, moda praia no VAREJO (venda para a consumidora final; NÃO é atacado, nunca fale em atacado, pedido mínimo ou revenda).
Compra pelo site: https://www.usemoranga.com.br
Pergunta de preço, tamanho ou estoque: convide para ver no site ou chamar no direct; não invente valores.`,
};

const PROIBIDO = `Proibido sempre: inventar preço, promoção, cupom, desconto ou prazo de entrega; falar em porcentagem de cashback; descrever a peça, cor, tecido, modelo ou tamanho (você não vê a foto nem o vídeo); citar marcas de terceiros; prometer o que não está nos fatos.
Reclamação, problema com pedido, troca ou dado pessoal: peça com carinho para chamar no direct (Instagram) ou no WhatsApp/direct da loja, sem discutir em público e sem pedir dados no comentário.
Elogio ou emoji: agradeça curto e simpático.
Tom: brasileiro, simpático, curto (1 a 2 frases, até 220 caracteres), no máximo 1 emoji, sem hashtag, sem parecer robô. Pode chamar a pessoa pelo primeiro nome se ele estiver claro.`;

function regraLink(rede: RedeComentario, loja: "bff" | "moranga") {
  if (rede === "instagram") return 'No Instagram o link não é clicável no comentário: diga "link na bio" quando falar do app ou do site; nunca escreva o endereço.';
  return loja === "bff" ? `No ${rede === "facebook" ? "Facebook" : "YouTube"} pode colocar o link do app quando ajudar: ${APP_BFF}` : "Pode colocar o link do site quando ajudar.";
}

const Saida = z.object({
  resposta: z.string().describe("A resposta pronta para publicar embaixo do comentário."),
  observacao: z.string().describe("Uma frase curta para a equipe (ex.: 'cliente reclamando, melhor chamar no direct'). Vazio se não houver nada."),
});
export type SugestaoResposta = z.infer<typeof Saida>;

/** Sugere a resposta a um comentário. Nunca publica: a equipe lê, corrige e clica em Enviar. */
export async function sugerirResposta(e: {
  loja: string;
  rede: RedeComentario;
  autor: string;
  comentario: string;
  legendaPost: string;
  respostasAnteriores: string[];
}): Promise<SugestaoResposta> {
  // Só as duas lojas conhecidas: loja estranha nunca recebe as regras da BFF por engano.
  if (e.loja !== "bff" && e.loja !== "moranga") throw new Error(`Loja desconhecida: ${e.loja}`);
  const loja = e.loja;
  const resposta = await client.messages.parse({
    model: MODEL,
    max_tokens: 600,
    system: `Você responde comentários públicos nas redes sociais da marca. A equipe vai ler e corrigir antes de publicar.\n\n${REGRAS[loja]}\n\n${PROIBIDO}\n\n${regraLink(e.rede, loja)}`,
    messages: [
      {
        role: "user",
        content: [
          `Rede: ${e.rede}.`,
          `Legenda da publicação (só contexto; não descreva produto): ${e.legendaPost.slice(0, 500) || "(sem legenda)"}`,
          e.respostasAnteriores.length ? `Respostas que já existem neste comentário: ${e.respostasAnteriores.slice(0, 5).join(" | ").slice(0, 800)}` : "",
          `Comentário de ${e.autor || "alguém"}: """${e.comentario.slice(0, 1500)}"""`,
          "Escreva a resposta.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    output_config: { format: zodOutputFormat(Saida) },
  }, { timeout: 45_000, maxRetries: 0 }); // cabe nos 60 s da rota, com folga para devolver o erro
  if (!resposta.parsed_output) throw new Error("A IA não devolveu a resposta. Tente de novo.");
  const s = resposta.parsed_output;
  // Garantias que não dependem da IA: Instagram aceita até 2.200 caracteres; aqui o texto é curto de propósito.
  return { resposta: s.resposta.trim().replace(/#\S+/g, "").replace(/\s{2,}/g, " ").slice(0, 600), observacao: s.observacao.trim() };
}
