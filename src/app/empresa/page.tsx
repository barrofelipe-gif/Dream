import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAccessibleSectors } from "@/lib/permissions";
import { getStatusBySector } from "@/lib/sectorMetrics";
import EmpresaHub from "@/components/EmpresaHub";

export default async function EmpresaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const accessible = await getAccessibleSectors(session.user.id, session.user.role);
  if (accessible.length === 0) redirect("/painel");

  const statusBySector = await getStatusBySector(accessible);

  return (
    <div className="min-h-screen bg-[#0c0d10] px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <Link href="/painel" className="text-sm text-zinc-500 hover:text-zinc-300">
              ← Painel pessoal
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-white">BFF Fitness — Mapa da Empresa</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Um check-up rápido: clica num setor pra abrir o detalhe. Vermelho pulsando = precisa de atenção agora.
            </p>
          </div>
          {session.user.role === "admin" && (
            <div className="flex shrink-0 gap-2">
              <Link
                href="/empresa/vendas"
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Vendas
              </Link>
              <Link
                href="/conectar-tray"
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-white/10"
              >
                Conectar Tray
              </Link>
              <Link
                href="/admin/usuarios"
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-white/10"
              >
                Usuários e acesso
              </Link>
            </div>
          )}
        </div>

        <EmpresaHub sectors={accessible} statusBySector={statusBySector} />
      </div>
    </div>
  );
}
