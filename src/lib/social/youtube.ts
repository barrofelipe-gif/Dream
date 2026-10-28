import { salvarConta } from "@/lib/social/contas";
import type { ContaAberta, EntradaPublicar, RedeAdapter, SaidaPublicar } from "@/lib/social/types";

/**
 * Rede YouTube: envio de vídeos pela YouTube Data API v3 (videos.insert, upload retomável).
 * Veja docs/social/youtube.md para o passo a passo no Google Cloud.
 */

export const YT_ESCOPOS = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  // Responder comentários (aba Responder comentários). Contas ligadas antes disso precisam reconectar.
  "https://www.googleapis.com/auth/youtube.force-ssl",
];
export const YT_ESCOPO_COMENTAR = "https://www.googleapis.com/auth/youtube.force-ssl";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3";

// Cada pedaço do upload precisa ser múltiplo de 256 KB (exceto o último).
const BLOCO = 256 * 1024 * 32; // 8 MiB
// Limite do tamanho do vídeo: o envio acontece dentro de UMA chamada serverless (curta no plano gratuito).
const LIMITE_MB = Number(process.env.YOUTUBE_MAX_UPLOAD_MB ?? 80);
// Tempo máximo gasto no envio, em segundos (deixe abaixo do maxDuration da rota que chama a publicação).
const ORCAMENTO_S = Number(process.env.YOUTUBE_UPLOAD_BUDGET_S ?? 50);

const CATEGORIA_PADRAO = "22"; // People & Blogs
const PRIVACIDADES = ["public", "unlisted", "private"] as const;
type Privacidade = (typeof PRIVACIDADES)[number];

const credenciais = () => ({ id: process.env.GOOGLE_CLIENT_ID, segredo: process.env.GOOGLE_CLIENT_SECRET });

export function youtubeConfigurado(): boolean {
  const c = credenciais();
  return Boolean(c.id && c.segredo);
}

/** Monta a URL de autorização do Google (usada pela rota conectar). */
export function urlAutorizacao(redirectUri: string, state: string): string {
  const c = credenciais();
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", c.id ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", YT_ESCOPOS.join(" "));
  u.searchParams.set("access_type", "offline"); // devolve o refresh token
  u.searchParams.set("prompt", "consent"); // força o refresh token mesmo se já autorizado antes
  u.searchParams.set("state", state);
  return u.toString();
}

type RespToken = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; error?: string; error_description?: string };

async function pedirToken(corpo: Record<string, string>): Promise<RespToken> {
  const c = credenciais();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id ?? "", client_secret: c.segredo ?? "", ...corpo }),
  });
  const j = (await res.json().catch(() => ({}))) as RespToken;
  if (!res.ok || !j.access_token) {
    if (j.error === "invalid_grant") {
      throw new Error("O Google recusou o acesso salvo do YouTube (expirou ou foi revogado). Reconecte a conta do YouTube.");
    }
    throw new Error(`Google recusou o token do YouTube: ${j.error_description ?? j.error ?? res.status}`);
  }
  return j;
}

/** Troca o código do callback por tokens (usada pela rota callback). */
export function trocarCodigo(code: string, redirectUri: string) {
  return pedirToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

/** Dados do canal ligado ao token (channels.list?mine=true, 1 unidade de cota). */
export async function buscarCanal(accessToken: string): Promise<{ id: string; titulo: string; handle: string | null; foto: string | null } | null> {
  const res = await fetch(`${API}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Não consegui ler o canal do YouTube (${res.status}).`);
  const j = (await res.json()) as {
    items?: { id: string; snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } } }[];
  };
  const c = j.items?.[0];
  if (!c) return null;
  return { id: c.id, titulo: c.snippet?.title ?? "Canal do YouTube", handle: c.snippet?.customUrl ?? null, foto: c.snippet?.thumbnails?.default?.url ?? null };
}

