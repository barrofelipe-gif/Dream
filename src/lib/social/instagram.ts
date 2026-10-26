import type { EntradaPublicar, RedeAdapter, SaidaPublicar } from "@/lib/social/types";

const GRAPH = `${process.env.IG_GRAPH_BASE ?? "https://graph.instagram.com"}/${process.env.IG_GRAPH_VERSION ?? "v23.0"}`;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chamar<T>(token: string, caminho: string, corpo?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${GRAPH}/${caminho}`, {
    method: corpo ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
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

/** Vídeos e reels demoram a processar: espera o Instagram terminar antes de publicar. */
async function esperarPronto(token: string, containerId: string) {
  for (let i = 0; i < 40; i++) {
    const s = await chamar<{ status_code?: string; status?: string }>(token, `${containerId}?fields=status_code,status`);
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`O Instagram não conseguiu processar o vídeo (${s.status ?? s.status_code}).`);
    await espera(3000);
  }
  throw new Error("O Instagram demorou demais para processar o vídeo.");
}

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
    let containerId: string;

    if (e.midias.length > 1) {
      // Carrossel: cria cada item e depois o contêiner que junta todos.
      const filhos: string[] = [];
      for (const m of e.midias.slice(0, 10)) {
        const f = await chamar<{ id: string }>(token, `${ig}/media`, {
          is_carousel_item: true,
          ...(m.tipo === "video" ? { media_type: "VIDEO", video_url: m.url } : { image_url: m.url }),
        });
        if (m.tipo === "video") await esperarPronto(token, f.id);
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
      if (m.tipo === "video") await esperarPronto(token, containerId);
    }

    const pub = await chamar<{ id: string }>(token, `${ig}/media_publish`, { creation_id: containerId });
    let url: string | undefined;
    try {
      url = (await chamar<{ permalink?: string }>(token, `${pub.id}?fields=permalink`)).permalink;
    } catch {
      /* o link é só um extra */
    }
    return { externoId: pub.id, url };
  },
};
