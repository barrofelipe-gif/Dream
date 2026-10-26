import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { etiquetar } from "@/lib/igTags";
import { camposDe, gravarCampos, normalizarValor, type ValorCampo } from "@/lib/igContatos";

// Edita os campos personalizados de um contato (e, de quebra, etiquetas).
// Corpo: { campos?: { [nomeDoCampo]: valor | null }, tagAdd?: string, tagRemove?: string }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { campos?: Record<string, unknown>; tagAdd?: string; tagRemove?: string };

  const c = await prisma.igConversation.findUnique({ where: { id }, select: { accountId: true, campos: true, tags: true } });
  if (!c) return NextResponse.json({ error: "Contato não encontrado" }, { status: 404 });

  let tags = c.tags;
  if (body.tagAdd || body.tagRemove) {
    tags = (await etiquetar(id, body.tagAdd ? [body.tagAdd] : [], body.tagRemove ? [body.tagRemove] : [])) ?? c.tags;
  }

  let campos = camposDe(c.campos);
  if (body.campos && typeof body.campos === "object") {
    const definidos = await prisma.igCampo.findMany({ where: { accountId: c.accountId } });
    const porNome = new Map(definidos.map((d) => [d.nome, d]));
    const mudancas: Record<string, ValorCampo> = {};
    const erros: string[] = [];
    for (const [nome, bruto] of Object.entries(body.campos)) {
      const def = porNome.get(nome);
      if (!def) {
        erros.push(`"${nome}" não é um campo desta conta`);
        continue;
      }
      const r = normalizarValor(def.tipo, bruto);
      if (!r.ok) erros.push(`${nome}: ${r.erro}`);
      else mudancas[nome] = r.valor;
    }
    if (erros.length) return NextResponse.json({ error: erros.join(" · ") }, { status: 400 });
    if (Object.keys(mudancas).length) campos = (await gravarCampos(id, mudancas)) ?? campos;
  }

  return NextResponse.json({ ok: true, campos, tags });
}
