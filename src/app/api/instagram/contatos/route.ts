import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { dentroDaJanela } from "@/lib/instagram";
import { ORDENS, camposDe, contagemTags, filtroDaUrl, origemDe, whereContatos } from "@/lib/igContatos";

// Aba Contatos: lista paginada com busca, filtros e ordenação (como a de contatos do ManyChat).
// ?q=&conta=&incluir=a,b&modoIncluir=todas&excluir=c&origem=anuncio|story|organico|sem&status=&segMin=&campo=&valor=&ordem=&pagina=&porPagina=
export async function GET(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const sp = req.nextUrl.searchParams;
  const filtro = filtroDaUrl(sp);
  const where = whereContatos(filtro);
  const porPagina = Math.min(100, Math.max(10, Number(sp.get("porPagina")) || 25));
  const pagina = Math.max(1, Math.floor(Number(sp.get("pagina")) || 1));
  const ordem = ORDENS[sp.get("ordem") ?? ""] ? (sp.get("ordem") as string) : "recentes";

  const [total, linhas, contas, campos, tags] = await Promise.all([
    prisma.igConversation.count({ where }),
    prisma.igConversation.findMany({
      where,
      orderBy: ORDENS[ordem],
      skip: (pagina - 1) * porPagina,
      take: porPagina,
      include: {
        account: { select: { username: true, loja: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { text: true, direction: true, source: true, createdAt: true } },
      },
    }),
    prisma.instagramAccount.findMany({ select: { id: true, username: true, loja: true, active: true }, orderBy: { createdAt: "asc" } }),
    prisma.igCampo.findMany({ where: filtro.accountId ? { accountId: filtro.accountId } : {}, orderBy: [{ accountId: "asc" }, { nome: "asc" }] }),
    contagemTags(filtro.accountId),
  ]);

  return NextResponse.json({
    total,
    pagina,
    porPagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
    ordem,
    contas,
    campos: campos.map((c) => ({ id: c.id, accountId: c.accountId, nome: c.nome, tipo: c.tipo })),
    tags,
    contatos: linhas.map((c) => {
      const m = c.messages[0];
      return {
        id: c.id,
        accountId: c.accountId,
        conta: c.account.username,
        loja: c.account.loja,
        cliente: c.igScopedUserId.slice(-6),
        nome: c.nome,
        username: c.username,
        fotoUrl: c.fotoUrl,
        seguidores: c.seguidores,
        verificado: c.verificado,
        seguePagina: c.seguePagina,
        status: c.status,
        naoLida: c.naoLida,
        tags: c.tags,
        origem: origemDe(c.tags),
        campos: camposDe(c.campos),
        janelaAberta: dentroDaJanela(c.lastCustomerMessageAt),
        primeiroContato: c.createdAt.toISOString(),
        ultimaEm: (m?.createdAt ?? c.lastCustomerMessageAt ?? c.updatedAt).toISOString(),
        ultima: m ? { de: m.direction === "IN" ? "cliente" : m.source === "HUMANO" ? "equipe" : "robo", texto: m.text } : null,
      };
    }),
  });
}
