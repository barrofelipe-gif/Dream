import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { carregarConfig, PADRAO, type BoasVindasConfig } from "@/lib/igBoasVindas";
import { escreverInfoCompra } from "@/lib/igBot";
import type { Loja } from "@/lib/avaliacoesLeitura";

const lojaValida = (l: unknown): l is Loja => l === "bff" || l === "moranga";

// Lê a automação de boas-vindas da loja (o que está salvo, ou o padrão).
export async function GET(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const loja = req.nextUrl.searchParams.get("loja");
  if (!lojaValida(loja)) return NextResponse.json({ error: "Use ?loja=bff|moranga" }, { status: 400 });
  const salvo = !!(await prisma.igBoasVindas.findUnique({ where: { loja }, select: { id: true } }));
  return NextResponse.json({ config: await carregarConfig(loja), salvo, padrao: PADRAO[loja] });
}

// Salva a automação.
export async function PUT(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const body = (await req.json().catch(() => null)) as (Partial<BoasVindasConfig> & { loja?: string }) | null;
  if (!body || !lojaValida(body.loja)) return NextResponse.json({ error: "Loja inválida" }, { status: 400 });

  const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const dados = {
    ativo: !!body.ativo,
    mensagem: texto(body.mensagem, 900),
    botao: texto(body.botao, 20),
    pedirSeguir: !!body.pedirSeguir,
    textoSeguir: texto(body.textoSeguir, 300),
    infoTexto: texto(body.infoTexto, 1000),
    linkTitulo: texto(body.linkTitulo, 20),
    linkUrl: texto(body.linkUrl, 300),
  };
  if (!dados.mensagem) return NextResponse.json({ error: "Escreva a mensagem de boas-vindas" }, { status: 400 });
  if (dados.linkUrl && !/^https:\/\//i.test(dados.linkUrl)) {
    return NextResponse.json({ error: "O link precisa começar com https://" }, { status: 400 });
  }

  await prisma.igBoasVindas.upsert({
    where: { loja: body.loja },
    create: { loja: body.loja, ...dados },
    update: dados,
  });
  return NextResponse.json({ ok: true });
}

// Sugestão das informações de compra montada a partir da base da loja (não salva).
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const body = (await req.json().catch(() => null)) as { loja?: string } | null;
  if (!body || !lojaValida(body.loja)) return NextResponse.json({ error: "Loja inválida" }, { status: 400 });
  const texto = await escreverInfoCompra(body.loja).catch(() => null);
  if (!texto) return NextResponse.json({ error: "A base não tem informações suficientes para montar o texto." }, { status: 422 });
  return NextResponse.json({ texto });
}
