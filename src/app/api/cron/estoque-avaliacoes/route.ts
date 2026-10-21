import { NextRequest, NextResponse } from "next/server";
import { enviarEstoque, montarEstoque } from "@/lib/estoqueAvaliacoes";

// Todo dia (vercel.json): estoque, custo e venda de 30 dias por tamanho, da Tray para o sistema de avaliações
// (giro, cobertura, retorno e ofertas por produto). Protegido por CRON_SECRET, como o sync-gmail.
// Teste manual: curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/estoque-avaliacoes
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const t0 = Date.now();
  try {
    const { produtos, paginasVendas, variacoes, mes } = await montarEstoque();
    const r = await enviarEstoque(produtos, mes);
    return NextResponse.json({ ok: true, produtos: produtos.length, variacoes, paginasVendas, mes, enviados: r.saved, ms: Date.now() - t0 });
  } catch (e) {
    console.error("[estoque-avaliacoes]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }, { status: 500 });
  }
}
