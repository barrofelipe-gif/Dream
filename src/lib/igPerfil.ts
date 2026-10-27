import "server-only";
import { prisma } from "@/lib/prisma";
import { buscarPerfil } from "@/lib/instagram";
import { inscreverSeguidorBff } from "@/lib/igSequencias";

const DOZE_HORAS = 12 * 60 * 60 * 1000;
const DOIS_MINUTOS = 2 * 60 * 1000;

/**
 * Busca no Instagram o perfil de quem escreveu (foto, @, seguidores, se segue a loja) e grava na conversa.
 * Só refaz se passou de ~12h (a foto da Meta vem com URL que expira); quem ainda não segue é conferido de novo a cada
 * ~2 min, que é como se percebe que passou a seguir. Nunca derruba quem chamou.
 * `aoPassarASeguir`: só o webhook (mensagem do cliente) passa true; abrir a conversa no painel não dispara mensagens.
 */
export async function atualizarPerfil(conversaId: string, forcar = false, opts: { aoPassarASeguir?: boolean } = {}): Promise<void> {
  try {
    const c = await prisma.igConversation.findUnique({ where: { id: conversaId }, include: { account: true } });
    if (!c) return;
    // A conferência curta é só do webhook: se o painel atualizasse o "segue" antes, a mensagem seguinte não perceberia a mudança.
    const validade = opts.aoPassarASeguir && c.seguePagina === false ? DOIS_MINUTOS : DOZE_HORAS;
    if (!forcar && c.perfilEm && Date.now() - c.perfilEm.getTime() < validade) return;

    const p = await buscarPerfil(c.account.accessToken, c.igScopedUserId);
    // Marca a tentativa mesmo se falhar, para não bater na Meta a cada mensagem.
    await prisma.igConversation.update({
      where: { id: c.id },
      data: p ? { ...p, perfilEm: new Date() } : { perfilEm: new Date() },
    });
    // Não seguia e agora segue (BFF): entra nas boas-vindas de seguidor.
    if (opts.aoPassarASeguir && c.seguePagina === false && p?.seguePagina === true && c.account.loja === "bff") {
      await inscreverSeguidorBff(c.accountId, c.id).catch((e) => console.warn("[ig-perfil] boas-vindas seguidor", e));
    }
  } catch (err) {
    console.warn("[ig-perfil] falha ao atualizar", err);
  }
}
