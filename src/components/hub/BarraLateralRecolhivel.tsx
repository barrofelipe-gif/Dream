"use client";

import { useEffect, useState, type ReactNode } from "react";

const CHAVE = "barra-lateral-fixa";

/**
 * Menu lateral das áreas que pode encolher. Recolhido, vira uma faixa fina e abre por cima
 * do conteúdo quando o mouse encosta, sem empurrar a tela.
 */
export default function BarraLateralRecolhivel({ children }: { children: ReactNode }) {
  const [fixa, setFixa] = useState(true);
  const [aberta, setAberta] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(CHAVE) === "0") setFixa(false);
    } catch {
      /* sem armazenamento: fica aberta */
    }
  }, []);

  function alternar() {
    const nova = !fixa;
    setFixa(nova);
    setAberta(false);
    try {
      window.localStorage.setItem(CHAVE, nova ? "1" : "0");
    } catch {
      /* ignora */
    }
  }

  const visivel = fixa || aberta;

  return (
    <aside
      className={`relative hidden shrink-0 md:block ${fixa ? "w-56" : "w-9"}`}
      onMouseEnter={() => !fixa && setAberta(true)}
      onMouseLeave={() => !fixa && setAberta(false)}
    >
      <button
        onClick={alternar}
        title={fixa ? "Esconder o menu" : "Fixar o menu"}
        aria-label={fixa ? "Esconder o menu" : "Fixar o menu"}
        className="absolute right-0 top-0 z-30 flex h-7 w-7 items-center justify-center rounded-lg border border-[#e3e5ea] bg-white text-xs text-[#5a5f6d] shadow-sm hover:bg-[#eef0f4]"
      >
        {fixa ? "«" : "»"}
      </button>
      {visivel && (
        <div className={fixa ? "" : "absolute left-0 top-0 z-20 w-56 rounded-2xl border border-[#e3e5ea] bg-white p-4 pr-10 shadow-lg"}>
          {children}
        </div>
      )}
    </aside>
  );
}
