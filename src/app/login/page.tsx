import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import BrainScene from "@/components/hub/BrainScene";
import LoginForm from "./LoginForm";

/**
 * Login — continuação da cena do cérebro (ver Home em src/app/page.tsx), não
 * uma tela branca à parte. Acesso concluído leva ao hub, não direto num
 * dashboard.
 */
export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/hub");

  return (
    <div className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden bg-[#070907] px-4 py-16">
      <BrainScene variant="login" className="absolute inset-0" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link
            href="/"
            className="mb-4 inline-flex font-mono text-[11px] uppercase tracking-[0.3em] text-[#8b9389] hover:text-[#3ad0a8]"
          >
            ← BFF
          </Link>
          <h1 className="text-xl font-semibold text-[#e9ede8]">Entrar</h1>
          <p className="mt-1.5 text-sm text-[#8b9389]">Acesse o hub das sete áreas</p>
        </div>

        <div className="rounded-2xl border border-[#2a322c] bg-[#0d110e]/90 p-6 shadow-2xl backdrop-blur-xl sm:p-7">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-[#4f574f]">
          BFF · uso interno
        </p>
      </div>
    </div>
  );
}
