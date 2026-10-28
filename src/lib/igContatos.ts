import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TAG } from "@/lib/igTags";

/** Tipos de campo personalizado (como os "custom fields" do ManyChat). */
export const TIPOS_CAMPO = ["TEXTO", "NUMERO", "DATA", "SIM_NAO"] as const;
export type TipoCampo = (typeof TIPOS_CAMPO)[number];
export type ValorCampo = string | number | boolean | null;

export const STATUS_VALIDOS = ["BOT", "NEEDS_HUMAN", "HUMAN", "CLOSED"] as const;
export const ROTULO_STATUS: Record<string, string> = {
  BOT: "Robô atendendo",
  NEEDS_HUMAN: "Aguardando atendente",
  HUMAN: "Atendente na conversa",
  CLOSED: "Encerrada",
};

/** A origem do contato vem das etiquetas que o robô aplica no primeiro contato. */
export const ORIGENS: Record<string, { rotulo: string; tag: string }> = {
  anuncio: { rotulo: "Anúncio", tag: TAG.veioAnuncio },
  story: { rotulo: "Story", tag: TAG.origemStory },
  organico: { rotulo: "Orgânico", tag: TAG.organico },
};
export function origemDe(tags: string[]): string | null {
  for (const [k, o] of Object.entries(ORIGENS)) if (tags.includes(o.tag)) return k;
  return null;
}

/** Filtro da aba Contatos. O mesmo formato serve para a lista, as ações em massa e a exportação. */
export type FiltroContatos = {
  q?: string;
  accountId?: string;
  incluir?: string[]; // tem qualquer uma destas etiquetas (ou todas, com modoIncluir = "todas")
  modoIncluir?: "qualquer" | "todas";
  excluir?: string[]; // não tem nenhuma destas
  origem?: string; // anuncio | story | organico | sem
  status?: string;
  seguidoresMin?: number;
  campo?: string; // nome do campo personalizado
  valor?: string; // valor exato (texto) — sem valor = "campo preenchido"
};

const lista = (v: string | null | undefined) =>
  (v ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

/** Lê o filtro da query string (?q=&conta=&incluir=a,b&excluir=c&origem=&status=&segMin=&campo=&valor=). */
export function filtroDaUrl(sp: URLSearchParams): FiltroContatos {
  const seg = Number(sp.get("segMin"));
  return {
    q: sp.get("q")?.trim() || undefined,
    accountId: sp.get("conta") || undefined,
    incluir: lista(sp.get("incluir")),
    modoIncluir: sp.get("modoIncluir") === "todas" ? "todas" : "qualquer",
    excluir: lista(sp.get("excluir")),
    origem: sp.get("origem") || undefined,
    status: sp.get("status") || undefined,
    seguidoresMin: Number.isFinite(seg) && seg > 0 ? seg : undefined,
    campo: sp.get("campo") || undefined,
    valor: sp.get("valor") ?? undefined,
  };
}

/** Normaliza um filtro vindo de um corpo JSON (ações em massa). */
export function filtroDoCorpo(f: unknown): FiltroContatos {
  const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : typeof v === "string" ? lista(v) : []);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const seg = Number(o.seguidoresMin ?? o.segMin);
  return {
    q: str(o.q),
    accountId: str(o.accountId ?? o.conta),
    incluir: arr(o.incluir),
    modoIncluir: o.modoIncluir === "todas" ? "todas" : "qualquer",
    excluir: arr(o.excluir),
    origem: str(o.origem),
    status: str(o.status),
    seguidoresMin: Number.isFinite(seg) && seg > 0 ? seg : undefined,
    campo: str(o.campo),
    valor: typeof o.valor === "string" ? o.valor : undefined,
  };
}

