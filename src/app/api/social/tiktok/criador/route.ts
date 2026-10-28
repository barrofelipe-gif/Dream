import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { abrirConta } from "@/lib/social/contas";
import { adaptador, lerCriador } from "@/lib/social/tiktok";

export const dynamic = "force-dynamic";

// Dados do criador no TikTok (apelido, foto, privacidades e interações permitidas, duração máxima).
// A TikTok pede para ler isto toda vez que a tela de postar abre: /api/social/tiktok/criador?contaId=...
export async function GET(req: NextRequest) {
  const ad = await exigirAdmin();
  if (ad.erro) return ad.erro;

  const contaId = req.nextUrl.searchParams.get("contaId");
  if (!contaId) return NextResponse.json({ error: "Informe ?contaId=" }, { status: 400 });
  const conta = await abrirConta(contaId);
  if (!conta || conta.rede !== "tiktok") return NextResponse.json({ error: "Conta do TikTok não encontrada" }, { status: 404 });

  try {
    // O token do TikTok vale 24 h: renova se estiver perto de vencer e guarda o novo.
    if (adaptador.renovar && conta.expiraEm && conta.expiraEm.getTime() < Date.now() + 10 * 60_000) {
      const novo = await adaptador.renovar(conta);
      if (novo) {
        conta.accessToken = novo.accessToken;
        await prisma.socialConta.update({
          where: { id: conta.id },
          data: {
            accessToken: encrypt(novo.accessToken),
            ...(novo.refreshToken ? { refreshToken: encrypt(novo.refreshToken) } : {}),
            expiraEm: novo.expiraEm ?? null,
          },
        });
      }
    }
    const criador = await lerCriador(conta.accessToken);
    return NextResponse.json({ criador }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // Ex.: spam_risk_too_many_posts = a conta não pode postar agora.
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
