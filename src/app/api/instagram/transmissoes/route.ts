import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { lojaDoPainel } from "@/lib/igLoja";
import { destinatarios, processarTransmissoes } from "@/lib/igTransmissao";

export const maxDuration = 60;
const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : []);

export async function GET() {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const loja = await lojaDoPainel();
  const [transmissoes, contas] = await Promise.all([
    prisma.igTransmissao.findMany({ where: { account: { loja } }, orderBy: { createdAt: "desc" }, take: 20, include: { account: { select: { username: true, loja: true } } } }),
    prisma.instagramAccount.findMany({ where: { active: true, loja }, select: { id: true, username: true, loja: true } }),
  ]);
  return NextResponse.json({ transmissoes, contas });
}

// Cria e já começa a enviar. O envio continua pelo agendador de 5 em 5 minutos se a lista for grande.
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const texto = typeof b.texto === "string" ? b.texto.trim().slice(0, 900) : "";
  const nome = (typeof b.nome === "string" && b.nome.trim()) || `Transmissão ${new Date().toLocaleDateString("pt-BR")}`;
  if (!accountId || !texto) return NextResponse.json({ error: "Escolha a conta e escreva a mensagem" }, { status: 400 });
  const incluirTags = lista(b.incluirTags);
  const excluirTags = lista(b.excluirTags);
  const alvos = await destinatarios(accountId, incluirTags, excluirTags);
  if (alvos.length === 0) return NextResponse.json({ error: "Ninguém nesse filtro está dentro da janela de 24h" }, { status: 400 });
  const t = await prisma.igTransmissao.create({
    data: { accountId, nome: nome.slice(0, 60), texto, incluirTags, excluirTags, total: alvos.length, alvos: { create: alvos.map((a) => ({ conversationId: a.id })) } },
  });
  after(() => processarTransmissoes().catch((e) => console.error("[transmissao]", e)));
  return NextResponse.json({ ok: true, id: t.id, total: alvos.length });
}