/** `loja`: empresa escolhida no topo do painel — contatos da outra empresa nunca entram (nem em ação em lote ou exportação). */
export function whereContatos(f: FiltroContatos, loja?: string): Prisma.IgConversationWhereInput {
  const and: Prisma.IgConversationWhereInput[] = [];
  if (loja) and.push({ account: { loja } });
  if (f.accountId) and.push({ accountId: f.accountId });
  if (f.q) {
    const q = f.q.replace(/^@/, "");
    and.push({
      OR: [
        { nome: { contains: q, mode: "insensitive" } },
        { username: { contains: q, mode: "insensitive" } },
        { igScopedUserId: { endsWith: q } },
      ],
    });
  }
  if (f.incluir?.length) and.push(f.modoIncluir === "todas" ? { tags: { hasEvery: f.incluir } } : { tags: { hasSome: f.incluir } });
  if (f.excluir?.length) and.push({ NOT: { tags: { hasSome: f.excluir } } });
  if (f.origem === "sem") {
    and.push({ NOT: { tags: { hasSome: Object.values(ORIGENS).map((o) => o.tag) } } });
  } else if (f.origem && ORIGENS[f.origem]) {
    and.push({ tags: { has: ORIGENS[f.origem].tag } });
  }
  if (f.status && (STATUS_VALIDOS as readonly string[]).includes(f.status)) and.push({ status: f.status });
  if (f.seguidoresMin) and.push({ seguidores: { gte: f.seguidoresMin } });
  if (f.campo) {
    if (f.valor !== undefined && f.valor !== "") {
      // O valor guardado tem o tipo do campo (número, sim/não = boolean, data ISO): compara com cada leitura possível do texto.
      const candidatos: Prisma.InputJsonValue[] = [f.valor];
      for (const tipo of ["NUMERO", "SIM_NAO", "DATA"]) {
        const r = normalizarValor(tipo, f.valor);
        if (r.ok && r.valor !== null && !candidatos.includes(r.valor)) candidatos.push(r.valor);
      }
      and.push({ OR: candidatos.map((v) => ({ campos: { path: [f.campo as string], equals: v } })) });
    } else {
      // "campo preenchido": existe e não é nulo
      and.push({ NOT: { campos: { path: [f.campo], equals: Prisma.AnyNull } } });
    }
  }
  return and.length ? { AND: and } : {};
}

