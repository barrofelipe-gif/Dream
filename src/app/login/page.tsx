import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/painel");

  return (
    <div className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden bg-[#0a0b0e] px-4 py-16">
      {/* fundo — glows + rede de pontos, mesma linguagem visual da Visão Central */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 20% 20%, rgba(99,102,241,0.22), transparent 45%), radial-gradient(circle at 82% 75%, rgba(20,184,166,0.16), transparent 45%), radial-gradient(circle at 50% 100%, rgba(99,102,241,0.12), transparent 55%)",
        }}
      />
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.35]"
        aria-hidden
      >
        <defs>
          <pattern id="dot-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.5" fill="rgba(255,255,255,0.08)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dot-grid)" />
      </svg>

      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500 text-lg font-bold text-white shadow-[0_0_30px_-4px_rgba(99,102,241,0.7)]">
            P
          </div>
          <h1 className="text-xl font-semibold text-white">Painel de Pendências</h1>
          <p className="mt-1.5 text-sm text-zinc-400">Entre para ver suas pendências</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl backdrop-blur-xl sm:p-7">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-zinc-600">BFF Fitness · uso interno</p>
      </div>
    </div>
  );
}
