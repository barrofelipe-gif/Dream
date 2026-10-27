import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "@/lib/prisma";
import { aplicarRegrasEtiquetas } from "@/lib/igRegras";

/** Etiquetas que o robô aplica sozinho (como as tags do ManyChat). A equipe também cria as suas na caixa de entrada. */
export const TAG = {
  pediuHumano: "Pediu humano",
  semDuvida: "Sem dúvida informada",
  naoAtendido: "Não atendido",
  atendidoEquipe: "Atendido pela equipe",
  resolvidoRobo: "Resolvido pelo robô",
  querComprar: "Quer comprar",
  atraso: "Pedido atrasado",
  seguiu: "Segue a loja",
  comprador: "Comprador",
  veioAnuncio: "Veio de anúncio",
  organico: "Orgânico",
  origemStory: "Veio de story",
} as const;

export const SUGESTOES_TAGS = Object.values(TAG);

const limpa = (t: string) => t.trim().replace(/\s+/g, " ").slice(0, 40);

// Trava contra laço: fluxo com bloco de etiqueta → etiquetar() → outro fluxo (ou o mesmo, se ele remove e
// reaplica a etiqueta do gatilho) → etiquetar()… Cada fluxo novo recomeça o contador de blocos, então só esta
// profundidade (que atravessa os awaits) segura a cadeia dentro de um mesmo evento.
const MAX_CADEIA_FLUXOS = 3;
const cadeiaFluxos = new AsyncLocalStorage<number>();

/** Adiciona/remove etiquetas de uma conversa (sem duplicar). Nunca derruba o fluxo do robô. */
/**
 * `automacoes: false` só grava a etiqueta, sem disparar regras nem fluxos (ação em massa e importação:
 * etiquetar 5.000 contatos não pode mandar mensagem para 5.000 pessoas).
 */
export async function etiquetar(
  conversaId: string,
  adicionar: string[] = [],
  remover: string[] = [],
  opcoes: { automacoes?: boolean } = {},
): Promise<string[] | null> {
  try {
    const c = await prisma.igConversation.findUnique({ where: { id: conversaId }, select: { tags: true } });
    if (!c) return null;
    const rem = new Set(remover.map(limpa));
    const novas = [...new Set([...c.tags, ...adicionar.map(limpa)])].filter((t) => t && !rem.has(t));
    if (novas.length === c.tags.length && novas.every((t, i) => t === c.tags[i])) return c.tags;
    await prisma.igConversation.update({ where: { id: conversaId }, data: { tags: novas } });
    if (opcoes.automacoes === false) return novas;
    await aplicarRegrasEtiquetas(conversaId, c.tags, novas);
    // Fluxos com gatilho "etiqueta aplicada" (import dinâmico: igFluxos também usa etiquetar).
    // Quem decide se o robô pode falar (atendente ativa, fila da equipe, encerrada) é o iniciarFluxo (igEstado);
    // aqui só vale a profundidade máxima da cadeia.
    const nivel = cadeiaFluxos.getStore() ?? 0;
    const aplicadas = novas.filter((x) => !c.tags.includes(x));
    if (aplicadas.length) {
      if (nivel >= MAX_CADEIA_FLUXOS) {
        console.warn(`[ig-tags] conversa ${conversaId}: cadeia de fluxos por etiqueta passou de ${MAX_CADEIA_FLUXOS}, parado`);
      } else {
        const { tentarGatilhoPorEtiqueta } = await import("@/lib/igFluxos");
        await cadeiaFluxos.run(nivel + 1, async () => {
          for (const t of aplicadas) {
            await tentarGatilhoPorEtiqueta(conversaId, t).catch((e) => console.error("[ig-tags] fluxo por etiqueta", e));
          }
        });
      }
    }
    return novas;
  } catch (e) {
    console.error("[ig-tags]", e);
    return null;
  }
}
