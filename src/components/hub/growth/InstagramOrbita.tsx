"use client";
import { useRef } from "react";

export default function InstagramOrbita() {
  const frame = useRef<HTMLIFrameElement>(null);
  return (
    <section
      className="min-w-0 space-y-3"
      aria-label="Crescimento com a Órbita"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 via-blue-50 to-emerald-50 p-4">
        <div>
          <p className="text-sm font-semibold text-violet-900">
            Crescimento · Órbita{" "}
            <span className="text-xs font-normal">Teste inicial</span>
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Métricas, públicos e planos de melhoria por conta. Selecione o @
            dentro da Órbita; a seleção é independente da empresa do
            atendimento.
          </p>
        </div>
        <a
          className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-800"
          href="/api/growth/orbita/painel"
          target="_blank"
          rel="noreferrer"
        >
          Abrir em uma aba
        </a>
        <button
          className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white"
          onClick={() => {
            void frame.current?.requestFullscreen().catch(() => {});
          }}
        >
          Tela cheia
        </button>
      </div>
      <iframe
        ref={frame}
        src="/api/growth/orbita/painel"
        title="Órbita — dashboard e crescimento do Instagram"
        className="h-[1100px] w-full rounded-2xl border border-slate-200 bg-white"
        allow="fullscreen"
        allowFullScreen
      />
    </section>
  );
}
