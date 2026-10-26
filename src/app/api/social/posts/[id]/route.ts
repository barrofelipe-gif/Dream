import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { publicarPost } from "@/lib/social/publicar";

// POST = publicar agora (ou tentar de novo as redes que falharam).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  try {
    const r = await publicarPost(id);
    return NextResponse.json({ ok: true, status: r.status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}

// DELETE = apaga a postagem do painel (não apaga o que já foi publicado nas redes).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  await prisma.socialPost.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
