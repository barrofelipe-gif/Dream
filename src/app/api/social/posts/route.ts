import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { publicarPost } from "@/lib/social/publicar";

// Publicar em várias redes (com vídeo) demora: o plano gratuito da Vercel aceita até 60 segundos.
export const maxDuration = 60;

// Lista as postagens (as mais recentes primeiro) com o resultado por rede.
export async function GET() {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const posts = await prisma.socialPost.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { alvos: { include: { conta: { select: { rede: true, loja: true, username: true, nome: true } } } } },
  });
  return NextResponse.json({
    posts: posts.map((p) => ({
      id: p.id,
      titulo: p.titulo,
      legenda: p.legenda,
      tipo: p.tipo,
      midias: JSON.parse(p.midias || "[]"),
      porRede: JSON.parse(p.porRede || "{}"),
      agendadoPara: p.agendadoPara,
      status: p.status,
      createdAt: p.createdAt,
      alvos: p.alvos.map((a) => ({
        id: a.id,
        contaId: a.contaId,
        rede: a.conta.rede,
        loja: a.conta.loja,
        conta: a.conta.username ?? a.conta.nome,
        status: a.status,
        url: a.url,
        erro: a.erro,
        publicadoEm: a.publicadoEm,
      })),
    })),
  });
}

type Corpo = {
  titulo?: string;
  legenda?: string;
  tipo?: string;
  midias?: { url: string; tipo: "imagem" | "video"; nome?: string; capaUrl?: string }[];
  porRede?: Record<string, unknown>;
  contaIds?: string[];
  agendadoPara?: string | null;
  /** "publicar" sai agora; "agendar" espera agendadoPara; qualquer outro valor salva como rascunho. */
  acao?: "publicar" | "agendar" | "rascunho";
};

// Cria a postagem. Com acao "publicar" já sai em todas as redes escolhidas (cada uma independente).
export async function POST(req: NextRequest) {
  const { erro, session } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => null)) as Corpo | null;
  if (!b) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const contaIds = [...new Set(b.contaIds ?? [])];
  const midias = (b.midias ?? []).filter((m) => /^https:\/\//i.test(m.url));
  if (contaIds.length === 0) return NextResponse.json({ error: "Escolha pelo menos uma rede/conta" }, { status: 400 });
  if (!(b.legenda ?? "").trim() && midias.length === 0) return NextResponse.json({ error: "Escreva o texto ou adicione uma foto ou vídeo" }, { status: 400 });

  const acao = b.acao ?? "rascunho";
  const quando = b.agendadoPara ? new Date(b.agendadoPara) : null;
  if (acao === "agendar" && (!quando || Number.isNaN(quando.getTime()) || quando.getTime() < Date.now() - 60_000)) {
    return NextResponse.json({ error: "Escolha uma data e hora no futuro" }, { status: 400 });
  }

  const tipo = b.tipo ?? (midias.length > 1 ? "carrossel" : midias[0]?.tipo === "video" ? "video" : midias.length ? "imagem" : "texto");
  const post = await prisma.socialPost.create({
    data: {
      titulo: (b.titulo ?? "").slice(0, 150),
      legenda: b.legenda ?? "",
      tipo,
      midias: JSON.stringify(midias),
      porRede: JSON.stringify(b.porRede ?? {}),
      agendadoPara: acao === "agendar" ? quando : null,
      status: acao === "agendar" ? "AGENDADO" : "RASCUNHO",
      criadoPor: session?.user?.email ?? null,
      alvos: { create: contaIds.map((contaId) => ({ contaId })) },
    },
  });

  if (acao === "publicar") {
    const r = await publicarPost(post.id);
    return NextResponse.json({ ok: true, id: post.id, status: r.status });
  }
  return NextResponse.json({ ok: true, id: post.id, status: post.status });
}
