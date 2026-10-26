import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { destinatarios } from "@/lib/igTransmissao";

const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// Quantas pessoas receberiam com esse filtro (sem enviar nada).
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.accountId !== "string") return NextResponse.json({ error: "Conta obrigatória" }, { status: 400 });
  const alvos = await destinatarios(b.accountId, lista(b.incluirTags), lista(b.excluirTags));
  return NextResponse.json({ total: alvos.length, exemplos: alvos.slice(0, 5).map((a) => a.nome || (a.username ? `@${a.username}` : "Cliente")) });
}
