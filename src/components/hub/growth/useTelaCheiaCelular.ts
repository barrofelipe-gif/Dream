"use client";

import { useEffect, useState, type CSSProperties, type RefObject } from "react";

/** true quando o elemento (ou a tela, se não houver elemento) é mais estreito que `limite` px. Acompanha giro e redimensionamento. */
export function useEstreito(limite: number, ref?: RefObject<HTMLElement | null>) {
  const [estreito, setEstreito] = useState(false);
  useEffect(() => {
    const el = ref?.current;
    if (el && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => setEstreito(el.offsetWidth < limite));
      ro.observe(el);
      return () => ro.disconnect();
    }
    const mq = window.matchMedia(`(max-width: ${limite - 1}px)`);
    const ver = () => setEstreito(mq.matches);
    const raf = requestAnimationFrame(ver);
    mq.addEventListener("change", ver);
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener("change", ver);
    };
  }, [limite, ref]);
  return estreito;
}

/**
 * Conversa aberta em tela cheia no celular: trava a rolagem da página de trás, fecha com Esc e
 * acompanha a área visível (no iPhone o teclado encolhe a tela; sem isso a caixa de resposta
 * ficaria escondida atrás dele). Devolve o estilo para pôr no painel fixo.
 */
export function useTelaCheiaCelular(ativo: boolean, aoFechar: () => void): CSSProperties | undefined {
  const [area, setArea] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    if (!ativo) return;
    const antes = document.body.style.overflow;
    const calhaAntes = document.documentElement.style.scrollbarGutter;
    // Guarda o espaço da barra de rolagem: sem isso a largura muda ao travar e, perto de 768 px, a tela ficava piscando.
    document.documentElement.style.scrollbarGutter = "stable";
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", esc);
    const vv = window.visualViewport;
    const medir = () => vv && setArea({ top: vv.offsetTop, height: vv.height });
    const raf = requestAnimationFrame(medir);
    vv?.addEventListener("resize", medir);
    vv?.addEventListener("scroll", medir);
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = antes;
      document.documentElement.style.scrollbarGutter = calhaAntes;
      window.removeEventListener("keydown", esc);
      vv?.removeEventListener("resize", medir);
      vv?.removeEventListener("scroll", medir);
      setArea(null);
    };
  }, [ativo, aoFechar]);

  return ativo && area ? { top: area.top, height: area.height, bottom: "auto" } : undefined;
}
