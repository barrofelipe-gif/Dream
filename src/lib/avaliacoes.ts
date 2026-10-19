import "server-only";
import { createHmac } from "node:crypto";

/**
 * Sistema de avaliações (BFF e Moranga) dentro do app: tudo em /avaliacoes/... é repassado pelo
 * proxy (src/proxy.ts) para o sistema de avaliações, que roda como serviço próprio na Vercel.
 *
 *  - REVIEWS_ORIGIN       endereço do serviço (ex.: https://bff-avaliacoes.vercel.app)
 *  - REVIEWS_SSO_SECRET   segredo compartilhado do "passe" de login (o mesmo SSO_SECRET de lá)
 *  - REVIEWS_API_TOKEN    token só de leitura dos números mostrados nos papéis (ADMIN_API_TOKEN de lá)
 */
export const REVIEWS_ORIGIN = (process.env.REVIEWS_ORIGIN || "").replace(/\/$/, "");

/** Passe de login: quem já entrou no app abre o painel de avaliações sem outra senha. Vale 5 minutos. */
export function reviewsPass(email: string): string | null {
  const s = process.env.REVIEWS_SSO_SECRET;
  if (!s || s.length < 24) return null;
  const ts = String(Date.now());
  const who = Buffer.from(email, "utf8").toString("base64url");
  const sig = createHmac("sha256", s).update(`${ts}.${who}`).digest("base64url");
  return `${ts}.${who}.${sig}`;
}

/**
 * Marca de "veio pelo app" em todo pedido repassado: quando o endereço antigo do serviço for desligado, só o app
 * (e as rotinas/scripts dele) continua falando com ele direto; o resto é mandado para app.../avaliacoes.
 */
export function viaToken(): string | null {
  const s = process.env.REVIEWS_SSO_SECRET;
  if (!s || s.length < 24) return null;
  return createHmac("sha256", s).update("via-app").digest("base64url");
}

export type LojaId = "bff" | "moranga";
export const LOJAS: { id: LojaId; nome: string }[] = [
  { id: "bff", nome: "BFF Fitness" },
  { id: "moranga", nome: "Moranga Biquínis" },
];

export type ResumoLoja = {
  reviews_pending: number;
  reviews_approved: number;
  reviews_avg: number | null;
  questions_pending: number;
  store_pending: number;
  faq_active: number;
  products: number;
  products_with_reviews: number;
};

/** Números do painel de avaliações de uma loja (null quando o serviço não responde). */
export async function resumoLoja(loja: LojaId): Promise<ResumoLoja | null> {
  const tok = process.env.REVIEWS_API_TOKEN;
  if (!REVIEWS_ORIGIN || !tok) return null;
  try {
    const r = await fetch(`${REVIEWS_ORIGIN}/api/admin/stats?loja=${loja}`, {
      headers: { authorization: `Bearer ${tok}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    return r.ok ? ((await r.json()) as ResumoLoja) : null;
  } catch {
    return null;
  }
}

/** Link para abrir o painel de avaliações já na empresa, aba e relatório certos. */
export function linkPainel(loja: LojaId, aba: string, rel?: string): string {
  const q = new URLSearchParams({ loja, aba });
  if (rel) q.set("rel", rel);
  return `/avaliacoes/admin?${q}`;
}
