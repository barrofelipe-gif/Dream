import "server-only";
import crypto from "node:crypto";
import { decrypt } from "@/lib/crypto";
import { cortarBytes, cortarCaracteres } from "@/lib/igTexto";

const GRAPH_VERSION = process.env.IG_GRAPH_VERSION ?? "v23.0";
const GRAPH_BASE = process.env.IG_GRAPH_BASE ?? "https://graph.instagram.com";

/** Confere o X-Hub-Signature-256 (HMAC-SHA256 do corpo cru com o App Secret). */
export function assinaturaValida(rawBody: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const esperado = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const recebido = Buffer.from(header.slice("sha256=".length), "hex");
  return recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado);
}

/** Folga para envios agendados (cron, sequências, transmissões): o envio leva segundos e a Meta conta no relógio dela. */
export const MARGEM_AGENDADO_MS = 10 * 60 * 1000;

/**
 * Janela de resposta da Meta: 24h depois da última mensagem do cliente.
 * `margemMs` encurta a janela (use MARGEM_AGENDADO_MS em envios que não são resposta imediata).
 */
export function dentroDaJanela(lastCustomerMessageAt: Date | null, agora = new Date(), margemMs = 0): boolean {
  return !!lastCustomerMessageAt && agora.getTime() - lastCustomerMessageAt.getTime() < 24 * 60 * 60 * 1000 - margemMs;
}

/** Envia um direct. Devolve o id da mensagem na Meta. */
export async function enviarDm(opts: {
  igUserId: string;
  encryptedToken: string;
  recipientId: string;
  text: string;
  /** Botões de resposta rápida (até 13; título até 20 caracteres). */
  quickReplies?: { title: string; payload: string }[];
  /** Botão com link abaixo do texto (modelo "button template": texto até 640 caracteres). O texto simples vai até 1000 BYTES. */
  link?: { title: string; url: string };
  /** Até 3 botões de link (mesmo modelo do `link`). */
  links?: { title: string; url: string }[];
}): Promise<string> {
  const botoes = (opts.links?.length ? opts.links : opts.link ? [opts.link] : []).slice(0, 3);
  const message = botoes.length
    ? {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: cortarCaracteres(opts.text, 640),
            buttons: botoes.map((b) => ({ type: "web_url", url: b.url, title: cortarCaracteres(b.title, 20) })),
          },
        },
      }
    : {
        text: cortarBytes(opts.text, 1000), // a Meta conta bytes (emoji e acento pesam mais que 1)
        ...(opts.quickReplies?.length
          ? {
              quick_replies: opts.quickReplies.map((q) => ({
                content_type: "text",
                title: cortarCaracteres(q.title, 20),
                payload: q.payload,
              })),
            }
          : {}),
      };
  const res = await fetch(`${GRAPH_BASE}/${GRAPH_VERSION}/${opts.igUserId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${decrypt(opts.encryptedToken)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient: { id: opts.recipientId }, message }),
  });
  if (!res.ok) throw new Error(`Meta respondeu ${res.status} ao enviar DM: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { message_id?: string };
  return json.message_id ?? "";
}

export type PerfilIg = {
  nome: string | null;
  username: string | null;
  fotoUrl: string | null;
  seguidores: number | null;
  verificado: boolean;
  seguePagina: boolean | null;
};

/** Perfil de quem escreveu (User Profile API): foto, @, seguidores, se segue a loja. */
export async function buscarPerfil(encryptedToken: string, scopedId: string): Promise<PerfilIg | null> {
  const fields = "name,username,profile_pic,follower_count,is_verified_user,is_user_follow_business";
  const res = await fetch(`${GRAPH_BASE}/${GRAPH_VERSION}/${scopedId}?fields=${fields}`, {
    headers: { Authorization: `Bearer ${decrypt(encryptedToken)}` },
  });
  if (!res.ok) {
    console.warn("[ig-perfil] Meta respondeu", res.status, (await res.text()).slice(0, 200));
    return null;
  }
  const j = (await res.json()) as {
    name?: string;
    username?: string;
    profile_pic?: string;
    follower_count?: number;
    is_verified_user?: boolean;
    is_user_follow_business?: boolean;
  };
  return {
    nome: j.name ?? null,
    username: j.username ?? null,
    fotoUrl: j.profile_pic ?? null,
    seguidores: typeof j.follower_count === "number" ? j.follower_count : null,
    verificado: !!j.is_verified_user,
    seguePagina: typeof j.is_user_follow_business === "boolean" ? j.is_user_follow_business : null,
  };
}
