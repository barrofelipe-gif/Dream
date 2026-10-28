import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { ADAPTADORES } from "@/lib/social";
import { lojaDoPainel } from "@/lib/igLoja";
import { REDES } from "@/lib/social/types";

// As contas do Instagram já conectadas viram contas do publicador (o token é copiado já criptografado).
async function sincronizarInstagram() {
  const contas = await prisma.instagramAccount.findMany({ where: { active: true } });
  for (const c of contas) {
    await prisma.socialConta.upsert({
      where: { rede_externoId: { rede: "instagram", externoId: c.igUserId } },
      create: {
        rede: "instagram",
        externoId: c.igUserId,
        loja: c.loja,
        nome: c.username,
        username: c.username,
        accessToken: c.accessToken,
        ativo: true,
      },
      update: { loja: c.loja, username: c.username, nome: c.username, accessToken: c.accessToken, ativo: true },
    });
  }
}

// Lista as redes (com o que falta para cada uma) e as contas conectadas. Nunca devolve tokens.
export async function GET() {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  await sincronizarInstagram();

  // Só as redes da empresa escolhida no topo do painel.
  const contas = await prisma.socialConta.findMany({
    where: { ativo: true, loja: await lojaDoPainel() },
    orderBy: [{ rede: "asc" }, { createdAt: "asc" }],
    select: { id: true, rede: true, loja: true, nome: true, username: true, fotoUrl: true, expiraEm: true },
  });
  const redes = REDES.map((r) => {
    const a = ADAPTADORES[r];
    return {
      rede: r,
      rotulo: a.rotulo,
      disponivel: a.disponivel,
      limites: a.limites,
      pendencias: a.pendencias(),
      conectar: { bff: a.urlConectar("bff"), moranga: a.urlConectar("moranga") },
    };
  });
  return NextResponse.json({ redes, contas });
}
