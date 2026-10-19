import { LOJAS, linkPainel, resumoLoja, type LojaId, type ResumoLoja } from "@/lib/avaliacoes";

/**
 * Conteúdo real dos papéis ligados ao sistema de avaliações (BFF e Moranga):
 *  - Cliente › Avaliações: aprovar, responder, pedir avaliação, NPS e reputação
 *  - Cliente › Conhecimento: perguntas padrão, página Perguntas Frequentes, dúvidas por página
 *  - Cliente › Suporte: perguntas das clientes, motivos das críticas, alertas
 *  - Growth › Conversão: funil "por que vende", melhorias por produto, histórico
 * Os botões abrem o painel de avaliações aqui mesmo no app (/avaliacoes/...), já na empresa e na tela certas,
 * com o login do app.
 */
export type PapelAvaliacoes = "avaliacoes" | "conhecimento" | "suporte" | "conversao";

type Acao = { label: string; aba: string; rel?: string; destaque?: (r: ResumoLoja) => number | null };

const ACOES: Record<PapelAvaliacoes, { intro: string; acoes: Acao[] }> = {
  avaliacoes: {
    intro: "Avaliações de produto e da loja: nada aparece no site sem passar pela fila.",
    acoes: [
      { label: "Aprovar avaliações de produto", aba: "reviews", destaque: (r) => r.reviews_pending },
      { label: "Aprovar avaliações da loja", aba: "store", destaque: (r) => r.store_pending },
      { label: "Pedir avaliação (WhatsApp)", aba: "invites" },
      { label: "Painel geral", aba: "dashboard" },
      { label: "NPS e reputação", aba: "reports", rel: "store" },
      { label: "Subir planilha do Excel", aba: "import" },
    ],
  },
  conhecimento: {
    intro: "Respostas que toda cliente precisa, escritas uma vez: aparecem no produto, nas Dúvidas rápidas e na página Perguntas Frequentes.",
    acoes: [
      { label: "Perguntas padrão", aba: "faq" },
      { label: "Dúvidas e o que as clientes buscam", aba: "reports", rel: "doubts" },
    ],
  },
  suporte: {
    intro: "Perguntas das clientes no site (com a página de onde vieram) e o que elas reclamam nas avaliações.",
    acoes: [
      { label: "Responder perguntas", aba: "questions", destaque: (r) => r.questions_pending },
      { label: "Motivos das críticas", aba: "reports", rel: "tags" },
      { label: "Alertas", aba: "reports", rel: "alerts" },
    ],
  },
  conversao: {
    intro: "Por que cada produto vende (ou não): funil visto → carrinho → compra, prova social e plano de melhorias.",
    acoes: [
      { label: "Funil: por que vende", aba: "reports", rel: "funnel" },
      { label: "Melhorias por produto", aba: "reports", rel: "improve" },
      { label: "Histórico de melhorias", aba: "reports", rel: "history" },
      { label: "Produtos (avaliações × vendas)", aba: "reports", rel: "products" },
    ],
  },
};

function Numeros({ r }: { r: ResumoLoja }) {
  const itens: [string, string][] = [
    ["Avaliações publicadas", String(r.reviews_approved)],
    ["Nota média", r.reviews_avg != null ? r.reviews_avg.toFixed(2).replace(".", ",") : "–"],
    ["Na fila", String(r.reviews_pending + r.store_pending)],
    ["Perguntas sem resposta", String(r.questions_pending)],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {itens.map(([k, v]) => (
        <div key={k} className="min-w-0 rounded-xl border border-[#e3e5ea] bg-[#f9fafb] px-3 py-2">
          <p className="truncate text-[11px] text-[#8a8f9c]">{k}</p>
          <p className="text-lg font-semibold text-[#1b1f2b]">{v}</p>
        </div>
      ))}
    </div>
  );
}

export default async function AvaliacoesPapel({ papel }: { papel: PapelAvaliacoes }) {
  const cfg = ACOES[papel];
  const resumos = await Promise.all(LOJAS.map(async (l) => ({ ...l, r: await resumoLoja(l.id) })));
  return (
    <div className="mt-6 space-y-4">
      <p className="text-sm text-[#5a5f6d]">{cfg.intro}</p>
      {resumos.map(({ id, nome, r }) => (
        <div key={id} className="space-y-3 rounded-2xl border border-[#e3e5ea] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[#1b1f2b]">{nome}</p>
            <a href={linkPainel(id as LojaId, "dashboard")} className="text-xs font-medium text-[#6366f1] hover:underline">
              Abrir painel de avaliações →
            </a>
          </div>
          {r ? <Numeros r={r} /> : <p className="text-xs text-[#8a8f9c]">Números indisponíveis agora (o painel abre normalmente).</p>}
          <div className="flex flex-wrap gap-2">
            {cfg.acoes.map((a) => {
              const n = r && a.destaque ? a.destaque(r) : null;
              return (
                <a
                  key={a.label}
                  href={linkPainel(id as LojaId, a.aba, a.rel)}
                  className="inline-flex items-center gap-2 rounded-full border border-[#e3e5ea] bg-white px-3 py-1.5 text-xs font-medium text-[#1b1f2b] hover:border-[#6366f1] hover:text-[#6366f1]"
                >
                  {a.label}
                  {n ? <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">{n}</span> : null}
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
