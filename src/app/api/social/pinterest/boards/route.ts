import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { abrirConta } from "@/lib/social/contas";
import { pinterestChamar } from "@/lib/social/pinterest";

// Lista os quadros da conta para o painel escolher: /api/social/pinterest/boards?contaId=...
export async function GET(req: NextRequest) {
  const ad = await exigirAdmin();
  if (ad.erro) return ad.erro;

  const contaId = req.nextUrl.searchParams.get("contaId");
  if (!contaId) return NextResponse.json({ error: "Informe ?contaId=" }, { status: 400 });
  const conta = await abrirConta(contaId);
  if (!conta || conta.rede !== "pinterest") return NextResponse.json({ error: "Conta do Pinterest não encontrada" }, { status: 404 });

  try {
    const boards: { id: string; nome: string; privacidade: string }[] = [];
    let bookmark: string | undefined;
    for (let i = 0; i < 5; i++) {
      const r = await pinterestChamar<{ items?: { id: string; name: string; privacy?: string }[]; bookmark?: string | null }>(
        conta.accessToken,
        `boards?page_size=100${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ""}`,
      );
      for (const b of r.items ?? []) boards.push({ id: b.id, nome: b.name, privacidade: b.privacy ?? "PUBLIC" });
      if (!r.bookmark) break;
      bookmark = r.bookmark;
    }
    return NextResponse.json({ boards });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
