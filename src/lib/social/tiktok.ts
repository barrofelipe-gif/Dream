import type { EntradaPublicar, RedeAdapter, SaidaPublicar } from "@/lib/social/types";

/**
 * TikTok: Content Posting API (Direct Post). Endpoints e limites confirmados na documentação oficial
 * (developers.tiktok.com) em 26/10/2026:
 *  - POST /v2/post/publish/creator_info/query/  (privacidade permitida)
 *  - POST /v2/post/publish/video/init/          (vídeo: PULL_FROM_URL ou FILE_UPLOAD)
 *  - POST /v2/post/publish/content/init/        (fotos: media_type PHOTO, só PULL_FROM_URL, até 35)
 *  - POST /v2/post/publish/status/fetch/        (acompanhar até PUBLISH_COMPLETE)
 *  - POST /v2/oauth/token/                      (renovação: access 24h, refresh 365 dias)
 */
const API = "https://open.tiktokapis.com";
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const PRIVACIDADES = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const;
type Privacidade = (typeof PRIVACIDADES)[number];

/** Enquanto o app não passar na auditoria da TikTok, só é permitido publicar em modo privado. */
const auditado = () => process.env.TIKTOK_APP_AUDITADO === "1";

type RespostaTikTok<T> = { data?: T; error?: { code?: string; message?: string; log_id?: string; logid?: string } };

const MENSAGENS: Record<string, string> = {
  url_ownership_unverified: "o endereço dos arquivos não está verificado no TikTok for Developers (URL properties)",
  unaudited_client_can_only_post_to_private_accounts:
    "o app ainda não foi auditado pela TikTok: só publica em contas privadas (deixe a conta do TikTok como privada ou peça a auditoria)",
  privacy_level_option_mismatch: "a privacidade escolhida não é permitida para esta conta",
  spam_risk_too_many_posts: "limite diário de postagens da conta no TikTok atingido",
  spam_risk_user_banned_from_posting: "a conta está impedida de postar pelo TikTok",
  reached_active_user_cap: "o app atingiu o limite diário de contas publicando",
  access_token_invalid: "a conexão com o TikTok venceu (reconecte a conta)",
  scope_not_authorized: "faltam permissões (reconecte a conta e aceite video.publish)",
  rate_limit_exceeded: "limite de requisições do TikTok, tente de novo em instantes",
};

function erroTikTok(rotulo: string, status: number, r: RespostaTikTok<unknown> | null, texto: string): Error {
  const codigo = r?.error?.code ?? "";
  const msg = MENSAGENS[codigo] ?? r?.error?.message ?? texto.slice(0, 200);
  return new Error(`TikTok recusou (${rotulo}, ${status}${codigo ? " " + codigo : ""}): ${msg}`);
}

