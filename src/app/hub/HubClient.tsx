"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Icon } from "@/components/hub/Icon";
import { AREAS, CATALOGO_BUSCA, TOTAL_PAPEIS, TOTAL_MANAGERS } from "@/lib/orgCatalog";

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export default function HubClient({ nomeUsuario }: { nomeUsuario: string }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [visao, setVisao] = useState<"mapa" | "lista">("mapa");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const resultados = useMemo(() => {
    const q = normalizar(busca.trim());
    if (!q) return [];
    return CATALOGO_BUSCA.filter((r) => normalizar(`${r.label} ${r.sub}`).includes(q)).slice(0, 12);
  }, [busca]);

  function irPara(areaId: string, papelId?: string) {
    router.push(papelId ? `/areas/${areaId}/papeis/${papelId}` : `/areas/${areaId}`);
  }

  return (
    <div className="min-h-screen bg-[#070907] text-[#e9ede8]">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-[#1c221d] bg-[#070907]/95 px-5 py-4 backdrop-blur">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#8b9389]">BFF · hub</p>
          <h1 className="text-lg font-semibold">Olá, {nomeUsuario}</h1>
        </div>

        <div className="relative w-full max-w-sm sm:w-80">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#4f574f]"
          />
          <input
            ref={inputRef}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar área ou papel…"
            className="w-full rounded-full border border-[#2a322c] bg-[#0d110e] py-2 pl-9 pr-16 text-sm text-[#e9ede8] outline-none placeholder:text-[#4f574f] focus:border-[#3ad0a8]"
            aria-label="Buscar área ou papel"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-[#2a322c] px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-[#8b9389]">
            ⌘K
          </kbd>

          {resultados.length > 0 && (
            <ul className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-[#2a322c] bg-[#0d110e] shadow-2xl">
              {resultados.map((r) => (
                <li key={`${r.areaId}-${r.papelId ?? "area"}`}>
                  <button
                    type="button"
                    onClick={() => irPara(r.areaId, r.papelId)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/5 focus:bg-white/5 focus:outline-none"
                  >
                    <span>
                      <span className="mr-2 font-mono text-[10px] uppercase tracking-wide text-[#3ad0a8]">
                        {r.kind}
                      </span>
                      {r.label}
                    </span>
                    <span className="text-xs text-[#8b9389]">{r.sub}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex rounded-full border border-[#2a322c] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setVisao("mapa")}
              className={`rounded-full px-3 py-1.5 transition ${visao === "mapa" ? "bg-[#3ad0a8] text-[#04120c]" : "text-[#8b9389] hover:text-[#e9ede8]"}`}
            >
              Mapa
            </button>
            <button
              type="button"
              onClick={() => setVisao("lista")}
              className={`rounded-full px-3 py-1.5 transition ${visao === "lista" ? "bg-[#3ad0a8] text-[#04120c]" : "text-[#8b9389] hover:text-[#e9ede8]"}`}
            >
              Lista
            </button>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/" })}
            className="rounded-full border border-[#2a322c] px-4 py-1.5 text-xs text-[#8b9389] transition hover:border-[#3ad0a8] hover:text-[#e9ede8]"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        <div className="mb-6 flex flex-wrap gap-4 font-mono text-[11px] uppercase tracking-wide text-[#8b9389]">
          <span>{AREAS.length} áreas</span>
          <span>·</span>
          <span>{TOTAL_PAPEIS} papéis catalogados</span>
          <span>·</span>
          <span>{TOTAL_MANAGERS} managers</span>
        </div>

        {visao === "mapa" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AREAS.map((area) => (
              <Link
                key={area.id}
                href={`/areas/${area.id}`}
                className="group relative overflow-hidden rounded-2xl border border-[#1c221d] bg-[#0d110e] p-5 transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3ad0a8]"
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = area.color === "lime" ? "#c9ff3d" : "#3ad0a8")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "")}
              >
                <div
                  className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border"
                  style={{
                    borderColor: area.color === "lime" ? "#c9ff3d55" : "#3ad0a855",
                    color: area.color === "lime" ? "#c9ff3d" : "#3ad0a8",
                  }}
                >
                  <Icon name={area.icon} size={22} />
                </div>
                <h2 className="font-mono text-sm uppercase tracking-[0.15em] text-[#e9ede8]">
                  {area.name}
                </h2>
                <p className="mt-1 text-xs text-[#8b9389]">{area.sub}</p>
                <p className="mt-3 text-xs text-[#4f574f]">{area.children.length} papéis</p>
                <span
                  aria-hidden
                  className="absolute bottom-4 right-5 text-lg text-[#4f574f] transition group-hover:translate-x-1 group-hover:text-[#e9ede8]"
                >
                  →
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#1c221d]">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-[#0d110e] font-mono text-[10px] uppercase tracking-wide text-[#8b9389]">
                <tr>
                  <th className="px-4 py-3">Papel</th>
                  <th className="px-4 py-3">Área</th>
                  <th className="px-4 py-3">Tipo</th>
                </tr>
              </thead>
              <tbody>
                {AREAS.flatMap((area) =>
                  area.children.map((papel) => (
                    <tr
                      key={papel.id}
                      className="cursor-pointer border-t border-[#1c221d] hover:bg-white/[0.03]"
                      onClick={() => irPara(area.id, papel.id)}
                    >
                      <td className="px-4 py-3">{papel.title}</td>
                      <td className="px-4 py-3 text-[#8b9389]">{area.name}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-[#2a322c] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#8b9389]">
                          {papel.type}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-10 rounded-2xl border border-dashed border-[#2a322c] p-5">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-wide text-[#4f574f]">
            Ferramentas com dado real (já em produção)
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/painel" className="rounded-full border border-[#2a322c] px-4 py-2 hover:border-[#3ad0a8]">
              Pendências (Kanban)
            </Link>
            <Link href="/empresa" className="rounded-full border border-[#2a322c] px-4 py-2 hover:border-[#3ad0a8]">
              Mapa da Empresa / Tray
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
