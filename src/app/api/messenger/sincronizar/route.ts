import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { paginasConectadas, sincronizarPagina } from "@/lib/messenger";

export const maxDuration = 60;

// Puxa o histórico recente das conversas do Messenger (só leitura; não envia nada).
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { loja } = (await req.json().catch(() => ({}))) as { loja?: string };
  const paginas = await paginasConectadas(loja || undefined);
  const resultado = await Promise.all(
    paginas.map(async (p) => {
      try {
        return { pagina: p.nome, loja: p.loja, ...(await sincronizarPagina(p.id)) };
      } catch (e) {
        return { pagina: p.nome, loja: p.loja, erro: (e as Error).message };
      }
    }),
  );
  return NextResponse.json({ resultado });
}
