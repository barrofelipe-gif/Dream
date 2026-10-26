import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getPapel } from "@/lib/orgCatalog";
import { Icon } from "@/components/hub/Icon";
import PlanejamentoPapel from "@/components/hub/financas/PlanejamentoPapel";
import ControladoriaPapel from "@/components/hub/financas/ControladoriaPapel";
import CobrancaPapel from "@/components/hub/financas/CobrancaPapel";
import FaturamentoPapel from "@/components/hub/financas/FaturamentoPapel";
import AvaliacoesPapel, { type PapelAvaliacoes } from "@/components/hub/avaliacoes/AvaliacoesPapel";
import InstagramPapel from "@/components/hub/growth/InstagramPapel";

/**
 * Ficha de um papel (manager ou agente) — equivalente ao painel lateral
 * `openPanel()` do protótipo original, só que como página de verdade (rota
 * própria, volta funciona, compartilhável por link) em vez de um overlay
 * temporário.
 *
 * Os 4 papéis de Finanças têm conteúdo REAL embutido logo abaixo da ficha
 * (ver src/components/hub/financas/) — antes disso, clicar em qualquer um
 * (ex.: Planejamento) abria só a ficha estática, sem nada de fato conectado,
 * o que parecia "não abrir nada" na prática.
 *
 * Papéis ligados ao sistema de avaliações (BFF e Moranga) também têm conteúdo
 * REAL: números de cada loja e atalhos que abrem o painel de avaliações aqui
 * dentro do app (/avaliacoes/...), com o mesmo login.
 */
const CONTEUDO_FINANCAS: Record<string, () => ReactNode> = {
  planejamento: () => <PlanejamentoPapel />,
  controladoria: () => <ControladoriaPapel />,
  cobranca: () => <CobrancaPapel />,
  faturamento: () => <FaturamentoPapel />,
};

const PAPEIS_AVALIACOES: Record<string, PapelAvaliacoes> = {
  "cliente/avaliacoes": "avaliacoes",
  "cliente/conhecimento": "conhecimento",
  "cliente/suporte": "suporte",
  "growth/conversao": "conversao",
};

export default async function PapelPage({
  params,
  searchParams,
}: {
  params: Promise<{ areaId: string; papelId: string }>;
  searchParams: Promise<{ status?: string; conversa?: string }>;
}) {
  const { areaId, papelId } = await params;
  const { status, conversa } = await searchParams;
  const encontrado = getPapel(areaId, papelId);
  if (!encontrado) notFound();
  const { area, papel } = encontrado;
  const avaliacoes = PAPEIS_AVALIACOES[`${areaId}/${papelId}`];
  const conteudoReal =
    areaId === "financas"
      ? CONTEUDO_FINANCAS[papelId]
      : areaId === "growth" && papelId === "instagram"
        ? () => <InstagramPapel status={status} conversa={conversa} />
        : undefined;

  return (
    <div className={`${avaliacoes || conteudoReal ? "max-w-4xl" : "max-w-2xl"} space-y-6 pb-10`}>
      <Link
        href={`/areas/${area.id}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8a8f9c] hover:text-[#1b1f2b]"
      >
        ← Voltar para {area.name}
      </Link>

      <div className="rounded-2xl border border-[#e3e5ea] bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#eef0f4] text-[#6366f1]">
            <Icon name={papel.icon} size={22} />
          </span>
          <div>
            <p className="text-lg font-semibold text-[#1b1f2b]">{papel.title}</p>
            <p className="text-xs text-[#8a8f9c]">
              {area.name} · <span className="uppercase">{papel.type}</span>
            </p>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-[#5a5f6d]">{papel.desc}</p>

        <div className="mt-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#a1a5b0]">Competências</p>
          <div className="flex flex-wrap gap-2">
            {papel.skills.map((s) => (
              <span
                key={s}
                className="rounded-full border border-[#e3e5ea] bg-[#f4f5f7] px-3 py-1 text-xs text-[#5a5f6d]"
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        {conteudoReal ? (
          conteudoReal()
        ) : avaliacoes ? (
          <AvaliacoesPapel papel={avaliacoes} />
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-[#e3e5ea] bg-[#f9fafb] p-3 text-xs text-[#8a8f9c]">
            Papel catalogado apenas — ainda sem execução automatizada ou ferramenta conectada.
          </div>
        )}
      </div>
    </div>
  );
}