async function chamar<T>(token: string, caminho: string, corpo: Record<string, unknown>, rotulo: string): Promise<T> {
  const res = await fetch(`${API}${caminho}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(corpo),
  });
  const texto = await res.text();
  let j: RespostaTikTok<T> | null = null;
  try {
    j = JSON.parse(texto) as RespostaTikTok<T>;
  } catch {
    /* resposta não-JSON */
  }
  // A TikTok pode devolver 200 com error.code diferente de "ok" (ex: spam_risk).
  if (!res.ok || (j?.error?.code && j.error.code !== "ok")) throw erroTikTok(rotulo, res.status, j, texto);
  return (j?.data ?? ({} as T)) as T;
}

type InfoCriador = {
  privacy_level_options?: Privacidade[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
  creator_username?: string;
  creator_nickname?: string;
  creator_avatar_url?: string;
};

/** O que o painel mostra antes de postar (regra da TikTok: ler a cada vez que a tela de postar abre). */
export type CriadorTikTok = {
  apelido: string | null;
  usuario: string | null;
  fotoUrl: string | null;
  privacidades: Privacidade[];
  comentarioDesligado: boolean;
  duetoDesligado: boolean;
  stitchDesligado: boolean;
  maxSegundos: number | null;
  auditado: boolean;
};

export async function lerCriador(token: string): Promise<CriadorTikTok> {
  const i = await chamar<InfoCriador>(token, "/v2/post/publish/creator_info/query/", {}, "dados do criador");
  return {
    apelido: i.creator_nickname ?? null,
    usuario: i.creator_username ?? null,
    fotoUrl: i.creator_avatar_url ?? null,
    privacidades: (i.privacy_level_options ?? []).filter((p) => (PRIVACIDADES as readonly string[]).includes(p)),
    comentarioDesligado: !!i.comment_disabled,
    duetoDesligado: !!i.duet_disabled,
    stitchDesligado: !!i.stitch_disabled,
    maxSegundos: typeof i.max_video_post_duration_sec === "number" ? i.max_video_post_duration_sec : null,
    auditado: auditado(),
  };
}

/**
 * Decide a privacidade final. Sem escolha (postagem antiga ou automática): SELF_ONLY.
 * Sem auditoria a TikTok só aceita SELF_ONLY: outra escolha é recusada com aviso claro (não troca em silêncio).
 */
function escolherPrivacidade(pedida: unknown, permitidas: Privacidade[]): Privacidade {
  let alvo: Privacidade = "SELF_ONLY";
  if (typeof pedida === "string" && (PRIVACIDADES as readonly string[]).includes(pedida)) alvo = pedida as Privacidade;
  if (!auditado() && alvo !== "SELF_ONLY") throw new Error("TikTok: o app ainda não foi auditado, então só aceita a privacidade Só eu.");
  if (permitidas.length && !permitidas.includes(alvo)) {
    if (alvo === "SELF_ONLY") throw new Error("TikTok: esta conta não aceita publicação privada (SELF_ONLY).");
    throw new Error(`TikTok: a conta não permite a privacidade ${alvo}. Opções: ${permitidas.join(", ")}.`);
  }
  return alvo;
}

async function acompanhar(token: string, publishId: string): Promise<{ postId?: string }> {
  // Até ~6 min. Limite da TikTok: 30 consultas/min.
  for (let i = 0; i < 72; i++) {
    const s = await chamar<{ status?: string; fail_reason?: string; publicaly_available_post_id?: Array<number | string> }>(
      token,
      "/v2/post/publish/status/fetch/",
      { publish_id: publishId },
      "status",
    );
    if (s.status === "PUBLISH_COMPLETE") return { postId: s.publicaly_available_post_id?.[0] ? String(s.publicaly_available_post_id[0]) : undefined };
    if (s.status === "FAILED") throw new Error(`O TikTok não conseguiu publicar (${s.fail_reason ?? "motivo não informado"}).`);
    await espera(5000);
  }
  throw new Error("O TikTok demorou demais para processar a publicação (o envio pode ainda concluir sozinho).");
}

/** Plano B do vídeo: baixa o arquivo e envia em partes (5 a 64 MB cada, a última pode ter até 128 MB). */
async function enviarArquivo(token: string, url: string, postInfo: Record<string, unknown>): Promise<string> {
  const arq = await fetch(url);
  if (!arq.ok) throw new Error(`TikTok: não consegui baixar o vídeo (${arq.status}).`);
  const buf = Buffer.from(await arq.arrayBuffer());
  const tamanho = buf.length;
  const MB = 1024 * 1024;
  const chunk = tamanho <= 64 * MB ? tamanho : 32 * MB;
  const total = Math.max(1, Math.floor(tamanho / chunk));
  const tipo = /\.mov(\?|$)/i.test(url) ? "video/quicktime" : /\.webm(\?|$)/i.test(url) ? "video/webm" : "video/mp4";

  const ini = await chamar<{ publish_id: string; upload_url?: string }>(
    token,
    "/v2/post/publish/video/init/",
    { post_info: postInfo, source_info: { source: "FILE_UPLOAD", video_size: tamanho, chunk_size: chunk, total_chunk_count: total } },
    "iniciar envio",
  );
  if (!ini.upload_url) throw new Error("TikTok: não devolveu o endereço de envio.");
  for (let i = 0; i < total; i++) {
    const de = i * chunk;
    const ate = i === total - 1 ? tamanho - 1 : de + chunk - 1; // a última parte leva o resto
    const parte = buf.subarray(de, ate + 1);
    const up = await fetch(ini.upload_url, {
      method: "PUT",
      headers: { "Content-Type": tipo, "Content-Length": String(parte.length), "Content-Range": `bytes ${de}-${ate}/${tamanho}` },
      body: parte,
    });
    if (!up.ok && up.status !== 206) throw new Error(`TikTok: falha ao enviar a parte ${i + 1}/${total} (${up.status}).`);
  }
  return ini.publish_id;
}

const bool = (v: unknown) => v === true;

export const adaptador: RedeAdapter = {
  rede: "tiktok",
  rotulo: "TikTok",
  disponivel: !!process.env.TIKTOK_CLIENT_KEY && !!process.env.TIKTOK_CLIENT_SECRET,
  limites: {
    legendaMax: 2200,
    tipos: ["video", "imagem", "carrossel"],
    videoMaxSegundos: 600,
    carrosselMax: 35,
    observacao:
      "Vídeo (até 10 min, 4 GB, MP4/MOV/WebM) ou fotos (JPEG/WebP, até 35, 20 MB cada; título até 90 e descrição até 4.000). Os arquivos precisam estar num endereço verificado no TikTok. Sem auditoria, só publica em modo privado.",
  },
  pendencias() {
    const p: string[] = [];
    if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) p.push("Configurar TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET (app criado no TikTok for Developers).");
    if (!auditado()) p.push("App TikTok sem auditoria: só publica em modo privado (SELF_ONLY) e em conta privada. Peça a auditoria do Content Posting API e depois defina TIKTOK_APP_AUDITADO=1.");
    p.push("Verificar o domínio dos arquivos de mídia no TikTok for Developers (URL properties), senão fotos são recusadas e vídeo cai no envio direto do arquivo.");
    return p;
  },
  urlConectar: (loja) => `/api/social/tiktok/conectar?loja=${loja}`,
  validar(e) {
    const erros: string[] = [];
    const fotos = e.tipo === "imagem" || e.tipo === "carrossel";
    if (e.tipo === "texto") erros.push("TikTok: precisa de vídeo ou fotos (não publica só texto).");
    if (e.midias.length === 0) erros.push("TikTok: precisa de pelo menos um vídeo ou foto.");
    if (e.tipo === "video") {
      if (e.midias.length !== 1 || e.midias[0].tipo !== "video") erros.push("TikTok: envie exatamente um vídeo.");
      if (e.legenda.length > 2200) erros.push("TikTok: a legenda do vídeo passa de 2.200 caracteres.");
    }
    if (fotos) {
      if (e.midias.some((m) => m.tipo !== "imagem")) erros.push("TikTok: post de fotos não pode misturar vídeo.");
      if (e.midias.length > 35) erros.push("TikTok: no máximo 35 fotos.");
      if ((e.titulo ?? "").length > 90) erros.push("TikTok: o título das fotos passa de 90 caracteres.");
      if (e.legenda.length > 4000) erros.push("TikTok: a descrição das fotos passa de 4.000 caracteres.");
    }
    const priv = e.opcoes.privacidade;
    if (priv !== undefined && !(PRIVACIDADES as readonly string[]).includes(String(priv))) erros.push(`TikTok: privacidade inválida (${String(priv)}).`);
    // Conteúdo de marca (parceria paga) não pode ser privado (regra da TikTok). Sem privacidade = SELF_ONLY.
    if (e.opcoes.conteudoDeMarca === true && (priv ?? "SELF_ONLY") === "SELF_ONLY") erros.push("TikTok: conteúdo de marca não pode ser Só eu.");
    if ("consentimento" in e.opcoes && e.opcoes.consentimento !== true) erros.push("TikTok: falta confirmar a declaração de uso de música.");
    // Sem consentimento (fluxo automático ou postagem antiga): só sai como Só eu e sem divulgação comercial.
    if (!("consentimento" in e.opcoes) && ((priv ?? "SELF_ONLY") !== "SELF_ONLY" || e.opcoes.conteudoDeMarca === true || e.opcoes.marcaPropria === true))
      erros.push("TikTok: para postar com outra privacidade ou com divulgação comercial, confirme a declaração no painel.");
    return erros;
  },
  async publicar(e: EntradaPublicar): Promise<SaidaPublicar> {
    const token = e.conta.accessToken;
    const info = await chamar<InfoCriador>(token, "/v2/post/publish/creator_info/query/", {}, "dados do criador");
    const privacidade = escolherPrivacidade(e.opcoes.privacidade, info.privacy_level_options ?? []);

    // Novo painel manda "permitir…" (desmarcado por padrão, como pede a TikTok); postagens antigas podem mandar "desativar…".
    // Sem nenhum dos dois (automático): interação desligada, como pede a TikTok.
    const desligar = (permitir: unknown, desativar: unknown) => (typeof permitir === "boolean" ? !permitir : typeof desativar === "boolean" ? desativar : true);
    const comum = {
      privacy_level: privacidade,
      disable_comment: info.comment_disabled ? true : desligar(e.opcoes.permitirComentarios, e.opcoes.desativarComentarios),
      // Divulgação de conteúdo comercial: marca própria = "Conteúdo promocional"; marca de terceiro = "Parceria paga".
      brand_organic_toggle: bool(e.opcoes.marcaPropria),
      brand_content_toggle: bool(e.opcoes.conteudoDeMarca),
    };
    let publishId: string;

    if (e.tipo === "video") {
      const m = e.midias[0];
      if (!m) throw new Error("TikTok: nenhum vídeo para publicar.");
      const postInfo = {
        ...comum,
        title: e.legenda,
        disable_duet: info.duet_disabled ? true : desligar(e.opcoes.permitirDueto, e.opcoes.desativarDuo),
        disable_stitch: info.stitch_disabled ? true : desligar(e.opcoes.permitirStitch, e.opcoes.desativarStitch),
      };
      try {
        const r = await chamar<{ publish_id: string }>(
          token,
          "/v2/post/publish/video/init/",
          { post_info: postInfo, source_info: { source: "PULL_FROM_URL", video_url: m.url } },
          "iniciar vídeo",
        );
        publishId = r.publish_id;
      } catch (err) {
        // Domínio não verificado: tenta enviar o arquivo em partes.
        if (!/url_ownership_unverified/.test((err as Error).message)) throw err;
        publishId = await enviarArquivo(token, m.url, postInfo);
      }
    } else {
      const r = await chamar<{ publish_id: string }>(
        token,
        "/v2/post/publish/content/init/",
        {
          media_type: "PHOTO",
          post_mode: "DIRECT_POST",
          post_info: {
            ...comum,
            title: (e.titulo ?? e.legenda).slice(0, 90),
            description: e.legenda.slice(0, 4000),
            auto_add_music: e.opcoes.musicaAutomatica !== false,
          },
          source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: e.midias.slice(0, 35).map((m) => m.url) },
        },
        "iniciar fotos",
      );
      publishId = r.publish_id;
    }

    const fim = await acompanhar(token, publishId);
    const usuario = info.creator_username ?? e.conta.username ?? undefined;
    // Em modo privado a TikTok não devolve o id público: usamos o publish_id como referência.
    return {
      externoId: fim.postId ?? publishId,
      url: fim.postId && usuario ? `https://www.tiktok.com/@${usuario}/${e.tipo === "video" ? "video" : "photo"}/${fim.postId}` : undefined,
    };
  },
  async renovar(conta) {
    // Access token dura 24h; renova quando falta menos de 6h. Refresh token dura 365 dias.
    if (!conta.refreshToken) return null;
    if (conta.expiraEm && conta.expiraEm.getTime() - Date.now() > 6 * 3600 * 1000) return null;
    const key = process.env.TIKTOK_CLIENT_KEY;
    const secret = process.env.TIKTOK_CLIENT_SECRET;
    if (!key || !secret) return null;
    const res = await fetch(`${API}/v2/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: key, client_secret: secret, grant_type: "refresh_token", refresh_token: conta.refreshToken }),
    });
    const j = (await res.json().catch(() => null)) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
    if (!res.ok || !j?.access_token) throw new Error(`TikTok: falha ao renovar a conexão (${j?.error_description ?? j?.error ?? res.status}). Reconecte a conta.`);
    return {
      accessToken: j.access_token,
      // A TikTok pode devolver um refresh token diferente: precisa guardar o novo.
      refreshToken: j.refresh_token ?? conta.refreshToken,
      expiraEm: new Date(Date.now() + (j.expires_in ?? 86400) * 1000),
    };
  },
};
