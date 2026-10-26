import "server-only";
import { prisma } from "@/lib/prisma";
import type { Rede } from "@/lib/social/types";
import { coletarInstagram } from "./instagram";
import { coletorEmBreve, type ColetorMetricas, type ResultadoColeta } from "./types";

export const COLETORES: Record<Rede, ColetorMetricas> = {
  instagram: { rede: "instagram", rotulo: "Instagram", disponivel: true, coletar: coletarInstagram },
  facebook: coletorEmBreve("facebook", "Facebook"),
  tiktok: coletorEmBreve("tiktok", "TikTok"),
  youtube: coletorEmBreve("youtube", "YouTube"),
  pinterest: coletorEmBreve("pinterest", "Pinterest"),
};

/** Coleta uma conta (escolhe o coletor pela rede). */
export async function coletarConta(contaId: string, dias = 30): Promise<ResultadoColeta> {
  const c = await prisma.socialConta.findUnique({ where: { id: contaId }, select: { rede: true } });
  if (!c) return { contaId, rede: "instagram", dias, diasGravados: 0, postsGravados: 0, publicoGravado: false, avisos: [], erro: "Conta não encontrada." };
  return COLETORES[c.rede as Rede].coletar(contaId, { dias });
}

/** Coleta todas as contas ativas de redes com coletor disponível, uma de cada vez. */
export async function coletarTodas(dias = 30): Promise<ResultadoColeta[]> {
  const contas = await prisma.socialConta.findMany({ where: { ativo: true }, select: { id: true, rede: true } });
  const out: ResultadoColeta[] = [];
  for (const c of contas) {
    if (!COLETORES[c.rede as Rede]?.disponivel) continue;
    try {
      out.push(await coletarConta(c.id, dias));
    } catch (e) {
      out.push({ contaId: c.id, rede: c.rede as Rede, dias, diasGravados: 0, postsGravados: 0, publicoGravado: false, avisos: [], erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
