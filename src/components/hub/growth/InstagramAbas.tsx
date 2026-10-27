"use client";

import { useEffect, useState, type ReactNode } from "react";

export type Aba = { id: string; rotulo: string; grupo: string; conteudo: ReactNode };

const CHAVE = "ig-aba-ativa";

/**
 * Menu lateral do Instagram, como no ManyChat: uma seção por vez em vez de tudo empilhado.
 * Só a aba aberta é montada, então as outras não fazem requisições.
 */
export default function InstagramAbas({ abas }: { abas: Aba[] }) {
  const [ativa, setAtiva] = useState(abas[0]?.id ?? "");

  useEffect(() => {
    try {
      const salva = window.localStorage.getItem(CHAVE);
      if (salva && abas.some((a) => a.id === salva)) setAtiva(salva);
    } catch {
      /* sem armazenamento: fica na primeira aba */
    }
  }, [abas]);

  function abrir(id: string) {
    setAtiva(id);
    try {
      window.localStorage.setItem(CHAVE, id);
    } catch {
      /* ignora */
    }
  }

  const grupos = Array.from(new Set(abas.map((a) => a.grupo)));
  const atual = abas.find((a) => a.id === ativa) ?? abas[0];

  return (
    <div className="flex flex-col gap-5 md:flex-row md:gap-6">
      <nav className="md:w-52 md:shrink-0">
        <div className="flex gap-1.5 overflow-x-auto pb-1 md:sticky md:top-4 md:flex-col md:gap-4 md:overflow-visible md:pb-0">
          {grupos.map((g) => (
            <div key={g} className="flex shrink-0 gap-1.5 md:flex-col md:gap-0.5">
              <p className="hidden px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-[#a1a5b0] md:block">{g}</p>
              {abas
                .filter((a) => a.grupo === g)
                .map((a) => (
                  <button
                    key={a.id}
                    onClick={() => abrir(a.id)}
                    className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      a.id === atual?.id ? "bg-[#eef0ff] font-medium text-[#4f46e5]" : "text-[#5a5f6d] hover:bg-[#f4f5f8]"
                    }`}
                  >
                    {a.rotulo}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </nav>
      <div className="min-w-0 flex-1">{atual?.conteudo}</div>
    </div>
  );
}
