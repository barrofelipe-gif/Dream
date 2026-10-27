import "server-only";
import { prisma } from "@/lib/prisma";
import { buscarPerfil } from "@/lib/instagram";
import { inscreverSeguidorBff } from "@/lib/igSequencias";

const DOZE_HORAS = 12 * 60 * 60 * 1000;

/**
 * Busca no Instagram o perfil de quem escreveu (foto, @, seguidores, se segue a loja) e grava na conversa.
 * Só refaz se passou de ~12h (a foto da Meta vem com URL que expira). Nunca derruba quem chamou.
 */
export async function atualizarPerfil(conversaId: string, forcar = false): Promise<void> {
  try {
    const c = await prisma.igConversation.findUnique({ where: { id: conversaId }, include: { account: true } });
    if (!c) return;
    // Quem ainda não segue é conferido a cada mensagem: é assim que se percebe que passou a seguir.
    if (!forcar && c.seguePagina !== false && c.perfilEm && Date.now() - c.perfilEm.getTime() < DOZE_HORAS) return;

    const p = await buscarPerfil(c.account.accessToken, c.igScopedUserId);
    // Marca a tentativa mesmo se falhar, para não bater na Meta a cada mensagem.
    await prisma.igConversation.update({
      where: { id: c.id },
      data: p ? { ...p, perfilEm: new Date() } : { perfilEm: new Date() },
    });
    // Não seguia e agora segue (BFF): entra nas boas-vindas de seguidor.
    if (c.seguePagina === false && p?.seguePagina === true && c.account.loja === "bff") {
      await inscreverSeguidorBff(c.accountId, c.id).catch((e) => console.warn("[ig-perfil] boas-vindas seguidor", e));
    }
  } catch (err) {
    console.warn("[ig-perfil] falha ao atualizar", err);
  }
}
