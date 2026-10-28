import { FalhaDefinitiva, PublicacaoPendente, type EntradaPublicar, type RedeAdapter, type SaidaPublicar } from "@/lib/social/types";

const GRAPH = `${process.env.IG_GRAPH_BASE ?? "https://graph.instagram.com"}/${process.env.IG_GRAPH_VERSION ?? "v23.0"}`;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chamar<T>(token: string, caminho: string, corpo?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${GRAPH}/${caminho}`, {
    method: corpo ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
    // Cada chamada tem limite: a função inteira morre em 60 s.
    signal: AbortSignal.timeout(8_000),
  });
  const texto = await res.text();
  if (!res.ok) {
    let msg = texto.slice(0, 300);
    try {
      msg = (JSON.parse(texto) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      /* mantém o texto cru */
    }
    if (/permission|scope|OAuth/i.test(msg)) msg += " (reconecte a conta do Instagram para liberar a permissão de publicar)";
    throw new Error(`Instagram recusou: ${msg}`);
  }
  return JSON.parse(texto) as T;
}

/** Situação de um contêiner: pronto para publicar, ainda processando, ou já publicado (uma execução anterior publicou). */
async function situacao(token: string, containerId: string): Promise<"pronto" | "processando" | "publicado"> {
  const s = await chamar<{ status_code?: string; status?: string }>(token, `${containerId}?fields=status_code,status`);
  if (s.status_code === "FINISHED") return "pronto";
  if (s.status_code === "PUBLISHED") return "publicado";
  if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new FalhaDefinitiva(`O Instagram não conseguiu processar o vídeo (${s.status ?? s.status_code}).`);
  return "processando";
}

/**
 * Vídeos e reels demoram a processar: espera o Instagram terminar, mas só até `prazo` (a função da Vercel
 * morre em 60 s, e o Instagram às vezes leva minutos). Devolve false se o prazo acabou antes.
 */
async function esperarPronto(token: string, containerId: string, prazo: number): Promise<boolean> {
  while (Date.now() < prazo) {
    if ((await situacao(token, containerId)) !== "processando") return true;
    await espera(3000);
  }
  return false;
}

async function publicarContainer(token: string, ig: string, containerId: string): Promise<SaidaPublicar> {
  const pub = await chamar<{ id: string }>(token, `${ig}/media_publish`, { creation_id: containerId });
  let url: string | undefined;
  try {
    url = (await chamar<{ permalink?: string }>(token, `${pub.id}?fields=permalink`)).permalink;
  } catch {
    /* o link é só um extra */
  }
  return { externoId: pub.id, url };
}

const PREFIXO_CONTAINER = "ig-container:";

export const adaptador: RedeAdapter = {
  rede: "instagram",
  rotulo: "Instagram",
  disponivel: true,
  limites: {
    legendaMax: 2200,
    tipos: ["imagem", "video", "carrossel"],
    carrosselMax: 10,
    videoMaxSegundos: 900,
    observacao: "Foto, reel (vídeo) e carrossel. As mídias precisam de endereço público (https).",
  },
  pendencias: () => [
    "A conta precisa ter a permissão de publicar (instagram_business_content_publish): clique em Reconectar na conta.",
  ],
  urlConectar: (loja) => `/api/instagram/connect?loja=${loja}`,
  validar: (e) => {
    const erros: string[] = [];
    if (e.legenda.length > 2200) erros.push("Instagram: a legenda passa de 2.200 caracteres.");
    if (e.midias.length === 0) erros.push("Instagram: precisa de pelo menos uma foto ou vídeo.");
    if (e.tipo === "carrossel" && (e.midias.length < 2 || e.midias.length > 10)) erros.push("Instagram: o carrossel precisa de 2 a 10 itens.");
    return erros;
  },
  async publicar(e: EntradaPublicar): Promise<SaidaPublicar> {
    const token = e.conta.accessToken;
    const ig = e.conta.externoId;
    // Deixa folga dentro dos 60 s da função para gravar o resultado.
    const prazo = Date.now() + 25_000;
    let containerId: string;

    if (e.midias.length > 1) {
      // Carrossel: cria cada item e depois o contêiner que junta todos.
      const filhos: string[] = [];
      for (const m of e.midias.slice(0, 10)) {
        const f = await chamar<{ id: string }>(token, `${ig}/media`, {
          is_carousel_item: true,
          ...(m.tipo === "video" ? { media_type: "VIDEO", video_url: m.url } : { image_url: m.url }),
        });
        // Vídeo dentro de carrossel precisa estar pronto antes de montar o carrossel: aqui não dá para continuar depois.
        if (m.tipo === "video" && !(await esperarPronto(token, f.id, prazo))) throw new Error("O Instagram demorou demais para processar um vídeo do carrossel. Tente de novo.");
        filhos.push(f.id);
      }
      const c = await chamar<{ id: string }>(token, `${ig}/media`, { media_type: "CAROUSEL", children: filhos, caption: e.legenda });
      containerId = c.id;
    } else {
      const m = e.midias[0];
      if (!m) throw new Error("Instagram: nenhuma mídia para publicar.");
      const c = await chamar<{ id: string }>(
        token,
        `${ig}/media`,
        m.tipo === "video"
          ? { media_type: "REELS", video_url: m.url, caption: e.legenda, ...(m.capaUrl ? { cover_url: m.capaUrl } : {}) }
          : { image_url: m.url, caption: e.legenda },
      );
      containerId = c.id;
      // Reel que não ficou pronto a tempo: o agendador de 5 min termina a publicação (concluir) — o contêiner vale 24 h.
      if (m.tipo === "video" && !(await esperarPronto(token, containerId, prazo))) throw new PublicacaoPendente(`${PREFIXO_CONTAINER}${containerId}`);
    }

    return publicarContainer(token, ig, containerId);
  },
  async concluir(conta, referencia) {
    if (!referencia.startsWith(PREFIXO_CONTAINER)) throw new Error("Referência de publicação desconhecida.");
    const containerId = referencia.slice(PREFIXO_CONTAINER.length);
    const sit = await situacao(conta.accessToken, containerId);
    if (sit === "processando") return null;
    // Uma execução anterior publicou e morreu antes de gravar: o post está no ar, só sem o link guardado.
    if (sit === "publicado") return { externoId: `${PREFIXO_CONTAINER}${containerId}` };
    return publicarContainer(conta.accessToken, conta.externoId, containerId);
  },
};
