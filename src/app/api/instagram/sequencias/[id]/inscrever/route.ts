import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { destinatarios } from "@/lib/igTransmissao";
import { inscrever, processarSequencias } from "@/lib/igSequencias";

export const maxDuration = 60;
const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : []);

/**
 * Inscreve na sequência:
 *  - { conversationId } → uma pessoa;
 *  - { incluirTags, excluirTags } → quem tem as etiquetas e falou com a loja nas últimas 24h (mesmo filtro da transmissão).
 * { previa: true } só conta quem entraria, sem inscrever. { reiniciar: true } recomeça quem já concluiu/parou.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const seq = await prisma.igSequencia.findUnique({ where: { id }, select: { id: true, accountId: true, ativa: true } });
  if (!seq) return NextResponse.json({ error: "Sequência não encontrada" }, { status: 404 });
  const reiniciar = b.reiniciar === true;

  let ids: string[];
  let exemplos: string[] = [];
  if (typeof b.conversationId === "string" && b.conversationId) {
    ids = [b.conversationId];
  } else {
    const alvos = await destinatarios(seq.accountId, lista(b.incluirTags), lista(b.excluirTags));
    ids = alvos.map((a) => a.id);
    exemplos = alvos.slice(0, 5).map((a) => a.nome || (a.username ? `@${a.username}` : "Cliente"));
  }

  if (b.previa === true) {
    const ja = await prisma.igSequenciaInscrito.findMany({ where: { sequenciaId: id, conversationId: { in: ids } }, select: { status: true } });
    const bloqueados = ja.filter((j) => j.status === "ATIVA" || !reiniciar).length;
    return NextResponse.json({ total: ids.length, novos: ids.length - bloqueados, jaInscritos: bloqueados, exemplos });
  }
  if (ids.length === 0) return NextResponse.json({ error: "Ninguém nesse filtro está dentro da janela de 24h" }, { status: 400 });

  let inscritos = 0;
  const motivos: Record<string, number> = {};
  for (const conversationId of ids) {
    const r = await inscrever(id, conversationId, { reiniciar });
    if (r.ok) inscritos++;
    else motivos[r.motivo] = (motivos[r.motivo] ?? 0) + 1;
  }
  if (inscritos > 0 && seq.ativa) after(() => processarSequencias().catch((e) => console.error("[sequencia]", e)));
  return NextResponse.json({ ok: true, inscritos, ignorados: ids.length - inscritos, motivos });
}
