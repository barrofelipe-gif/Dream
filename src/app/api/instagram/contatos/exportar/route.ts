import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { lojaDoPainel } from "@/lib/igLoja";
import { ORDENS, ORIGENS, ROTULO_STATUS, camposDe, celulaCsv, filtroDaUrl, origemDe, valorParaTexto, whereContatos } from "@/lib/igContatos";

export const maxDuration = 60;
const LIMITE = 20000;

const dataHora = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d) : "";

// CSV (UTF-8 com BOM, separador ";", abre direto no Excel) com os contatos do filtro atual.
// Mesmos parâmetros da lista (GET /api/instagram/contatos); ?ids=a,b exporta só os selecionados.
export async function GET(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const sp = req.nextUrl.searchParams;
  const filtro = filtroDaUrl(sp);
  const ids = (sp.get("ids") ?? "").split(",").filter(Boolean);
  const loja = await lojaDoPainel();
  const where = ids.length ? { id: { in: ids }, account: { loja } } : whereContatos(filtro, loja);
  const ordem = ORDENS[sp.get("ordem") ?? ""] ?? ORDENS.recentes;

  const [linhas, campos] = await Promise.all([
    prisma.igConversation.findMany({
      where,
      orderBy: ordem,
      take: LIMITE,
      include: {
        account: { select: { username: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { text: true, createdAt: true } },
      },
    }),
    prisma.igCampo.findMany({ where: filtro.accountId ? { accountId: filtro.accountId, account: { loja } } : { account: { loja } }, orderBy: { nome: "asc" } }),
  ]);

  // Um campo com o mesmo nome em duas contas vira uma coluna só.
  const nomesCampos = [...new Set(campos.map((c) => c.nome))];
  const tipo = new Map<string, string>();
  for (const c of campos) tipo.set(`${c.accountId}|${c.nome}`, c.tipo);

  // "Usuário" (e não "@"): a importação reconhece as duas, e "@" sozinho no Excel é lido como fórmula.
  const cabecalho = ["Nome", "Usuário", "Conta", "Seguidores", "Etiquetas", "Origem", "Status", ...nomesCampos, "Primeiro contato", "Última mensagem em", "Última mensagem"];
  const out: string[] = [cabecalho.map(celulaCsv).join(";")];
  for (const c of linhas) {
    const valores = camposDe(c.campos);
    const origem = origemDe(c.tags);
    const m = c.messages[0];
    out.push(
      [
        c.nome ?? "",
        // Sem o "@" na célula: no Excel uma célula que começa com @ é lida como fórmula.
        c.username ?? "",
        c.account.username ?? "",
        c.seguidores ?? "",
        c.tags.join(", "),
        origem ? ORIGENS[origem].rotulo : "",
        ROTULO_STATUS[c.status] ?? c.status,
        ...nomesCampos.map((n) => valorParaTexto(tipo.get(`${c.accountId}|${n}`), valores[n])),
        dataHora(c.createdAt),
        dataHora(m?.createdAt ?? c.lastCustomerMessageAt),
        (m?.text ?? "").replace(/\s+/g, " ").slice(0, 300),
      ]
        .map(celulaCsv)
        .join(";"),
    );
  }

  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return new NextResponse("﻿" + out.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contatos-instagram-${hoje}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
