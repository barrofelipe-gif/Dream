import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { assinarPagina, definirRobo, statusPaginas } from "@/lib/messenger";

// Diagnóstico das Páginas (permissões, webhook, leitura) e as ações de ativar recebimento / ligar o robô.
export async function GET(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const loja = req.nextUrl.searchParams.get("loja") || undefined;
  return NextResponse.json({ paginas: await statusPaginas(loja) });
}

export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => ({}))) as { acao?: string; contaId?: string; ativo?: boolean };
  if (!b.contaId) return NextResponse.json({ error: "Escolha a Página" }, { status: 400 });
  try {
    if (b.acao === "assinar") await assinarPagina(b.contaId);
    else if (b.acao === "robo") await definirRobo(b.contaId, !!b.ativo);
    else return NextResponse.json({ error: "Ação desconhecida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
