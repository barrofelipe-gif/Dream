import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import BrainScene from "@/components/hub/BrainScene";
import EnterKeyShortcut from "@/components/hub/EnterKeyShortcut";

/**
 * Home pública — o cérebro é a identidade e o ponto de entrada (ver
 * documentação/03_Analise_UX_Arquitetura_Plano.md do handoff). Quem já tem
 * sessão nem vê essa tela: vai direto pro hub.
 */
export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/hub");

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#070907] px-4 text-center">
      <BrainScene variant="home" className="absolute inset-0" />
      <EnterKeyShortcut href="/login" />

      <div className="relative z-10 flex flex-col items-center">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.35em] text-[#8b9389]">
          BFF · sistema operacional
        </p>
        <h1 className="max-w-lg text-4xl font-semibold tracking-tight text-[#e9ede8] sm:text-5xl">
          BFF
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-[#8b9389] sm:text-base">
          Sete áreas, trinta e seis papéis, um único lugar pra decidir, acompanhar e agir.
        </p>

        <Link
          href="/login"
          className="group mt-10 inline-flex items-center gap-2 rounded-full border border-[#2a322c] bg-[#0d110e] px-7 py-3 text-sm font-medium text-[#e9ede8] shadow-[0_0_40px_-12px_rgba(58,208,168,0.6)] transition hover:border-[#3ad0a8] hover:shadow-[0_0_50px_-8px_rgba(58,208,168,0.85)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3ad0a8]"
        >
          Entrar
          <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </Link>

        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.25em] text-[#4f574f]">
          pressione Enter
        </p>
      </div>
    </div>
  );
}
