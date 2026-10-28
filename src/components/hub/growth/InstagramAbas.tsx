"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEstreito } from "@/components/hub/growth/useTelaCheiaCelular";

export type Aba = {
  id: string;
  rotulo: string;
  grupo: string;
  conteudo: ReactNode;
  /** Uma linha: o que é e como usar. Aparece em cima do conteúdo e no menu do celular. */
  ajuda?: string;
  /** Número no menu (ex.: conversas esperando a equipe). Zero ou vazio não aparece. */
  contador?: number;
};

const CHAVE = "ig-aba-ativa";

function Contador({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="ml-auto min-w-[20px] rounded-full bg-[#6366f1] px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * Menu do Instagram, como no ManyChat: uma seção por vez em vez de tudo empilhado.
 * Só a aba aberta é montada, então as outras não fazem requisições.
 * Computador: lista fixa à esquerda, por grupo. Celular: barra fixa no topo com o nome da
 * seção; ao tocar, abre a lista inteira em tela cheia. O endereço guarda a seção (#conversas),
 * então dá para mandar o link de uma seção e o botão Voltar do navegador funciona.
 */
export default function InstagramAbas({ abas }: { abas: Aba[] }) {
  const [ativa, setAtiva] = useState(abas[0]?.id ?? "");
  const [menuAberto, setMenuAberto] = useState(false);
  const topo = useRef<HTMLDivElement>(null);
  const botaoMenu = useRef<HTMLButtonElement>(null);
  const botaoFechar = useRef<HTMLButtonElement>(null);
  const dialogo = useRef<HTMLDivElement>(null);
  // O menu em tela cheia só existe no celular; se a tela alargar com ele aberto, some sozinho.
  const celular = useEstreito(768);
  const menuVisivel = menuAberto && celular;

  useEffect(() => {
    const doEndereco = () => {
      let h = "";
      try {
        h = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        /* endereço malformado: ignora */
      }
      if (h && abas.some((a) => a.id === h)) {
        setAtiva(h);
        return true;
      }
      return false;
    };
    if (!doEndereco()) {
      let inicial = abas[0]?.id ?? "";
      try {
        const salva = window.localStorage.getItem(CHAVE);
        if (salva && abas.some((a) => a.id === salva)) inicial = salva;
      } catch {
        /* sem armazenamento: fica na primeira aba */
      }
      setAtiva(inicial);
      // Grava a seção no endereço sem criar passo novo no histórico, para o Voltar sempre achar uma seção.
      if (inicial) window.history.replaceState(window.history.state, "", `#${inicial}`);
    }
    window.addEventListener("hashchange", doEndereco);
    return () => window.removeEventListener("hashchange", doEndereco);
  }, [abas]);

  // Menu do celular aberto: a página de trás não rola, e Esc fecha.
  useEffect(() => {
    if (!menuVisivel) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setMenuAberto(false);
      // Tab fica dentro do menu (não alcança a página por trás).
      const caixa = dialogo.current;
      if (e.key !== "Tab" || !caixa) return;
      const itens = [...caixa.querySelectorAll<HTMLElement>("button")];
      if (!itens.length) return;
      const primeiro = itens[0];
      const ultimo = itens[itens.length - 1];
      const dentro = caixa.contains(document.activeElement);
      if (e.shiftKey && (!dentro || document.activeElement === primeiro)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (!dentro || document.activeElement === ultimo)) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    window.addEventListener("keydown", esc);
    botaoFechar.current?.focus();
    const gatilho = botaoMenu.current;
    return () => {
      document.body.style.overflow = antes;
      window.removeEventListener("keydown", esc);
      gatilho?.focus({ preventScroll: true });
    };
  }, [menuVisivel]);

  function abrir(id: string) {
    setAtiva(id);
    setMenuAberto(false);
    try {
      window.localStorage.setItem(CHAVE, id);
    } catch {
      /* ignora */
    }
    if (window.location.hash.slice(1) !== id) window.history.pushState(window.history.state, "", `#${id}`);
    // No celular, a seção nova começa do topo (logo abaixo da barra do menu).
    const el = topo.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
  }

  const grupos = Array.from(new Set(abas.map((a) => a.grupo)));
  const atual = abas.find((a) => a.id === ativa) ?? abas[0];

  return (
    <div ref={topo} className="flex scroll-mt-16 flex-col gap-4 md:flex-row md:gap-6">
      {/* Celular: barra fixa com a seção atual */}
      <div className="sticky top-[57px] z-20 -mx-3 border-b border-[#e3e5ea] bg-white/95 px-3 py-2 backdrop-blur md:hidden">
        <button
          ref={botaoMenu}
          onClick={() => setMenuAberto(true)}
          aria-haspopup="dialog"
          aria-expanded={menuVisivel}
          className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-[#e3e5ea] bg-white px-3 text-left shadow-sm"
        >
          <span className="flex h-6 w-6 shrink-0 flex-col justify-center gap-1" aria-hidden>
            <span className="h-0.5 w-5 rounded bg-[#1b1f2b]" />
            <span className="h-0.5 w-5 rounded bg-[#1b1f2b]" />
            <span className="h-0.5 w-5 rounded bg-[#1b1f2b]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-medium uppercase tracking-wide text-[#a1a5b0]">{atual?.grupo}</span>
            <span className="block truncate text-sm font-semibold text-[#1b1f2b]">{atual?.rotulo}</span>
          </span>
          {abas.some((a) => a.id !== atual?.id && a.contador) && (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#6366f1]" title="Tem novidade em outra seção" />
          )}
          <span className="shrink-0 text-xs font-medium text-[#6366f1]">Trocar ▾</span>
        </button>
      </div>

      {menuVisivel && (
        <div ref={dialogo} role="dialog" aria-modal="true" aria-label="Seções do Instagram" className="fixed inset-0 z-50 flex flex-col bg-white md:hidden">
          <div className="flex items-center justify-between border-b border-[#e3e5ea] px-4 py-2">
            <p className="text-base font-semibold text-[#1b1f2b]">Instagram: seções</p>
            <button
              ref={botaoFechar}
              onClick={() => setMenuAberto(false)}
              className="flex h-11 min-w-[44px] items-center justify-center rounded-xl px-3 text-sm font-medium text-[#5a5f6d] hover:bg-[#f4f5f8]"
            >
              Fechar ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(16px,env(safe-area-inset-bottom))]">
            {grupos.map((g) => (
              <div key={g} className="pt-3">
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#a1a5b0]">{g}</p>
                {abas
                  .filter((a) => a.grupo === g)
                  .map((a) => (
                    <button
                      key={a.id}
                      onClick={() => abrir(a.id)}
                      className={`flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${
                        a.id === atual?.id ? "bg-[#eef0ff]" : "active:bg-[#f4f5f8]"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[15px] ${a.id === atual?.id ? "font-semibold text-[#4f46e5]" : "font-medium text-[#1b1f2b]"}`}>
                          {a.rotulo}
                        </span>
                        {a.ajuda && <span className="block text-xs leading-snug text-[#8a8f9c]">{a.ajuda}</span>}
                      </span>
                      <Contador n={a.contador} />
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Computador: lista à esquerda */}
      <nav className="hidden md:block md:w-52 md:shrink-0" aria-label="Seções do Instagram">
        <div className="sticky top-20 flex flex-col gap-4">
          {grupos.map((g) => (
            <div key={g} className="flex flex-col gap-0.5">
              <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-[#a1a5b0]">{g}</p>
              {abas
                .filter((a) => a.grupo === g)
                .map((a) => (
                  <button
                    key={a.id}
                    onClick={() => abrir(a.id)}
                    title={a.ajuda}
                    aria-current={a.id === atual?.id ? "page" : undefined}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      a.id === atual?.id ? "bg-[#eef0ff] font-medium text-[#4f46e5]" : "text-[#5a5f6d] hover:bg-[#f4f5f8]"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{a.rotulo}</span>
                      {a.id === atual?.id && a.ajuda && (
                        <span className="mt-0.5 block text-[11px] font-normal leading-snug text-[#6b6f80]">{a.ajuda}</span>
                      )}
                    </span>
                    <Contador n={a.contador} />
                  </button>
                ))}
            </div>
          ))}
        </div>
      </nav>

      {/* Cada seção já traz o próprio título e explicação; a ajuda curta fica no menu. */}
      <div className="min-w-0 flex-1">{atual?.conteudo}</div>
    </div>
  );
}
