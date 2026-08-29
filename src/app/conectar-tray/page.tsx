import { Suspense } from "react";
import Link from "next/link";
import ConectarTrayClient from "./ConectarTrayClient";

export default function ConectarTrayPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link href="/empresa" className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-700">
          ← Voltar ao Mapa da Empresa
        </Link>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <Suspense>
            <ConectarTrayClient />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