export const ORDENS: Record<string, Prisma.IgConversationOrderByWithRelationInput[]> = {
  recentes: [{ lastCustomerMessageAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
  antigos: [{ lastCustomerMessageAt: { sort: "asc", nulls: "last" } }, { updatedAt: "asc" }],
  novos: [{ createdAt: "desc" }],
  primeiros: [{ createdAt: "asc" }],
  seguidores: [{ seguidores: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  nome: [{ nome: { sort: "asc", nulls: "last" } }, { username: { sort: "asc", nulls: "last" } }],
};

/** Valores dos campos de um contato como objeto simples. */
export function camposDe(v: Prisma.JsonValue | null | undefined): Record<string, ValorCampo> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, ValorCampo> = {};
  for (const [k, x] of Object.entries(v)) {
    if (x === null || typeof x === "string" || typeof x === "number" || typeof x === "boolean") out[k] = x;
  }
  return out;
}

/**
 * Converte o valor digitado/importado para o tipo do campo.
 * Vazio = apagar o valor (null). Retorna erro quando não dá para entender.
 */
export function normalizarValor(tipo: string, bruto: unknown): { ok: true; valor: ValorCampo } | { ok: false; erro: string } {
  if (bruto === null || bruto === undefined) return { ok: true, valor: null };
  if (typeof bruto === "string" && bruto.trim() === "") return { ok: true, valor: null };
  switch (tipo) {
    case "NUMERO": {
      if (typeof bruto === "number") return Number.isFinite(bruto) ? { ok: true, valor: bruto } : { ok: false, erro: "número inválido" };
      let s = String(bruto).trim().replace(/\s/g, "").replace(/^R\$/i, "");
      // 1.234,56 → 1234.56 · 1234,5 → 1234.5
      if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
      const n = Number(s);
      return Number.isFinite(n) ? { ok: true, valor: n } : { ok: false, erro: "número inválido" };
    }
    case "DATA": {
      const s = String(bruto).trim();
      let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      let iso: string | null = null;
      if (m) iso = `${m[1]}-${m[2]}-${m[3]}`;
      else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
        const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
        iso = `${ano}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      }
      if (!iso) return { ok: false, erro: "data inválida (use dd/mm/aaaa)" };
      const d = new Date(`${iso}T12:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return { ok: false, erro: "data inválida" };
      return { ok: true, valor: iso };
    }
    case "SIM_NAO": {
      if (typeof bruto === "boolean") return { ok: true, valor: bruto };
      const s = String(bruto)
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
      if (["sim", "s", "true", "1", "yes", "verdadeiro", "x"].includes(s)) return { ok: true, valor: true };
      if (["nao", "n", "false", "0", "no", "falso"].includes(s)) return { ok: true, valor: false };
      return { ok: false, erro: "use sim ou não" };
    }
    default:
      return { ok: true, valor: String(bruto).trim().slice(0, 500) };
  }
}

export function valorParaTexto(tipo: string | undefined, v: ValorCampo | undefined): string {
  if (v === null || v === undefined) return "";
  if (tipo === "SIM_NAO" || typeof v === "boolean") return v ? "sim" : "não";
  if (tipo === "DATA" && typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
  }
  if (typeof v === "number") return String(v).replace(".", ",");
  return String(v);
}

/** Aplica mudanças nos campos de um contato (null apaga a chave). Lê e grava o JSON inteiro. */
export async function gravarCampos(conversaId: string, mudancas: Record<string, ValorCampo>): Promise<Record<string, ValorCampo> | null> {
  const c = await prisma.igConversation.findUnique({ where: { id: conversaId }, select: { campos: true } });
  if (!c) return null;
  const atual = camposDe(c.campos);
  for (const [k, v] of Object.entries(mudancas)) {
    if (v === null) delete atual[k];
    else atual[k] = v;
  }
  await prisma.igConversation.update({ where: { id: conversaId }, data: { campos: atual as Prisma.InputJsonObject } });
  return atual;
}

/** Etiquetas existentes com quantos contatos têm cada uma (para os filtros). */
export async function contagemTags(accountId?: string, loja?: string): Promise<{ tag: string; total: number }[]> {
  // Com loja, a conta só conta se for da mesma empresa (conta da outra empresa devolve lista vazia).
  const rows = loja
    ? await prisma.$queryRaw<{ tag: string; total: bigint }[]>`
        SELECT t AS tag, COUNT(*) AS total FROM (SELECT unnest(c.tags) AS t FROM "IgConversation" c JOIN "InstagramAccount" a ON a.id = c."accountId" WHERE a.loja = ${loja} AND (${accountId ?? null}::text IS NULL OR c."accountId" = ${accountId ?? null})) x
        GROUP BY t ORDER BY COUNT(*) DESC, t ASC`
    : accountId
    ? await prisma.$queryRaw<{ tag: string; total: bigint }[]>`
        SELECT t AS tag, COUNT(*) AS total FROM (SELECT unnest(tags) AS t FROM "IgConversation" WHERE "accountId" = ${accountId}) x
        GROUP BY t ORDER BY COUNT(*) DESC, t ASC`
    : await prisma.$queryRaw<{ tag: string; total: bigint }[]>`
        SELECT t AS tag, COUNT(*) AS total FROM (SELECT unnest(tags) AS t FROM "IgConversation") x
        GROUP BY t ORDER BY COUNT(*) DESC, t ASC`;
  return rows.map((r) => ({ tag: r.tag, total: Number(r.total) }));
}

/** Escapa uma célula de CSV (separador ";", padrão do Excel em português). */
export function celulaCsv(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v);
  // Injeção de fórmula (nome/mensagem vêm do cliente): célula que começa com = + - @ (ou tab/CR) vira texto com ' na frente.
  // Números comuns (-5, +3,5) passam intactos. A importação tira esse ' de volta.
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Lê um CSV (separador ";" ou "," detectado pelo cabeçalho; aspas e quebras de linha dentro de aspas). */
export function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const primeira = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas: string[][] = [];
  let linha: string[] = [];
  let cel = "";
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cel += '"';
          i++;
        } else aspas = false;
      } else cel += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) {
      linha.push(cel);
      cel = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      linha.push(cel);
      cel = "";
      if (linha.some((c) => c.trim() !== "")) linhas.push(linha);
      linha = [];
    } else cel += ch;
  }
  linha.push(cel);
  if (linha.some((c) => c.trim() !== "")) linhas.push(linha);
  return linhas;
}

export const LIMITE_ACAO_FILTRO = 5000;