/** Pede um access token novo a partir do refresh token. */
async function renovarToken(conta: ContaAberta) {
  if (!conta.refreshToken) throw new Error("A conta do YouTube não tem refresh token salvo. Reconecte a conta.");
  const t = await pedirToken({ grant_type: "refresh_token", refresh_token: conta.refreshToken });
  return {
    accessToken: t.access_token,
    // O Google normalmente não devolve refresh token novo na renovação; só repassa se vier.
    refreshToken: t.refresh_token,
    expiraEm: new Date(Date.now() + t.expires_in * 1000),
  };
}

/** Garante um access token válido antes de publicar (vale 1 hora) e já grava o novo no banco. */
export async function tokenValido(conta: ContaAberta): Promise<string> {
  const venceEm = conta.expiraEm?.getTime() ?? 0;
  if (venceEm - Date.now() > 2 * 60 * 1000) return conta.accessToken;
  const n = await renovarToken(conta);
  try {
    await salvarConta({
      rede: "youtube",
      loja: conta.loja,
      externoId: conta.externoId,
      nome: conta.nome,
      username: conta.username,
      accessToken: n.accessToken,
      refreshToken: n.refreshToken ?? conta.refreshToken,
      expiraEm: n.expiraEm,
      extra: conta.extra,
    });
  } catch (e) {
    console.error("[youtube] não consegui gravar o token renovado", e);
  }
  return n.accessToken;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function msgGoogle(texto: string): string {
  try {
    const j = JSON.parse(texto) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const motivo = j.error?.errors?.[0]?.reason;
    let m = j.error?.message ?? texto.slice(0, 300);
    if (motivo === "quotaExceeded" || motivo === "uploadLimitExceeded") m += " (cota diária do YouTube esgotada: tente amanhã ou peça aumento de cota)";
    if (motivo === "forbidden" || /insufficient|scope/i.test(m)) m += " (reconecte a conta do YouTube)";
    return m;
  } catch {
    return texto.slice(0, 300);
  }
}

const listaTags = (v: unknown): string[] => {
  const bruto = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return bruto.map((t) => String(t).trim().replace(/^#/, "")).filter(Boolean);
};

const textoOp = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Tira < e > (o YouTube recusa no título/descrição). */
const limpar = (s: string) => s.replace(/[<>]/g, "");

function tituloDe(e: Omit<EntradaPublicar, "conta">): string {
  const base = (e.titulo ?? "").trim() || e.legenda.split("\n")[0]?.trim() || "";
  return limpar(base).slice(0, 100);
}

export const adaptador: RedeAdapter = {
  rede: "youtube",
  rotulo: "YouTube",
  get disponivel() {
    return youtubeConfigurado();
  },
  limites: {
    legendaMax: 5000,
    tipos: ["video"],
    videoMaxSegundos: 12 * 60 * 60,
    observacao:
      "Só vídeo. Título até 100 caracteres, descrição até 5.000. Shorts = vídeo vertical de até 3 minutos (marque a opção Shorts). Arquivo limitado ao tempo da função serverless (padrão 80 MB).",
  },
  pendencias: () => {
    const p: string[] = [];
    if (!youtubeConfigurado()) p.push("Faltam as variáveis GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (as mesmas do Gmail) e ativar a YouTube Data API v3 no Google Cloud.");
    p.push("Cadastre no Google Cloud o redirect URI https://SEU-DOMINIO/api/social/youtube/callback (veja docs/social/youtube.md).");
    p.push("App em modo Teste na tela de consentimento: o acesso salvo expira em 7 dias e precisa reconectar. Publique o app para evitar.");
    p.push("Projeto de API não verificado: o YouTube trava os vídeos enviados como PRIVADOS. É preciso passar na auditoria de conformidade da API do YouTube (texto pronto em docs/social/youtube.md).");
    p.push("Cota: a documentação atual diz ~100 unidades por upload (antes ~1.600), com padrão de 10.000 unidades por dia; confira o painel de cotas do projeto. Em caso de 1.600, são cerca de 6 vídeos por dia.");
    p.push("Vídeos grandes: o envio cabe numa única chamada serverless; arquivos acima do limite (padrão 80 MB) são recusados. No plano gratuito da Vercel a função é curta.");
    return p;
  },
  urlConectar: (loja) => `/api/social/youtube/conectar?loja=${loja}`,
  validar: (e) => {
    const erros: string[] = [];
    if (e.tipo !== "video" || e.midias[0]?.tipo !== "video") erros.push("YouTube: só aceita vídeo.");
    if (e.midias.length !== 1) erros.push("YouTube: envie exatamente um vídeo.");
    const titulo = tituloDe(e);
    if (!titulo) erros.push("YouTube: o vídeo precisa de um título (até 100 caracteres).");
    if ((e.titulo ?? "").length > 100) erros.push("YouTube: o título passa de 100 caracteres.");
    if (Buffer.byteLength(e.legenda, "utf8") > 5000) erros.push("YouTube: a descrição passa de 5.000 bytes.");
    const priv = textoOp(e.opcoes.privacyStatus);
    if (priv && !PRIVACIDADES.includes(priv as Privacidade)) erros.push("YouTube: privacidade deve ser public, unlisted ou private.");
    const tags = listaTags(e.opcoes.tags);
    if (tags.join(",").length > 500) erros.push("YouTube: as tags passam de 500 caracteres no total.");
    return erros;
  },
  async renovar(conta) {
    if (conta.expiraEm && conta.expiraEm.getTime() - Date.now() > 5 * 60 * 1000) return null;
    return renovarToken(conta);
  },
  async publicar(e: EntradaPublicar): Promise<SaidaPublicar> {
    const inicio = Date.now();
    const midia = e.midias[0];
    if (!midia || midia.tipo !== "video") throw new Error("YouTube: nenhum vídeo para publicar.");
    const token = await tokenValido(e.conta);

    // 1) Abre a fonte do vídeo e descobre o tamanho (precisa para o upload retomável).
    const fonte = await fetch(midia.url);
    if (!fonte.ok || !fonte.body) throw new Error(`YouTube: não consegui baixar o vídeo (${fonte.status}).`);
    const total = Number(fonte.headers.get("content-length") ?? 0);
    const tipoArquivo = fonte.headers.get("content-type")?.startsWith("video/") ? fonte.headers.get("content-type")! : "video/mp4";
    if (!total) {
      await fonte.body.cancel();
      throw new Error("YouTube: a origem do vídeo não informa o tamanho do arquivo, e o envio precisa dele.");
    }
    if (total > LIMITE_MB * 1024 * 1024) {
      await fonte.body.cancel();
      throw new Error(
        `YouTube: o vídeo tem ${(total / 1048576).toFixed(0)} MB e o limite por envio é ${LIMITE_MB} MB (o envio precisa caber no tempo da função serverless). Use um vídeo menor ou suba direto pelo YouTube Studio.`,
      );
    }

    // 2) Monta os metadados.
    const shorts = e.opcoes.shorts === true;
    let titulo = tituloDe(e);
    let descricao = limpar(e.legenda);
    if (shorts) {
      if (!/#shorts/i.test(descricao)) descricao = `${descricao}\n\n#Shorts`.trim();
      if (!/#shorts/i.test(titulo) && titulo.length + 8 <= 100) titulo = `${titulo} #Shorts`;
    }
    const priv = (textoOp(e.opcoes.privacyStatus) as Privacidade | undefined) ?? "public";
    const tags = listaTags(e.opcoes.tags);
    const corpoMeta = {
      snippet: {
        title: titulo,
        description: descricao,
        categoryId: textoOp(e.opcoes.categoryId) ?? CATEGORIA_PADRAO,
        defaultLanguage: "pt-BR",
        ...(tags.length ? { tags } : {}),
      },
      status: {
        privacyStatus: priv,
        selfDeclaredMadeForKids: e.opcoes.madeForKids === true,
        embeddable: true,
      },
    };

    // 3) Abre a sessão de upload retomável.
    const notificar = e.opcoes.notifySubscribers === false ? "false" : "true";
    const abrir = await fetch(`${UPLOAD}/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${notificar}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(total),
        "X-Upload-Content-Type": tipoArquivo,
      },
      body: JSON.stringify(corpoMeta),
    });
    if (!abrir.ok) {
      await fonte.body.cancel();
      throw new Error(`YouTube recusou: ${msgGoogle(await abrir.text())}`);
    }
    const sessao = abrir.headers.get("location");
    if (!sessao) {
      await fonte.body.cancel();
      throw new Error("YouTube: o Google não devolveu o endereço de envio.");
    }

    // 4) Lê a fonte em streaming e envia em blocos de 8 MiB. Só um bloco fica na memória.
    const leitor = fonte.body.getReader();
    let sobra: Uint8Array = new Uint8Array(0);
    let enviados = 0;
    let video: { id?: string } | null = null;

    const proximoBloco = async (): Promise<Uint8Array> => {
      const partes: Uint8Array[] = sobra.length ? [sobra] : [];
      let tam = sobra.length;
      sobra = new Uint8Array(0);
      while (tam < BLOCO) {
        const { done, value } = await leitor.read();
        if (done) break;
        partes.push(value);
        tam += value.length;
      }
      const junto = new Uint8Array(tam);
      let pos = 0;
      for (const p of partes) {
        junto.set(p, pos);
        pos += p.length;
      }
      if (tam > BLOCO) {
        sobra = junto.subarray(BLOCO);
        return junto.subarray(0, BLOCO);
      }
      return junto;
    };

    try {
      while (enviados < total) {
        if (Date.now() - inicio > ORCAMENTO_S * 1000) {
          throw new Error(
            `YouTube: o envio estourou o tempo da função (${ORCAMENTO_S}s) com ${(enviados / 1048576).toFixed(0)} de ${(total / 1048576).toFixed(0)} MB enviados. Use um vídeo menor, reduza YOUTUBE_MAX_UPLOAD_MB ou aumente maxDuration na rota (precisa de plano que permita).`,
          );
        }
        const bloco = await proximoBloco();
        if (!bloco.length) throw new Error("YouTube: o vídeo terminou antes do tamanho informado.");
        const fim = enviados + bloco.length - 1;
        let tentativas = 0;
        for (;;) {
          const r = await fetch(sessao, {
            method: "PUT",
            headers: { "Content-Length": String(bloco.length), "Content-Range": `bytes ${enviados}-${fim}/${total}`, "Content-Type": tipoArquivo },
            body: new Uint8Array(bloco.buffer, bloco.byteOffset, bloco.byteLength) as unknown as BodyInit,
          }).catch(() => null);
          if (r && (r.status === 308 || r.status === 200 || r.status === 201)) {
            if (r.status !== 308) video = (await r.json()) as { id?: string };
            break;
          }
          // Erros temporários (rede ou 5xx): tenta de novo com espera; o resto é definitivo.
          if (r && ![500, 502, 503, 504].includes(r.status)) throw new Error(`YouTube recusou o envio: ${msgGoogle(await r.text())}`);
          if (++tentativas >= 3) throw new Error("YouTube: falha de rede repetida durante o envio do vídeo.");
          await espera(1000 * 2 ** tentativas);
        }
        enviados = fim + 1;
      }
    } finally {
      leitor.cancel().catch(() => undefined);
    }

    if (!video?.id) throw new Error("YouTube: o envio terminou mas o Google não devolveu o id do vídeo.");

    // 5) Miniatura (opcional; costuma exigir canal verificado, por isso falha em silêncio).
    if (midia.capaUrl) {
      try {
        const img = await fetch(midia.capaUrl);
        const tipoImg = img.headers.get("content-type") ?? "image/jpeg";
        const bytes = Buffer.from(await img.arrayBuffer());
        if (img.ok && bytes.length <= 2 * 1024 * 1024) {
          await fetch(`${UPLOAD}/thumbnails/set?videoId=${video.id}&uploadType=media`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": tipoImg, "Content-Length": String(bytes.length) },
            body: bytes,
          });
        }
      } catch {
        /* a miniatura é só um extra */
      }
    }

    return { externoId: video.id, url: shorts ? `https://www.youtube.com/shorts/${video.id}` : `https://www.youtube.com/watch?v=${video.id}` };
  },
};
