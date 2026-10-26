import type { ContaAberta, EntradaPublicar, RedeAdapter, SaidaPublicar } from "@/lib/social/types";

/** Base da API v5. PINTEREST_SANDBOX=1 aponta ao ambiente de testes (acesso Trial). */
export function pinterestBase(): string {
  return process.env.PINTEREST_SANDBOX === "1" ? "https://api-sandbox.pinterest.com/v5" : "https://api.pinterest.com/v5";
}

/** Escopos pedidos no OAuth (confirmados na doc v5 do Pinterest). */
export const PINTEREST_ESCOPOS = ["boards:read", "pins:read", "pins:write", "user_accounts:read"];

/** Cabeçalho Basic (app id:secret) usado nas chamadas a /oauth/token. */
export function pinterestBasic(): string {
  const id = process.env.PINTEREST_APP_ID ?? "";
  const secret = process.env.PINTEREST_APP_SECRET ?? "";
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Extrai uma mensagem legível de um erro do Pinterest. */
function mensagemErro(texto: string): string {
  try {
    const j = JSON.parse(texto) as { message?: string; code?: number };
    if (j.message) return j.code ? `${j.message} (código ${j.code})` : j.message;
  } catch {
    /* mantém o texto cru */
  }
  return texto.slice(0, 300);
}

export async function pinterestChamar<T>(token: string, caminho: string, corpo?: unknown): Promise<T> {
  const res = await fetch(`${pinterestBase()}/${caminho}`, {
    method: corpo !== undefined ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const texto = await res.text();
  if (!res.ok) {
    let msg = mensagemErro(texto);
    if (res.status === 401) msg += " (reconecte a conta do Pinterest)";
    if (/consumer type|not supported/i.test(msg)) msg += " (o app ainda está aguardando a liberação do acesso Trial/Standard no Pinterest)";
    throw new Error(`Pinterest recusou: ${msg}`);
  }
  return texto ? (JSON.parse(texto) as T) : ({} as T);
}

/** Vídeo: registra a mídia, envia o arquivo e espera o processamento. Devolve o media_id. */
async function enviarVideo(token: string, url: string): Promise<string> {
  const reg = await pinterestChamar<{ media_id: string | number; upload_url: string; upload_parameters: Record<string, string> }>(token, "media", {
    media_type: "video",
  });
  const mediaId = String(reg.media_id);

  const origem = await fetch(url);
  if (!origem.ok) throw new Error(`Pinterest: não consegui baixar o vídeo (${origem.status}).`);
  const arquivo = await origem.blob();

  // Os campos de upload_parameters vêm primeiro e o arquivo ("file") por último; sem Authorization.
  const form = new FormData();
  for (const [k, v] of Object.entries(reg.upload_parameters)) form.append(k, v);
  form.append("file", arquivo, "video.mp4");
  const up = await fetch(reg.upload_url, { method: "POST", body: form });
  if (!up.ok && up.status !== 204) throw new Error(`Pinterest: falha ao enviar o vídeo (${up.status}).`);

  for (let i = 0; i < 30; i++) {
    const s = await pinterestChamar<{ status?: string }>(token, `media/${mediaId}`);
    if (s.status === "succeeded") return mediaId;
    if (s.status === "failed") throw new Error("O Pinterest não conseguiu processar o vídeo.");
    await espera(10000);
  }
  throw new Error("O Pinterest demorou demais para processar o vídeo.");
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export const adaptador: RedeAdapter = {
  rede: "pinterest",
  rotulo: "Pinterest",
  disponivel: Boolean(process.env.PINTEREST_APP_ID && process.env.PINTEREST_APP_SECRET),
  limites: {
    legendaMax: 800,
    tipos: ["imagem", "video", "carrossel"],
    carrosselMax: 5,
    observacao:
      "Cada pin vai para um quadro (obrigatório). Título até 100 e descrição até 800 caracteres. Carrossel de 2 a 5 imagens.",
  },
  pendencias: () => {
    const p: string[] = [];
    if (!process.env.PINTEREST_APP_ID || !process.env.PINTEREST_APP_SECRET) {
      p.push("Faltam as variáveis PINTEREST_APP_ID e PINTEREST_APP_SECRET (criar o app em developers.pinterest.com).");
    }
    p.push(
      "Enquanto o app tiver só o acesso Trial, os pins criados são de teste (sandbox) e não aparecem no Pinterest de verdade. Peça o acesso Standard (veja docs/social/pinterest.md).",
    );
    if (process.env.PINTEREST_SANDBOX === "1") p.push("PINTEREST_SANDBOX=1 está ligado: a API de testes está em uso.");
    return p;
  },
  urlConectar: (loja) => `/api/social/pinterest/conectar?loja=${loja}`,
  validar: (e) => {
    const erros: string[] = [];
    const o = e.opcoes ?? {};
    if (!texto(o.boardId)) erros.push("Pinterest: escolha o quadro (board) onde o pin será criado.");
    const titulo = texto(o.titulo) || (e.titulo ?? "").trim();
    if (titulo.length > 100) erros.push("Pinterest: o título passa de 100 caracteres.");
    if (e.legenda.length > 800) erros.push("Pinterest: a descrição passa de 800 caracteres.");
    if (texto(o.altTexto).length > 500) erros.push("Pinterest: o texto alternativo passa de 500 caracteres.");
    const link = texto(o.link);
    if (link && !/^https?:\/\//i.test(link)) erros.push("Pinterest: o link de destino precisa começar com http:// ou https://.");
    if (link.length > 2048) erros.push("Pinterest: o link de destino passa de 2.048 caracteres.");
    if (e.midias.length === 0) erros.push("Pinterest: precisa de pelo menos uma imagem ou vídeo.");
    if (e.tipo === "carrossel") {
      if (e.midias.length < 2 || e.midias.length > 5) erros.push("Pinterest: o carrossel precisa de 2 a 5 imagens.");
      if (e.midias.some((m) => m.tipo === "video")) erros.push("Pinterest: carrossel aceita só imagens.");
    }
    if (e.tipo === "video" && e.midias[0]?.tipo !== "video") erros.push("Pinterest: o tipo vídeo precisa de um arquivo de vídeo.");
    if (e.tipo === "texto") erros.push("Pinterest: não aceita publicação só de texto.");
    return erros;
  },
  async publicar(e: EntradaPublicar): Promise<SaidaPublicar> {
    const token = e.conta.accessToken;
    const o = e.opcoes ?? {};
    const boardId = texto(o.boardId);
    if (!boardId) throw new Error("Pinterest: escolha o quadro (board).");
    const titulo = texto(o.titulo) || (e.titulo ?? "").trim();
    const link = texto(o.link);
    const alt = texto(o.altTexto);

    let media_source: Record<string, unknown>;
    if (e.tipo === "carrossel" || e.midias.length > 1) {
      media_source = {
        source_type: "multiple_image_urls",
        items: e.midias.slice(0, 5).map((m) => ({ url: m.url, ...(link ? { link } : {}) })),
      };
    } else {
      const m = e.midias[0];
      if (!m) throw new Error("Pinterest: nenhuma mídia para publicar.");
      if (m.tipo === "video") {
        const mediaId = await enviarVideo(token, m.url);
        media_source = { source_type: "video_id", media_id: mediaId, ...(m.capaUrl ? { cover_image_url: m.capaUrl } : {}) };
      } else {
        media_source = { source_type: "image_url", url: m.url };
      }
    }

    const pin = await pinterestChamar<{ id: string }>(token, "pins", {
      board_id: boardId,
      ...(titulo ? { title: titulo.slice(0, 100) } : {}),
      description: e.legenda.slice(0, 800),
      ...(link ? { link } : {}),
      ...(alt ? { alt_text: alt.slice(0, 500) } : {}),
      media_source,
    });
    return { externoId: String(pin.id), url: `https://www.pinterest.com/pin/${pin.id}/` };
  },
  async renovar(conta: ContaAberta) {
    if (!conta.refreshToken) return null;
    // Renova quando faltam menos de 5 dias (ou se não sabemos quando vence).
    if (conta.expiraEm && conta.expiraEm.getTime() - Date.now() > 5 * 24 * 3600 * 1000) return null;
    const res = await fetch(`${pinterestBase()}/oauth/token`, {
      method: "POST",
      headers: { Authorization: pinterestBasic(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conta.refreshToken }),
    });
    const t = await res.text();
    if (!res.ok) throw new Error(`Pinterest recusou a renovação: ${mensagemErro(t)} (reconecte a conta)`);
    const j = JSON.parse(t) as { access_token: string; refresh_token?: string; expires_in?: number };
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiraEm: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : undefined,
    };
  },
};
