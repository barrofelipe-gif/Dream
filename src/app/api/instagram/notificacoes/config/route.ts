import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";

// E-mails da equipe para avisos. Ficam guardados; hoje o aviso sai só no sino (o projeto não tem envio de e-mail).
export async function GET() {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const emails = await prisma.igConfigNotificacao.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ emails, envioDeEmail: false });
}

export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase().slice(0, 120) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  const item = await prisma.igConfigNotificacao.upsert({ where: { email }, create: { email }, update: { ativo: true } });
  return NextResponse.json({ ok: true, item });
}

// PATCH { id, ativo }
export async function PATCH(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.id !== "string" || typeof b.ativo !== "boolean") return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  await prisma.igConfigNotificacao.updateMany({ where: { id: b.id }, data: { ativo: b.ativo } });
  return NextResponse.json({ ok: true });
}

// DELETE ?id=X
export async function DELETE(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  await prisma.igConfigNotificacao.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
