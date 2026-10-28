import "server-only";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { abrirConta } from "@/lib/social/contas";
import type { Midia } from "@/lib/social/types";

/**
 * "Do Instagram para as outras redes": os posts da BFF que mais cresceram no Instagram (dados do coletor de
 * métricas) e em quais redes cada um já foi pelo painel. A postagem feita a partir de um post do Instagram
 * guarda a origem em porRede._origem = id da mídia, que é como sabemos que ele já foi.
 */
const GRAPH = `${process.env.IG_GRAPH_BASE ?? "https://graph.instagram.com"}/${process.env.IG_GRAPH_VERSION ?? "v23.0"}`;
const DIA_MS = 86_400_000;

async function contaInstagramBff() {
  return prisma.socialConta.findFirst({ where: { rede: "instagram", loja: "bff", ativo: true }, select: { id: true } });
}

export type ItemReaproveitar = {
  externoId: string;
  tipo: string;
  legenda: string;
  permalink: string | null;
  miniatura: string | null;
  publicadoEm: Date;
  alcance: number;
  compartilhamentos: number;
  salvamentos: number;
  taxaEngajamento: number;
  /** Redes onde já foi pelo painel, com o status da postagem (PUBLICADO, AGENDADO, ERRO…). */
  jaFoi: Record<string, string>;
};

export async function listarParaReaproveitar(limite = 12): Promise<ItemReaproveitar[]> {
  const conta = await contaInstagramBff();
  if (!conta) return [];
  const posts = await prisma.socialMetricaPost.findMany({
    where: { contaId: conta.id, tipo: { in: ["reel", "carrossel", "foto"] }, publicadoEm: { gte: new Date(Date.now() - 120 * DIA_MS) } },
    select: { externoId: true, tipo: true, legenda: true, permalink: true, miniatura: true, publicadoEm: true, alcance: true, compartilhamentos: true, salvamentos: true, interacoes: true },
  });
  // Crescimento: alcance, e envio e salvamento valem mais (é o que o Instagram e o TikTok mais premiam hoje).
  const nota = (p: (typeof posts)[number]) => p.alcance + 30 * p.compartilhamentos + 15 * p.salvamentos;
  const top = posts.sort((a, b) => nota(b) - nota(a)).slice(0, limite);
  if (!top.length) return [];
  const feitos = await prisma.socialPost.findMany({
    where: { OR: top.map((p) => ({ porRede: { contains: `"_origem":"${p.externoId}"` } })) },
    select: { porRede: true, status: true, alvos: { select: { status: true, conta: { select: { rede: true, loja: true } } } } },
  });
  // Por rede vale o melhor resultado (publicado > agendado > … > erro), e só das contas da BFF.
  const PESO: Record<string, number> = { PUBLICADO: 5, AGENDADO: 4, PUBLICANDO: 3, PENDENTE: 2, RASCUNHO: 1, ERRO: 0 };
  return top.map((p) => {
    const jaFoi: Record<string, string> = {};
    for (const f of feitos.filter((x) => x.porRede.includes(`"_origem":"${p.externoId}"`)))
      for (const a of f.alvos) {
        if (a.conta.loja !== "bff") continue;
        // Rascunho ainda não saiu: o post continua faltando nessa rede.
        const st = f.status === "RASCUNHO" ? "RASCUNHO" : a.status;
        const atual = jaFoi[a.conta.rede];
        if (atual === undefined || (PESO[st] ?? 0) > (PESO[atual] ?? 0)) jaFoi[a.conta.rede] = st;
      }
    return {
      externoId: p.externoId,
      tipo: p.tipo,
      legenda: p.legenda,
      permalink: p.permalink,
      miniatura: p.miniatura,
      publicadoEm: p.publicadoEm,
      alcance: p.alcance,
      compartilhamentos: p.compartilhamentos,
      salvamentos: p.salvamentos,
      taxaEngajamento: p.alcance ? Math.round((p.interacoes / p.alcance) * 1000) / 10 : 0,
      jaFoi,
    };
  });
}

type MidiaIg = { id: string; media_type?: string; media_url?: string; caption?: string; children?: { data?: { id: string; media_type?: string; media_url?: string }[] } };

/**
 * Baixa os arquivos originais de um post do Instagram (o endereço do Instagram vence em poucas horas) e guarda
 * no armazenamento do painel, pronto para publicar em outra rede.
 */
export async function importarDoInstagram(externoId: string): Promise<{ midias: Midia[]; legenda: string; tipo: "video" | "imagem" | "carrossel" }> {
  if (!/^\d+$/.test(externoId)) throw new Error("Post inválido.");
  const ref = await contaInstagramBff();
  const conta = ref ? await abrirConta(ref.id) : null;
  if (!conta) throw new Error("O Instagram da BFF não está conectado.");
  // Só posts que o coletor já viu nesta conta: o id não pode apontar para mídia de outra conta.
  const conhecido = await prisma.socialMetricaPost.findFirst({ where: { contaId: conta.id, externoId }, select: { id: true } });
  if (!conhecido) throw new Error("Esse post não é do Instagram da BFF.");

  const res = await fetch(`${GRAPH}/${externoId}?fields=media_type,media_url,caption,children{media_type,media_url}`, {
    headers: { Authorization: `Bearer ${conta.accessToken}` },
    cache: "no-store",
  });
  const m = (await res.json().catch(() => ({}))) as MidiaIg & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Instagram recusou: ${m.error?.message ?? res.status}`);

  const itens = m.media_type === "CAROUSEL_ALBUM" ? (m.children?.data ?? []) : [m];
  if (!itens.length || itens.some((i) => !i.media_url)) {
    throw new Error("O Instagram não libera o arquivo deste post (acontece com Reels que usam música da biblioteca). Baixe pelo app do Instagram e suba o arquivo aqui.");
  }
  // Os itens do carrossel vão ao mesmo tempo (a função tem 60 s); arquivo grande demais para caber nesse tempo é recusado antes.
  const LIMITE_BYTES = 200 * 1024 * 1024;
  const midias: Midia[] = await Promise.all(
    itens.map(async (it, i) => {
      const arq = await fetch(it.media_url!, { cache: "no-store" });
      if (!arq.ok || !arq.body) throw new Error("Não consegui baixar o arquivo do Instagram. Tente de novo.");
      if (Number(arq.headers.get("content-length") ?? 0) > LIMITE_BYTES) throw new Error("Vídeo grande demais para trazer direto: baixe pelo app do Instagram e suba o arquivo aqui.");
      const video = it.media_type === "VIDEO";
      const blob = await put(`publicador/ig-${externoId}-${i + 1}.${video ? "mp4" : "jpg"}`, arq.body, {
        access: "public",
        contentType: video ? "video/mp4" : "image/jpeg",
        addRandomSuffix: true,
      });
      return { url: blob.url, tipo: video ? ("video" as const) : ("imagem" as const), nome: `instagram-${i + 1}.${video ? "mp4" : "jpg"}` };
    }),
  );
  return { midias, legenda: m.caption ?? "", tipo: midias.length > 1 ? "carrossel" : midias[0].tipo === "video" ? "video" : "imagem" };
}
