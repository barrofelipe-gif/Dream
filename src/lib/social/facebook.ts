import type { EntradaPublicar, RedeAdapter, SaidaPublicar } from "@/lib/social/types";

export const FB_GRAPH_VERSION = process.env.FB_GRAPH_VERSION ?? "v23.0";
export const FB_GRAPH = `https://graph.facebook.com/${FB_GRAPH_VERSION}`;

/** Permissões pedidas no login. Publicar e ler a Página; engajamento é para a fase 2 (comentários). */
// pages_messaging + pages_manage_metadata: mensagens da Página no painel (Messenger) e ligar o webhook da Página.
export const FB_ESCOPOS = ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "pages_manage_engagement", "pages_messaging", "pages_manage_metadata"];

type ErroGraph = { message?: string; code?: number; error_subcode?: number; type?: string };

/** Traduz o erro da Graph API para uma frase clara em português. */
function traduzirErro(status: number, erro?: ErroGraph): string {
  const msg = erro?.message ?? `erro ${status}`;
  const code = erro?.code;
  if (code === 190) {
    return `O acesso da Página venceu ou foi revogado. Reconecte o Facebook no painel. (${msg})`;
  }
  if (code === 200 || code === 10 || code === 283 || /permission/i.test(msg)) {
    return `Falta permissão para publicar nesta Página (pages_manage_posts). Reconecte a conta marcando todas as permissões e confira a revisão do app na Meta. (${msg})`;
  }
  if (code === 100 && /page|object|node/i.test(msg)) {
    return `A Página não foi encontrada ou o seu usuário não tem acesso a ela. Reconecte escolhendo esta Página. (${msg})`;
  }
  if (code === 368 || code === 4 || code === 17 || code === 32) {
    return `O Facebook limitou temporariamente as publicações desta Página. Tente de novo mais tarde. (${msg})`;
  }
  return msg;
}

async function chamar<T>(token: string, caminho: string, corpo?: Record<string, string>): Promise<T> {
  const res = await fetch(`${FB_GRAPH}/${caminho}`, {
    method: corpo ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}` },
    body: corpo ? new URLSearchParams(corpo) : undefined,
  });
  const texto = await res.text();
  if (!res.ok) {
    let erro: ErroGraph | undefined;
    try {
      erro = (JSON.parse(texto) as { error?: ErroGraph }).error;
    } catch {
      erro = { message: texto.slice(0, 300) };
    }
    throw new Error(`Facebook recusou: ${traduzirErro(res.status, erro)}`);
  }
  return JSON.parse(texto) as T;
}

const urlDe = (id: string) => `https://www.facebook.com/${id}`;
const primeiraUrl = (t: string) => t.match(/https?:\/\/[^\s]+/)?.[0];

export const adaptador: RedeAdapter = {
  rede: "facebook",
  rotulo: "Facebook",
  get disponivel() {
    return !!process.env.FB_APP_ID && !!process.env.FB_APP_SECRET;
  },
  limites: {
    legendaMax: 63206,
    tipos: ["texto", "imagem", "carrossel", "video"],
    carrosselMax: 10,
    observacao: "Publica em Páginas do Facebook: texto/link, foto, várias fotos e vídeo. As mídias precisam de endereço público (https).",
  },
  pendencias: () => {
    const p: string[] = [];
    if (!process.env.FB_APP_ID) p.push("Configurar a variável FB_APP_ID (id do app Meta) no servidor.");
    if (!process.env.FB_APP_SECRET) p.push("Configurar a variável FB_APP_SECRET (chave secreta do app Meta) no servidor.");
    p.push("Cadastrar o redirecionamento OAuth /api/social/facebook/callback no Login do Facebook do app.");
    p.push("Contas próprias funcionam em modo desenvolvimento; para outras pessoas, pedir a revisão (App Review) de pages_manage_posts e pages_read_engagement.");
    return p;
  },
  urlConectar: (loja) => `/api/social/facebook/conectar?loja=${loja}`,
  validar: (e) => {
    const erros: string[] = [];
    if (e.legenda.length > 63206) erros.push("Facebook: o texto passa de 63.206 caracteres.");
    if (e.tipo === "texto") {
      if (!e.legenda.trim()) erros.push("Facebook: escreva o texto da postagem.");
    } else if (e.midias.length === 0) {
      erros.push("Facebook: precisa de pelo menos uma foto ou vídeo.");
    }
    if (e.tipo === "carrossel" && (e.midias.length < 2 || e.midias.length > 10)) erros.push("Facebook: várias fotos precisam de 2 a 10 itens.");
    if (e.tipo === "carrossel" && e.midias.some((m) => m.tipo !== "imagem")) erros.push("Facebook: várias fotos não aceita vídeo misturado.");
    if (e.tipo === "video" && e.midias[0] && e.midias[0].tipo !== "video") erros.push("Facebook: o item escolhido não é um vídeo.");
    return erros;
  },
  async publicar(e: EntradaPublicar): Promise<SaidaPublicar> {
    const token = e.conta.accessToken;
    const pagina = e.conta.externoId;

    if (e.tipo === "texto" || e.midias.length === 0) {
      const link = typeof e.opcoes.link === "string" ? e.opcoes.link : primeiraUrl(e.legenda);
      const r = await chamar<{ id: string }>(token, `${pagina}/feed`, { message: e.legenda, ...(link ? { link } : {}) });
      return { externoId: r.id, url: urlDe(r.id) };
    }

    if (e.tipo === "video") {
      const v = e.midias[0];
      const r = await chamar<{ id: string }>(token, `${pagina}/videos`, {
        file_url: v.url,
        description: e.legenda,
        ...(e.titulo ? { title: e.titulo } : {}),
      });
      return { externoId: r.id, url: `https://www.facebook.com/${pagina}/videos/${r.id}` };
    }

    if (e.tipo === "carrossel" && e.midias.length > 1) {
      // Fotos sem publicar primeiro; depois uma postagem do feed junta todas.
      const ids: string[] = [];
      for (const m of e.midias) {
        const f = await chamar<{ id: string }>(token, `${pagina}/photos`, { url: m.url, published: "false" });
        ids.push(f.id);
      }
      const corpo: Record<string, string> = { message: e.legenda };
      ids.forEach((id, i) => {
        corpo[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
      });
      const r = await chamar<{ id: string }>(token, `${pagina}/feed`, corpo);
      return { externoId: r.id, url: urlDe(r.id) };
    }

    // Foto única
    const r = await chamar<{ id: string; post_id?: string }>(token, `${pagina}/photos`, { url: e.midias[0].url, caption: e.legenda });
    const postId = r.post_id ?? r.id;
    return { externoId: postId, url: urlDe(postId) };
  },
};
