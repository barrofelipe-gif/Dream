import Link from "next/link";
import { notFound } from "next/navigation";
import { getPapel } from "@/lib/orgCatalog";
import { Icon } from "@/components/hub/Icon";

/**
 * Ficha de um papel (manager ou agente) — equivalente ao painel lateral
 * `openPanel()` do protótipo original, só que como página de verdade (rota
 * própria, volta funciona, compartilhável por link) em vez de um overlay
 * temporário.
 */
export default async function PapelPage({
  params,
}: {
  params: Promise<{ areaId: string; papelId: string }>;
}) {
  const { areaId, papelId } = await params;
  const encontrado = getPapel(areaId, papelId);
  if (!encontrado) notFound();
  const { area, papel } = encontrado;

  return (
    <div className="max-w-2xl space-y-6 pb-10">
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

        <div className="mt-5 rounded-xl border border-dashed border-[#e3e5ea] bg-[#f9fafb] p-3 text-xs text-[#8a8f9c]">
          Papel catalogado apenas — ainda sem execução automatizada ou ferramenta conectada.
        </div>
      </div>
    </div>
  );
}
