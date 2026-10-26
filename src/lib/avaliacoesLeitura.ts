import "server-only";

// Cliente SOMENTE LEITURA da API do painel do bff-avaliacoes (perguntas e
// respostas das lojas). Passa pela API (não pelo banco) para valer as regras
// do sistema, como esconder e-mail e telefone. Nunca escreve lá.

export type Loja = "bff" | "moranga";

export type FaqItem = {
  id: number;
  question: string;
  answer: string;
  category: string | null;
  active: boolean;
};

export type QaItem = {
  id: number;
  question: string;
  answer: string;
  productName: string | null;
};

type RawFaq = FaqItem & { scope?: string };
type RawQuestion = {
  id: number;
  question: string;
  answer: string | null;
  status: string;
  product_name: string | null;
};

async function get<T>(path: string, loja: Loja): Promise<T> {
  const base = process.env.BFFR_BASE;
  const token = process.env.BFFR_TOKEN;
  if (!base || !token) throw new Error("BFFR_BASE/BFFR_TOKEN não configurados");
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
  if (loja !== "bff") url.searchParams.set("loja", loja);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`bff-avaliacoes ${path} respondeu ${res.status}`);
  return (await res.json()) as T;
}

/** Perguntas padrão (FAQ) ativas da loja. */
export async function listarFaq(loja: Loja): Promise<FaqItem[]> {
  const { items } = await get<{ items: RawFaq[] }>("api/admin/faq", loja);
  return items.filter((f) => f.active && f.question && f.answer);
}

/** Perguntas de clientes já respondidas e aprovadas (status "approved"). */
export async function listarPerguntasRespondidas(loja: Loja): Promise<QaItem[]> {
  const { items } = await get<{ items: RawQuestion[] }>(
    "api/admin/questions?status=approved",
    loja,
  );
  return items
    .filter((q) => q.answer)
    .map((q) => ({
      id: q.id,
      question: q.question,
      answer: q.answer as string,
      productName: q.product_name,
    }));
}
