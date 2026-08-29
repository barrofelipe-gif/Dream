import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAccessibleSectors } from "@/lib/permissions";
import { SECTORS } from "@/lib/sectors";

export default async function EmpresaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const accessible = await getAccessibleSectors(session.user.id, session.user.role);
  if (accessible.length === 0) redirect("/painel");

  const sectors = SECTORS.filter((s) => accessible.includes(s.value));

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <Link href="/painel" className="text-sm text-zinc-500 hover:text-zinc-700">
            ← Painel pessoal
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">BFF Fitness — Mapa da Empresa</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Um check-up rápido: cada setor é um &quot;órgão&quot; — verde quando está tudo dentro do esperado.
          </p>
        </div>
        {session.user.role === "admin" && (
          <Link
            href="/admin/usuarios"
            className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Usuários e acesso
          </Link>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sectors.map((s) => (
          <Link
            key={s.value}
            href={`/empresa/${s.value}`}
            className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-zinc-300" title="Sem dados ainda" />
            <div>
              <p className="text-sm font-semibold text-zinc-900">{s.label}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{s.description}</p>
              <p className="mt-1.5 text-[11px] font-medium text-zinc-400">Sem dados conectados ainda</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
