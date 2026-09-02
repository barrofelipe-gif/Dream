import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasSectorAccess } from "@/lib/permissions";
import ClientesCrmClient from "./ClientesCrmClient";

export default async function ClientesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const allowed = await hasSectorAccess(session.user.id, session.user.role, "clientes");
  if (!allowed) redirect("/empresa");

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/empresa" className="text-sm text-zinc-500 hover:text-zinc-700">
        ← Mapa da Empresa
      </Link>
      <h1 className="mt-1 text-xl font-semibold text-zinc-900">Clientes</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Recência/recorrência, ticket médio, saúde da base — dados puxados direto da Tray.
      </p>

      <ClientesCrmClient />
    </div>
  );
}
