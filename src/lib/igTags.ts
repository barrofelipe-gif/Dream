import { prisma } from "@/lib/prisma";

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

/** Adiciona/remove etiquetas de uma conversa (sem duplicar). Nunca derruba o fluxo do robô. */
export async function etiquetar(conversaId: string, adicionar: string[] = [], remover: string[] = []): Promise<string[] | null> {
  try {
    const c = await prisma.igConversation.findUnique({ where: { id: conversaId }, select: { tags: true } });
    if (!c) return null;
    const rem = new Set(remover.map(limpa));
    const novas = [...new Set([...c.tags, ...adicionar.map(limpa)])].filter((t) => t && !rem.has(t));
    if (novas.length === c.tags.length && novas.every((t, i) => t === c.tags[i])) return c.tags;
    await prisma.igConversation.update({ where: { id: conversaId }, data: { tags: novas } });
    return novas;
  } catch (e) {
    console.error("[ig-tags]", e);
    return null;
  }
}
