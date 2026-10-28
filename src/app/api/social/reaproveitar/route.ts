import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { importarDoInstagram, listarParaReaproveitar } from "@/lib/social/reaproveitar";

// Baixar um Reel do Instagram e guardar no armazenamento pode levar alguns segundos.
export const maxDuration = 60;

// Posts do Instagram da BFF que mais cresceram e em quais redes já foram.
export async function GET() {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  return NextResponse.json({ itens: await listarParaReaproveitar() });
}

// Traz os arquivos de um post do Instagram para o publicador.
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => null)) as { externoId?: string } | null;
  try {
    return NextResponse.json(await importarDoInstagram(String(b?.externoId ?? "")));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Falha ao importar" }, { status: 400 });
  }
}
