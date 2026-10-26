import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { etiquetar } from "@/lib/igTags";
import { LIMITE_ACAO_FILTRO, filtroDoCorpo, gravarCampos, normalizarValor, whereContatos } from "@/lib/igContatos";

export const maxDuration = 60;

const ACOES = ["ADICIONAR_TAG", "REMOVER_TAG", "ENCERRAR", "DEVOLVER_ROBO", "DEFINIR_CAMPO"] as const;
type Acao = (typeof ACOES)[number];

/**
 * Ação em massa sobre contatos (nada é enviado ao cliente: só muda etiquetas, status ou campos no nosso banco).
 * Corpo: { acao, ids?: string[], filtro?: {...mesmo filtro da lista}, tag?: string, campo?: string, valor?: unknown }
 * Com `ids` age só neles; sem `ids`, age em todos que batem com o `filtro` (até 5.000 por vez).
 */
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const acao = b.acao as Acao;
  if (!ACOES.includes(acao)) return NextResponse.json({ error: "Ação inválida" }, { status: 400 });

  const tag = typeof b.tag === "string" ? b.tag.trim() : "";
  if ((acao === "ADICIONAR_TAG" || acao === "REMOVER_TAG") && !tag) return NextResponse.json({ error: "Informe a etiqueta" }, { status: 400 });

  let ids: string[];
  if (Array.isArray(b.ids)) {
    ids = [...new Set(b.ids.filter((x): x is string => typeof x === "string" && x !== ""))];
    if (ids.length === 0) return NextResponse.json({ error: "Nenhum contato selecionado" }, { status: 400 });
    if (ids.length > LIMITE_ACAO_FILTRO) return NextResponse.json({ error: `No máximo ${LIMITE_ACAO_FILTRO} contatos por vez` }, { status: 400 });
  } else if (b.filtro && typeof b.filtro === "object") {
    const where = whereContatos(filtroDoCorpo(b.filtro));
    const total = await prisma.igConversation.count({ where });
    if (total > LIMITE_ACAO_FILTRO) {
      return NextResponse.json({ error: `O filtro tem ${total} contatos; o máximo por vez é ${LIMITE_ACAO_FILTRO}. Refine o filtro.` }, { status: 400 });
    }
    ids = (await prisma.igConversation.findMany({ where, select: { id: true } })).map((c) => c.id);
  } else {
    return NextResponse.json({ error: "Envie os ids ou o filtro" }, { status: 400 });
  }
  if (ids.length === 0) return NextResponse.json({ ok: true, afetados: 0 });

  let afetados = 0;
  if (acao === "ENCERRAR" || acao === "DEVOLVER_ROBO") {
    const r = await prisma.igConversation.updateMany({
      where: { id: { in: ids } },
      data: acao === "ENCERRAR" ? { status: "CLOSED", naoLida: false } : { status: "BOT" },
    });
    afetados = r.count;
  } else if (acao === "DEFINIR_CAMPO") {
    const campo = typeof b.campo === "string" ? b.campo : "";
    const contatos = await prisma.igConversation.findMany({ where: { id: { in: ids } }, select: { id: true, accountId: true } });
    const defs = await prisma.igCampo.findMany({ where: { nome: campo, accountId: { in: [...new Set(contatos.map((c) => c.accountId))] } } });
    if (defs.length === 0) return NextResponse.json({ error: "Campo não encontrado" }, { status: 400 });
    const tipoPorConta = new Map(defs.map((d) => [d.accountId, d.tipo]));
    const valores = new Map<string, ReturnType<typeof normalizarValor>>();
    for (const [conta, tipo] of tipoPorConta) valores.set(conta, normalizarValor(tipo, b.valor));
    const falhou = [...valores.values()].find((v) => !v.ok);
    if (falhou && !falhou.ok) return NextResponse.json({ error: `${campo}: ${falhou.erro}` }, { status: 400 });
    const alvo = contatos.filter((c) => tipoPorConta.has(c.accountId));
    await emLotes(alvo, async (c) => {
      const v = valores.get(c.accountId);
      if (v?.ok && (await gravarCampos(c.id, { [campo]: v.valor }))) afetados++;
    });
  } else {
    await emLotes(ids, async (id) => {
      const r = await etiquetar(id, acao === "ADICIONAR_TAG" ? [tag] : [], acao === "REMOVER_TAG" ? [tag] : [], { automacoes: false });
      if (r) afetados++;
    });
  }

  return NextResponse.json({ ok: true, afetados, total: ids.length });
}

/** Roda em lotes pequenos para não esgotar o pool de conexões. */
async function emLotes<T>(itens: T[], fn: (x: T) => Promise<void>, tamanho = 10) {
  for (let i = 0; i < itens.length; i += tamanho) await Promise.all(itens.slice(i, i + tamanho).map(fn));
}
