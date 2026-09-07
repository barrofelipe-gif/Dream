"use client";

import { useEffect, useRef } from "react";

/**
 * Cena do cérebro — identidade e porta de entrada (home/login).
 *
 * O protótipo original desenhava uma esfera matemática de 720 partículas
 * (ver `drawBrain()` em app.js) — não lembra um cérebro, só uma nuvem de
 * pontos. Aqui o cérebro em si é uma silhueta SVG reconhecível (dois
 * hemisférios, sulco central, giros), e as partículas do protótipo viram um
 * acabamento — brilho e pontos que decoram o contorno, não o desenho
 * principal. Mantém a paleta e a sensação de "rede neural" do original sem
 * depender só da esfera de partículas.
 *
 * Respeita prefers-reduced-motion: para a rotação/deriva das partículas,
 * mantém só uma pulsação bem discreta de opacidade.
 */

interface Particula {
  x: number; // -1..1 relativo ao raio do hemisfério
  y: number;
  vx: number;
  vy: number;
  r: number;
  cor: "teal" | "lime" | "white";
  lado: -1 | 1; // hemisfério esquerdo/direito
}

function criarParticulas(n: number): Particula[] {
  const arr: Particula[] = [];
  for (let i = 0; i < n; i++) {
    const lado: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const ang = Math.random() * Math.PI * 2;
    const raio = Math.pow(Math.random(), 0.4);
    const k = Math.random();
    arr.push({
      x: Math.cos(ang) * raio,
      y: Math.sin(ang) * raio * 0.85,
      vx: (Math.random() - 0.5) * 0.0008,
      vy: (Math.random() - 0.5) * 0.0008,
      r: Math.random() * 1.6 + 0.6,
      cor: k < 0.45 ? "teal" : k < 0.75 ? "lime" : "white",
      lado,
    });
  }
  return arr;
}

const CORES: Record<Particula["cor"], string> = {
  teal: "90,225,190",
  lime: "201,255,61",
  white: "235,245,240",
};

export default function BrainScene({
  variant = "home",
  className,
}: {
  variant?: "home" | "login";
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0,
      H = 0;
    const particulas = criarParticulas(variant === "home" ? 260 : 140);

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      W = parent.clientWidth;
      H = parent.clientHeight;
      canvas!.width = W * dpr;
      canvas!.height = H * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let t = 0;
    function frame() {
      ctx!.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * (variant === "home" ? 0.34 : 0.24);
      const gap = R * 0.16; // sulco central entre hemisférios

      t += reduzido ? 0 : 1;
      const pulse = 0.75 + Math.sin(t * 0.02) * 0.08;

      for (const p of particulas) {
        if (!reduzido) {
          p.x += p.vx;
          p.y += p.vy;
          if (Math.abs(p.x) > 1) p.vx *= -1;
          if (Math.abs(p.y) > 1) p.vy *= -1;
        }
        const px = cx + p.lado * gap + p.lado * p.x * R;
        const py = cy + p.y * R * 0.9;
        const alpha = (0.35 + 0.55 * (1 - Math.abs(p.y))) * pulse;
        ctx!.beginPath();
        ctx!.arc(px, py, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${CORES[p.cor]},${alpha})`;
        ctx!.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [variant]);

  const escala = variant === "home" ? 1 : 0.62;

  return (
    // Sem posicionamento próprio (nem "relative"): quem chama controla via
    // className (ex: "absolute inset-0"). Ter as duas classes de posição no
    // mesmo elemento gerava conflito e colapsava a caixa pra 0×0.
    <div className={`pointer-events-none ${className ?? ""}`} aria-hidden>
      {/* brilho de fundo, mesma linguagem do login atual */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 45%, rgba(58,208,168,0.16), transparent 55%), radial-gradient(circle at 50% 55%, rgba(201,255,61,0.06), transparent 60%)",
        }}
      />
      <svg
        viewBox="0 0 400 320"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: `${escala * 100}%`, height: `${escala * 100}%`, maxWidth: 560 }}
      >
        <defs>
          <linearGradient id="brainFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#12241d" />
            <stop offset="1" stopColor="#0a0f0b" />
          </linearGradient>
          <filter id="brainGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* silhueta reconhecível: dois hemisférios com sulco central e giros */}
        <g filter="url(#brainGlow)">
          {/* hemisfério esquerdo */}
          <path
            d="M200 40
               C150 38 108 55 90 95
               C74 128 78 150 66 168
               C50 192 58 222 82 236
               C78 256 96 278 122 282
               C132 300 158 308 178 298
               C190 302 198 296 200 286
               Z"
            fill="url(#brainFill)"
            stroke="#3ad0a8"
            strokeWidth="1.6"
            opacity="0.92"
          />
          {/* hemisfério direito (espelhado) */}
          <path
            d="M200 40
               C250 38 292 55 310 95
               C326 128 322 150 334 168
               C350 192 342 222 318 236
               C322 256 304 278 278 282
               C268 300 242 308 222 298
               C210 302 202 296 200 286
               Z"
            fill="url(#brainFill)"
            stroke="#c9ff3d"
            strokeWidth="1.6"
            opacity="0.92"
          />
          {/* giros — linhas onduladas de textura, não anatômicas, só sugerem dobras */}
          <g stroke="#8fe3c9" strokeWidth="1" fill="none" opacity="0.55">
            <path d="M108 92c14 10 10 26-2 30" />
            <path d="M96 130c16 4 20 20 8 30" />
            <path d="M92 178c14 6 16 22 4 30" />
            <path d="M120 232c12 6 12 20 2 26" />
          </g>
          <g stroke="#dff28c" strokeWidth="1" fill="none" opacity="0.55">
            <path d="M292 92c-14 10-10 26 2 30" />
            <path d="M304 130c-16 4-20 20-8 30" />
            <path d="M308 178c-14 6-16 22-4 30" />
            <path d="M280 232c-12 6-12 20-2 26" />
          </g>
          {/* sulco central */}
          <path d="M200 42v250" stroke="#0a0f0b" strokeWidth="3" opacity="0.6" />
          {/* tronco/cerebelo, sugerido */}
          <path
            d="M170 288c8 18 44 18 60 4"
            fill="none"
            stroke="#5ae1be"
            strokeWidth="1.6"
            opacity="0.7"
          />
        </g>
      </svg>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
