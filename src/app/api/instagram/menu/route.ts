import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { exigirAdmin } from "@/lib/igAdmin";
import type { Loja } from "@/lib/avaliacoesLeitura";

const GRAPH = `${process.env.IG_GRAPH_BASE ?? "https://graph.instagram.com"}/${process.env.IG_GRAPH_VERSION ?? "v23.0"}`;
const lojaValida = (l: unknown): l is Loja => l === "bff" || l === "moranga";

const PADRAO: Record<Loja, { iniciadores: string; menu: string }> = {
  bff: {
    iniciadores: "Qual o pedido mínimo?\nComo faço para pagar?\nQual o prazo de entrega?\nComo rastreio meu pedido?",
    menu: "Baixar o app | https://converta.app/redirectbff.html\nVer o site | https://www.bfffitnessatacado.com.br?parceiro=4273\nRastrear meu pedido",
  },
  moranga: { iniciadores: "", menu: "Ver o site | https://www.usemoranga.com.br" },
};

const linhas = (t: string, max: number, tam: number) =>
  t.split("\n").map((l) => l.trim().slice(0, tam)).filter(Boolean).slice(0, max);

// Lê os iniciadores de conversa e o menu principal da loja (o salvo, ou o padrão).
export async function GET(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const loja = req.nextUrl.searchParams.get("loja");
  if (!lojaValida(loja)) return NextResponse.json({ error: "Use ?loja=bff|moranga" }, { status: 400 });
  const row = await prisma.igBoasVindas.findUnique({ where: { loja }, select: { iniciadores: true, menu: true } });
  const usa = row && (row.iniciadores || row.menu) ? row : PADRAO[loja];
  return NextResponse.json({ iniciadores: usa.iniciadores, menu: usa.menu, salvo: !!(row && (row.iniciadores || row.menu)) });
}

// Salva e PUBLICA no Instagram (chat novo: perguntas frequentes; menu: ícone de hambúrguer no direct).
export async function PUT(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const body = (await req.json().catch(() => null)) as { loja?: string; iniciadores?: string; menu?: string } | null;
  if (!body || !lojaValida(body.loja)) return NextResponse.json({ error: "Loja inválida" }, { status: 400 });

  const iniciadores = linhas(body.iniciadores ?? "", 4, 80);
  const menu = linhas(body.menu ?? "", 5, 120);

  // O padrão de boas-vindas precisa existir para guardar estas colunas.
  const { PADRAO: BV } = await import("@/lib/igBoasVindas");
  const base = BV[body.loja];
  await prisma.igBoasVindas.upsert({
    where: { loja: body.loja },
    create: { loja: body.loja, ...base, iniciadores: iniciadores.join("\n"), menu: menu.join("\n") },
    update: { iniciadores: iniciadores.join("\n"), menu: menu.join("\n") },
  });

  const contas = await prisma.instagramAccount.findMany({ where: { loja: body.loja, active: true } });
  const resultados: string[] = [];
  for (const c of contas) {
    const token = decrypt(c.accessToken);
    const chamada = (corpo: unknown) =>
      fetch(`${GRAPH}/${c.igUserId}/messenger_profile`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });

    const ib = await chamada({
      platform: "instagram",
      ice_breakers: iniciadores.length
        ? [{ locale: "default", call_to_actions: iniciadores.map((q) => ({ question: q, payload: "IB" })) }]
        : [],
    });
    resultados.push(`iniciadores @${c.username}: ${ib.ok ? "ok" : `erro ${ib.status} ${(await ib.text()).slice(0, 160)}`}`);

    const itens = menu.map((l) => {
      const [titulo, url] = l.split("|").map((p) => p.trim());
      return url && /^https:\/\//i.test(url)
        ? { type: "web_url", title: titulo.slice(0, 30), url }
        : { type: "postback", title: titulo.slice(0, 30), payload: "MENU" };
    });
    const pm = await chamada({
      platform: "instagram",
      persistent_menu: itens.length ? [{ locale: "default", call_to_actions: itens }] : [],
    });
    resultados.push(`menu @${c.username}: ${pm.ok ? "ok" : `erro ${pm.status} ${(await pm.text()).slice(0, 160)}`}`);
  }
  return NextResponse.json({ ok: true, resultados });
}
