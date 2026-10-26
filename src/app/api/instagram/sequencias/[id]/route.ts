import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { lerPassos } from "@/lib/igSequencias";

type Ctx = { params: Promise<{ id: string }> };
const etiqueta = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, 40) : null);

// Edita nome, passos, ativa, parar se responder e etiquetas. Inscritos ativos seguem do passo em que estão.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: {
    nome?: string;
    passos?: ReturnType<typeof lerPassos>;
    ativa?: boolean;
    pararSeResponder?: boolean;
    etiquetaAoEntrar?: string | null;
    etiquetaAoConcluir?: string | null;
  } = {};
  if (typeof b.nome === "string") {
    const nome = b.nome.trim().slice(0, 60);
    if (!nome) return NextResponse.json({ error: "O nome não pode ficar vazio" }, { status: 400 });
    data.nome = nome;
  }
  if ("passos" in b) {
    const passos = lerPassos(b.passos);
    if (passos.length === 0) return NextResponse.json({ error: "Escreva pelo menos uma mensagem" }, { status: 400 });
    data.passos = passos;
  }
  if (typeof b.ativa === "boolean") data.ativa = b.ativa;
  if (typeof b.pararSeResponder === "boolean") data.pararSeResponder = b.pararSeResponder;
  if ("etiquetaAoEntrar" in b) data.etiquetaAoEntrar = etiqueta(b.etiquetaAoEntrar);
  if ("etiquetaAoConcluir" in b) data.etiquetaAoConcluir = etiqueta(b.etiquetaAoConcluir);
  const r = await prisma.igSequencia.updateMany({ where: { id }, data });
  if (r.count === 0) return NextResponse.json({ error: "Sequência não encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// Apaga a sequência e todos os inscritos dela (as mensagens já enviadas continuam na conversa).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  await prisma.igSequencia.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
