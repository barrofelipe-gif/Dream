import type { Rede } from "@/lib/social/types";

const LINK_APP = "https://converta.app/redirectbff.html";

/** Texto próprio de uma rede (escrito à mão ou pela IA). Vazio = usa a legenda principal. */
export type TextoRede = { titulo: string; legenda: string; hashtags?: string[]; palavrasChave?: string[]; textoNaTela?: string; textoAlternativo?: string; perguntaIa?: string; porQue?: string };

/** Ajustes do TikTok exigidos pela auditoria (Content Sharing Guidelines). Tudo desmarcado por padrão. */
export type OpcoesTikTok = {
  comentarios: boolean;
  dueto: boolean;
  stitch: boolean;
  divulgar: boolean;
  marcaPropria: boolean;
  conteudoDeMarca: boolean;
  consentimento: boolean;
};

/** Limite de hashtags do Instagram desde dez/2025. */
export const MAX_HASHTAGS_INSTAGRAM = 5;

/** Mantém só as primeiras `max` hashtags do texto (as outras saem, com o espaço antes delas). */
export function limitarHashtags(texto: string, max: number): string {
  let n = 0;
  return texto.replace(/\s?#[\p{L}\p{N}_]+/gu, (m) => (++n <= max ? m : "")).replace(/[ \t]+\n/g, "\n").trimEnd();
}

/**
 * Monta o porRede que a API espera: texto próprio de cada rede + as opções dela + a origem (post do Instagram).
 * `legendaPrincipal` é a que vale para as redes sem texto próprio (usada para respeitar o limite de hashtags do Instagram).
 */
export function montarPorRede(
  redes: Rede[],
  textos: Partial<Record<Rede, TextoRede>>,
  opc: { ytPriv: string; ytShorts: boolean; ttPriv: string; pinBoard: string; pinLink: string; tiktok?: OpcoesTikTok; loja?: string },
  origem: string | null,
  legendaPrincipal = "",
) {
  const out: Record<string, unknown> = {};
  for (const r of redes) {
    const t = textos[r];
    const titulo = (t?.titulo ?? "").trim().slice(0, r === "tiktok" ? 90 : 100);
    let legenda = t?.legenda?.trim() ? t.legenda : "";
    if (r === "instagram") {
      const fonte = legenda || legendaPrincipal;
      const limitada = limitarHashtags(fonte, MAX_HASHTAGS_INSTAGRAM);
      if (limitada !== fonte.trimEnd()) legenda = limitada;
    }
    const base = { ...(legenda ? { legenda } : {}), ...(titulo ? { titulo } : {}) };
    if (r === "youtube") out.youtube = { ...base, opcoes: { privacyStatus: opc.ytPriv, shorts: opc.ytShorts, ...(t?.palavrasChave?.length ? { tags: t.palavrasChave } : {}) } };
    else if (r === "tiktok") {
      const tt = opc.tiktok;
      out.tiktok = {
        ...base,
        opcoes: {
          // Sem privacidade escolhida o servidor usa Só eu (postagem automática).
          ...(opc.ttPriv ? { privacidade: opc.ttPriv } : {}),
          ...(tt
            ? {
                permitirComentarios: tt.comentarios,
                permitirDueto: tt.dueto,
                permitirStitch: tt.stitch,
                marcaPropria: tt.divulgar && tt.marcaPropria,
                conteudoDeMarca: tt.divulgar && tt.conteudoDeMarca,
                consentimento: tt.consentimento,
              }
            : {}),
        },
      };
    }
    else if (r === "pinterest") out.pinterest = { ...base, opcoes: { boardId: opc.pinBoard, titulo, link: opc.pinLink || (opc.loja === "moranga" ? "" : LINK_APP) } };
    else if (Object.keys(base).length) out[r] = base;
  }
  if (origem) out._origem = origem;
  return out;
}
