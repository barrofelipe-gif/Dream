import { NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { lerPerfilGoogle } from "@/lib/social/googlePerfil";

// Perfil de pesquisa do Google da BFF, lido na hora da página pública (o Google não tem API para ele).
export async function GET() {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  try {
    return NextResponse.json(await lerPerfilGoogle());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Falha ao ler o perfil do Google" }, { status: 502 });
  }
}
