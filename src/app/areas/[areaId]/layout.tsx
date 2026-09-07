import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getArea } from "@/lib/orgCatalog";
import { Icon } from "@/components/hub/Icon";
import SairButton from "@/components/hub/SairButton";

/**
 * Casca clara reutilizável de todas as áreas — a linguagem visual da
 * `referencias/Referencia_Dashboard_Interno.png` do handoff (fundo claro,
 * sidebar, busca e conta no topo), com a identidade de cada área nos ícones
 * e cores. Fica por cima do dashboard (page.tsx) e da ficha de papel
 * (papeis/[papelId]/page.tsx).
 */
export default async function AreaLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ areaId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { areaId } = await params;
  const area = getArea(areaId);
  if (!area) notFound();

  const accent = area.color === "lime" ? "#7c9a00" : "#0f8f74";
  const accentBg = area.color === "lime" ? "#eef7d6" : "#e3f6f1";

  return (
    <div className="min-h-screen bg-[#f4f5f7] text-[#1b1f2b]">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[#e3e5ea] bg-white px-6 py-3">
        <Link href="/hub" className="flex items-center gap-2 text-sm font-semibold text-[#1b1f2b]">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
            style={{ background: "#1b1f2b" }}
          >
            B
          </span>
          BFF
        </Link>
        <div className="hidden flex-1 max-w-md sm:block">
          <div className="flex items-center gap-2 rounded-full border border-[#e3e5ea] bg-[#f4f5f7] px-4 py-2 text-sm text-[#8a8f9c]">
            <Icon name="search" size={15} />
            Buscar algo…
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-[#5a5f6d] sm:inline">Olá, {session.user.name?.split(" ")[0] ?? "você"}</span>
          <SairButton />
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-6 py-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <Link
            href="/hub"
            className="mb-5 inline-flex items-center gap-1.5 text-xs font-medium text-[#8a8f9c] hover:text-[#1b1f2b]"
          >
            ← Voltar ao hub
          </Link>

          <div
            className="mb-4 rounded-2xl p-4"
            style={{ background: accentBg }}
          >
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-white" style={{ color: accent }}>
              <Icon name={area.icon} size={18} />
            </div>
            <p className="text-sm font-semibold" style={{ color: accent }}>
              {area.name}
            </p>
            <p className="mt-0.5 text-xs text-[#5a5f6d]">{area.sub}</p>
          </div>

          <nav className="space-y-0.5">
            <Link
              href={`/areas/${area.id}`}
              className="block rounded-lg px-3 py-2 text-sm font-medium text-[#1b1f2b] hover:bg-[#eef0f4]"
            >
              Painel
            </Link>
            <p className="px-3 pt-3 pb-1 font-mono text-[10px] uppercase tracking-wide text-[#a1a5b0]">
              Papéis
            </p>
            {area.children.map((papel) => (
              <Link
                key={papel.id}
                href={`/areas/${area.id}/papeis/${papel.id}`}
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-[#5a5f6d] hover:bg-[#eef0f4] hover:text-[#1b1f2b]"
              >
                <Icon name={papel.icon} size={14} />
                {papel.label}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
