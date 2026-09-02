import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasSectorAccess } from "@/lib/permissions";
import VendasClient from "./VendasClient";

export default async function VendasPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Vendas é a visão de faturamento do setor Marketing/Vendas
  const allowed = await hasSectorAccess(session.user.id, session.user.role, "marketing_vendas");
  if (!allowed) redirect("/empresa");

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/empresa" className="text-sm text-zinc-500 hover:text-zinc-700">
        ← Mapa da Empresa
      </Link>
      <h1 className="mt-1 text-xl font-semibold text-zinc-100">Vendas</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Faturamento, pedidos e ticket médio — calculados a partir dos pedidos reais da Tray.
      </p>

      <VendasClient />
    </div>
  );
}
