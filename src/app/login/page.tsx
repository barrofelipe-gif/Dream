import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { CATEGORIES } from "@/lib/types";
import { CATEGORY_STYLE } from "@/lib/style";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/painel");

  return (
    <div className="flex min-h-screen flex-1">
      {/* painel de marca — some em telas pequenas */}
      <div className="relative hidden flex-1 overflow-hidden bg-[#1b1f2b] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(circle at 15% 20%, rgba(99,102,241,0.35), transparent 45%), radial-gradient(circle at 85% 75%, rgba(20,184,166,0.3), transparent 45%)",
          }}
        />

        <div className="relative flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500 text-sm font-bold text-white">
            P
          </div>
          <span className="text-sm font-semibold text-white">Painel de Pendências</span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight text-white">
            Todas as suas pendências, num só lugar.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            Processos, Empresa BFF, e-mails e viagens — organizados por prioridade e prazo,
            com os e-mails pendentes do Gmail entrando direto no quadro.
          </p>

          <div className="mt-8 grid grid-cols-2 gap-3">
            {CATEGORIES.map((c) => {
              const style = CATEGORY_STYLE[c.value];
              const Icon = style.icon;
              return (
                <div
                  key={c.value}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-zinc-200 backdrop-blur-sm"
                >
                  <span className="shrink-0" style={{ color: style.accent }}>
                    <Icon className="h-4 w-4" />
                  </span>
                  {c.label}
                </div>
              );
            })}
          </div>
        </div>

        <p className="relative text-xs text-zinc-500">Uso pessoal — Fase 1</p>
      </div>

      {/* formulário */}
      <div className="flex flex-1 items-center justify-center bg-[var(--background)] px-4 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center lg:hidden">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">
              P
            </div>
            <h1 className="text-xl font-semibold text-zinc-900">Painel de Pendências</h1>
          </div>
          <div className="mb-6 hidden lg:block">
            <h1 className="text-xl font-semibold text-zinc-900">Bem-vindo de volta</h1>
            <p className="mt-1 text-sm text-zinc-500">Entre para ver suas pendências</p>
          </div>
          <p className="mb-6 text-sm text-zinc-500 lg:hidden">Entre para ver suas pendências</p>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
