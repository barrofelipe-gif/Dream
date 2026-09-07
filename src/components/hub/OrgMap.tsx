"use client";

import { useEffect, useRef } from "react";
import { AREAS, type Area, type Papel } from "@/lib/orgCatalog";
import { ICON_PATHS } from "@/components/hub/Icon";
import { buildingSvg, officeSvg } from "@/lib/isoBuildings";

/**
 * Mapa mental — o núcleo do protótipo original (Infuser Skilltree):
 * departamentos orbitando um centro, conectados por linhas às suas
 * satélites (papéis), com prédio isométrico na visão geral e escritório na
 * área expandida. Portado quase 1:1 de `codigo_original/app.js`
 * (`build`/`layout`/`tick`/`enterDept`/`exitDept`), trocando `DEPTS` pelo
 * catálogo real (`AREAS`) e a navegação por hash falso (`history.replaceState`)
 * por navegação de verdade: clicar num papel expandido leva pra rota real
 * dele (`onOpenRole`), não abre mais um painel que desaparece ao recarregar.
 *
 * Mantido como manipulação direta de SVG (como o original), não JSX
 * re-renderizado a cada frame — é uma animação de 60fps com física de mola
 * (lerp/easing), o jeito do React de re-renderizar a árvore inteira a cada
 * frame seria muito mais lento e brigaria com a própria biblioteca.
 */

const NS = "http://www.w3.org/2000/svg";
function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag) as SVGElementTagNameMap[K];
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const COR = { teal: "#3ad0a8", lime: "#c9ff3d" };
const corDe = (a: Area) => (a.color === "lime" ? COR.lime : COR.teal);

function iconG(parent: SVGGElement, name: string, size: number, color: string) {
  const g = el("g", { transform: `translate(${-size / 2},${-size / 2}) scale(${size / 24})`, fill: "none", stroke: color, "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round" }, parent);
  g.innerHTML = ICON_PATHS[name] || ICON_PATHS.sparkle;
  return g;
}

interface HubNode {
  g: SVGGElement;
  halo: SVGCircleElement;
  ring: SVGCircleElement;
  ig: SVGGElement;
  lg: SVGGElement;
  lab: SVGTextElement;
  sub: SVGTextElement;
  x: number; y: number; tx: number; ty: number;
  lx: number; ly: number; tlx: number; tly: number;
  r: number; tr: number; ang: number;
  color: string;
}
interface ChildNode {
  g: SVGGElement;
  ring: SVGCircleElement;
  ig: SVGGElement;
  lab: SVGTextElement;
  x: number; y: number; tx: number; ty: number; r: number; tr: number;
  areaId: string;
}
interface EdgeNode {
  line: SVGLineElement;
  mid: SVGCircleElement;
}

export default function OrgMap({
  onOpenRole,
  onOpenArea,
}: {
  onOpenRole: (areaId: string, papelId: string) => void;
  onOpenArea: (areaId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const graphRef = useRef<SVGGElement>(null);
  const buildingRef = useRef<SVGSVGElement>(null);
  const officeRef = useRef<SVGSVGElement>(null);
  const watermarkRef = useRef<HTMLDivElement>(null);
  const backHintRef = useRef<HTMLDivElement>(null);
  const onOpenRoleRef = useRef(onOpenRole);
  const onOpenAreaRef = useRef(onOpenArea);
  onOpenRoleRef.current = onOpenRole;
  onOpenAreaRef.current = onOpenArea;

  useEffect(() => {
    const container = containerRef.current;
    const svg = svgRef.current;
    const graph = graphRef.current;
    const buildingEl = buildingRef.current;
    const officeEl = officeRef.current;
    const watermark = watermarkRef.current;
    const backHint = backHintRef.current;
    if (!container || !svg || !graph || !buildingEl || !officeEl || !watermark || !backHint) return;

    if (buildingEl.childElementCount === 0) buildingEl.innerHTML = buildingSvg();
    if (officeEl.childElementCount === 0) officeEl.innerHTML = officeSvg();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = container.clientWidth || 800;
    let H = container.clientHeight || 560;

    let mode: "overview" | "drill" = "overview";
    let activeArea: Area | null = null;
    let hoverId: string | null = null;
    let rot = 0;
    let T0 = performance.now();
    let raf = 0;
    let disposed = false;

    const nodes: Record<string, HubNode> = {};
    const children: Record<string, ChildNode> = {};
    const edges: Record<string, EdgeNode> = {};
    const flows: { dot: SVGCircleElement; roleId: string; t: number; v: number }[] = [];

    function build() {
      graph!.innerHTML = "";
      const edgesG = el("g", {}, graph!);
      const hubsG = el("g", {}, graph!);

      AREAS.forEach((area) => {
        const color = corDe(area);
        const eg = el("g", {}, edgesG);
        area.children.forEach((papel) => {
          const line = el("line", { stroke: color, "stroke-width": 0.7, "stroke-opacity": 0.5, "stroke-linecap": "round" }, eg);
          const mid = el("circle", { r: 1.4, fill: color, opacity: 0.9 }, eg);
          edges[papel.id] = { line, mid };
        });

        area.children.forEach((papel) => {
          const g = el("g", { style: "opacity:1;cursor:pointer" }, hubsG);
          const ring = el("circle", { r: 5, fill: "#0b100d", stroke: color, "stroke-width": 0.9 }, g);
          const ig = el("g", { opacity: 0 }, g);
          iconG(ig, papel.icon, 15, color);
          const lab = el("text", { y: -40, opacity: 0, "font-family": "inherit", "font-weight": 600, "font-size": 9.5, "letter-spacing": "0.32em", fill: "#dfe4dd", "text-anchor": "middle" }, g);
          lab.textContent = papel.label;
          g.addEventListener("mouseenter", () => {
            if (mode === "drill") ring.setAttribute("stroke", COR.lime);
          });
          g.addEventListener("mouseleave", () => ring.setAttribute("stroke", color));
          g.addEventListener("click", (e) => {
            e.stopPropagation();
            if (mode === "drill" && activeArea?.id === area.id) onOpenRoleRef.current(area.id, papel.id);
          });
          children[papel.id] = { g, ring, ig, lab, x: W / 2, y: H / 2, tx: W / 2, ty: H / 2, r: 5, tr: 5, areaId: area.id };
        });

        const g = el("g", { style: "cursor:pointer" }, hubsG);
        const halo = el("circle", { r: 18, fill: color, opacity: 0 }, g);
        const ring = el("circle", { r: 13, fill: "url(#hubFillMap)", stroke: color, "stroke-width": 1.1 }, g);
        const ig = el("g", {}, g);
        iconG(ig, area.icon, 13, color);
        const lg = el("g", {}, g);
        const lab = el("text", { "font-family": "inherit", "font-weight": 600, "font-size": 14, "letter-spacing": "0.36em", fill: "#e3e8e1", "text-anchor": "middle" }, lg);
        lab.textContent = area.name;
        const sub = el("text", { y: 14, "font-family": "monospace", "font-size": 6.5, "letter-spacing": "0.14em", fill: "#5f675e", "text-anchor": "middle" }, lg);
        sub.textContent = area.sub;
        g.addEventListener("mouseenter", () => {
          hoverId = area.id;
          lab.setAttribute("fill", color);
        });
        g.addEventListener("mouseleave", () => {
          hoverId = null;
          lab.setAttribute("fill", "#e3e8e1");
        });
        g.addEventListener("click", (e) => {
          e.stopPropagation();
          if (mode === "overview") enterDept(area);
          else if (mode === "drill" && activeArea?.id === area.id) onOpenAreaRef.current(area.id);
        });
        nodes[area.id] = { g, halo, ring, ig, lg, lab, sub, x: W / 2, y: H / 2, tx: W / 2, ty: H / 2, lx: 0, ly: 0, tlx: 0, tly: 0, r: 13, tr: 13, ang: 0, color };
      });
      layout(true);
    }

    function layout(snap: boolean) {
      if (!nodes[AREAS[0].id]) return;
      const cx = W / 2 + (mode === "overview" ? (W > 900 ? W * 0.06 : W * 0.03) : 0);
      const cy = H / 2 + (mode === "overview" ? (W > 900 ? H * 0.02 : -H * 0.055) : 0);

      if (mode === "overview") {
        const mob = W <= 900;
        const Rx = mob ? W * 0.33 : Math.min(W, H) * 0.27;
        const Ry = mob ? H * 0.25 : Rx;
        const LRx = mob ? Rx + W * 0.16 : Rx + Math.min(W, H) * 0.165;
        const LRy = mob ? Ry + H * 0.085 : LRx;
        AREAS.forEach((area, i) => {
          const a = rot + (i / AREAS.length) * Math.PI * 2 - Math.PI / 2;
          const n = nodes[area.id];
          n.tx = cx + Math.cos(a) * Rx;
          n.ty = cy + Math.sin(a) * Ry;
          n.tr = mob ? 11 : 13;
          n.ang = a;
          if (mob && Math.abs(Math.cos(a)) > 0.72) {
            n.tlx = Math.min(W - 80, Math.max(80, n.tx));
            n.tly = n.ty + (Math.sin(a) < 0 ? -52 : 56);
          } else {
            n.tlx = Math.min(W - (mob ? 70 : 90), Math.max(mob ? 70 : 90, cx + Math.cos(a) * LRx));
            n.tly = Math.min(H - (mob ? 90 : 40), Math.max(100, cy + Math.sin(a) * LRy));
          }
          const m = area.children.length,
            spread = Math.PI * 0.62;
          area.children.forEach((papel, j) => {
            const ca = a - spread / 2 + (m === 1 ? 0 : (spread * j) / (m - 1));
            const dist = mob ? 30 + (j % 2) * 8 : 48 + (j % 2) * 14;
            const c = children[papel.id];
            c.tx = n.tx + Math.cos(ca) * dist;
            c.ty = n.ty + Math.sin(ca) * dist;
            c.tr = mob ? 3 + (j % 2) : 4.5 + (j % 3);
          });
        });
      } else {
        AREAS.forEach((area) => {
          const n = nodes[area.id];
          if (activeArea && area.id === activeArea.id) {
            const mob = W <= 900;
            n.tx = cx;
            n.ty = mob ? cy + H * 0.2 : cy + Math.min(H, W) * 0.33;
            n.tr = mob ? 19 : 22;
            n.tlx = n.tx;
            n.tly = n.ty + (mob ? 46 : 52);
            const m = area.children.length,
              a0 = mob ? -Math.PI * 0.9 : -Math.PI * 0.86,
              a1 = mob ? -Math.PI * 0.1 : -Math.PI * 0.14,
              rad = mob ? Math.min(H * 0.36, W * 0.56) : Math.min(W, H) * 0.42;
            area.children.forEach((papel, j) => {
              const ca = m === 1 ? -Math.PI / 2 : a0 + (a1 - a0) * (j / (m - 1));
              const rr = rad * (j % 2 ? 1 : mob ? 0.66 : 0.86);
              const c = children[papel.id];
              c.tx = n.tx + Math.cos(ca) * rr;
              c.ty = n.ty + Math.sin(ca) * rr;
              c.tr = mob ? 16 : 20;
            });
          } else {
            const a = n.ang,
              R = Math.max(W, H) * 0.9;
            n.tx = cx + Math.cos(a) * R;
            n.ty = cy + Math.sin(a) * R;
            n.tr = 13;
            n.tlx = n.tx;
            n.tly = n.ty;
            area.children.forEach((papel) => {
              const c = children[papel.id];
              c.tx = n.tx;
              c.ty = n.ty;
              c.tr = 4;
            });
          }
        });
      }
      if (snap) {
        for (const k in nodes) {
          const n = nodes[k];
          n.x = n.tx; n.y = n.ty; n.r = n.tr; n.lx = n.tlx; n.ly = n.tly;
        }
        for (const k in children) {
          const c = children[k];
          c.x = c.tx; c.y = c.ty; c.r = c.tr;
        }
      }
    }

    function tick(t: number) {
      if (disposed) return;
      const dt = t - T0;
      T0 = t;
      if (container) {
        W = container.clientWidth || W;
        H = container.clientHeight || H;
      }
      if (mode === "overview" && !reduced) rot += dt * 0.000045;
      layout(false);
      const k = 1 - Math.pow(0.0009, dt / 1000);
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.0025);
      const drill = mode === "drill";

      for (const area of AREAS) {
        const n = nodes[area.id];
        n.x = lerp(n.x, n.tx, k); n.y = lerp(n.y, n.ty, k); n.r = lerp(n.r, n.tr, k);
        n.lx = lerp(n.lx, n.tlx, k); n.ly = lerp(n.ly, n.tly, k);
        n.g.setAttribute("transform", `translate(${n.x},${n.y})`);
        n.ring.setAttribute("r", String(n.r));
        n.ig.setAttribute("transform", `scale(${n.r / 14})`);
        n.halo.setAttribute("r", String(n.r * 1.6));
        n.halo.setAttribute("opacity", String((hoverId === area.id ? 0.12 : 0.035) + pulse * 0.02));
        n.lg.setAttribute("transform", `translate(${n.lx - n.x},${n.ly - n.y})`);
        const isActive = drill && activeArea?.id === area.id;
        const mob = W <= 900;
        n.lab.setAttribute("font-size", String(isActive ? (mob ? 17 : 20) : mob ? 9.5 : 14));
        n.lab.setAttribute("y", String(isActive ? 8 : 5));
        n.sub.setAttribute("y", String(isActive ? 26 : 19));
        n.sub.setAttribute("font-size", String(isActive ? (mob ? 7 : 8) : 6.5));
        n.sub.setAttribute("opacity", mob && !isActive ? "0" : "1");
        const vis = !drill || isActive;
        n.g.style.opacity = vis ? "1" : "0";
        n.g.style.pointerEvents = vis ? "auto" : "none";

        area.children.forEach((papel: Papel) => {
          const c = children[papel.id];
          c.x = lerp(c.x, c.tx, k); c.y = lerp(c.y, c.ty, k); c.r = lerp(c.r, c.tr, k);
          c.g.setAttribute("transform", `translate(${c.x},${c.y})`);
          c.ring.setAttribute("r", String(c.r));
          const big = drill ? Math.min(1, Math.max(0, (c.r - 5) / (W <= 900 ? 11 : 15))) : 0;
          c.ig.setAttribute("opacity", String(big));
          c.ig.setAttribute("transform", `scale(${0.6 + 0.4 * big})`);
          c.lab.setAttribute("opacity", String(big));
          c.ring.setAttribute("fill", big > 0 ? `rgba(22,58,50,${0.25 + 0.45 * big})` : "#0b100d");
          c.lab.setAttribute("y", String(-c.r - 14));
          c.g.style.opacity = vis ? "1" : "0";
          c.g.style.pointerEvents = vis && drill ? "auto" : "none";

          const e = edges[papel.id];
          e.line.setAttribute("x1", String(n.x)); e.line.setAttribute("y1", String(n.y));
          e.line.setAttribute("x2", String(c.x)); e.line.setAttribute("y2", String(c.y));
          e.line.setAttribute("stroke", isActive ? "#8a938b" : n.color);
          e.line.setAttribute("stroke-width", String(isActive ? 1.2 : 0.7));
          e.line.setAttribute("stroke-opacity", String(vis ? (isActive ? 0.55 : 0.45) : 0));
          const mx = lerp(n.x, c.x, 0.5), my = lerp(n.y, c.y, 0.5);
          e.mid.setAttribute("cx", String(mx)); e.mid.setAttribute("cy", String(my));
          e.mid.setAttribute("r", String(isActive ? 2.2 : 1.3));
          e.mid.setAttribute("opacity", String(vis ? 0.9 : 0));
          e.mid.setAttribute("fill", n.color);
        });
      }

      if (drill && activeArea) {
        if (flows.length < activeArea.children.length * 2 && Math.random() < 0.08) {
          const papel = activeArea.children[Math.floor(Math.random() * activeArea.children.length)];
          const dot = el("circle", { r: 1.8, fill: corDe(activeArea) }, graph!);
          flows.push({ dot, roleId: papel.id, t: 0, v: 0.0035 + Math.random() * 0.003 });
        }
        for (let i = flows.length - 1; i >= 0; i--) {
          const f = flows[i];
          f.t += (f.v * dt) / 16;
          const n = nodes[activeArea.id], c = children[f.roleId];
          if (f.t >= 1 || !c) { f.dot.remove(); flows.splice(i, 1); continue; }
          f.dot.setAttribute("cx", String(lerp(n.x, c.x, f.t)));
          f.dot.setAttribute("cy", String(lerp(n.y, c.y, f.t)));
          f.dot.setAttribute("opacity", String(Math.sin(f.t * Math.PI)));
        }
      } else if (flows.length) {
        flows.forEach((f) => f.dot.remove());
        flows.length = 0;
      }

      raf = requestAnimationFrame(tick);
    }

    function enterDept(area: Area) {
      mode = "drill";
      activeArea = area;
      watermark!.textContent = area.name;
      watermark!.style.opacity = "1";
      buildingEl!.style.opacity = "0";
      buildingEl!.style.transform = "translateY(-50%) translateX(-30px)";
      officeEl!.style.opacity = "1";
      officeEl!.style.transform = "translateY(-50%)";
      backHint!.style.opacity = "1";
      backHint!.style.pointerEvents = "auto";
    }
    function exitDept() {
      mode = "overview";
      activeArea = null;
      watermark!.style.opacity = "0";
      buildingEl!.style.opacity = "1";
      buildingEl!.style.transform = "translateY(-50%)";
      officeEl!.style.opacity = "0";
      officeEl!.style.transform = "translateY(-50%) translateX(-30px)";
      backHint!.style.opacity = "0";
      backHint!.style.pointerEvents = "none";
    }

    function onBgClick() {
      if (mode === "drill") exitDept();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && mode === "drill") exitDept();
    }
    svg.addEventListener("click", onBgClick);
    window.addEventListener("keydown", onKeyDown);

    const ro = new ResizeObserver(() => {
      W = container.clientWidth || W;
      H = container.clientHeight || H;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      layout(false);
    });
    ro.observe(container);

    build();
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    raf = requestAnimationFrame((t) => {
      T0 = t;
      tick(t);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      svg.removeEventListener("click", onBgClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative h-[min(72vh,720px)] min-h-[420px] w-full overflow-hidden rounded-2xl border border-[#1c221d] bg-[#050705]">
      <svg
        ref={buildingRef}
        viewBox="0 0 360 620"
        className="pointer-events-none absolute left-[1.5%] top-1/2 w-[min(24vw,240px)] -translate-y-1/2 transition-all duration-500"
        aria-hidden
      />
      <svg
        ref={officeRef}
        viewBox="0 0 400 340"
        className="pointer-events-none absolute left-0 top-1/2 w-[min(30vw,300px)] -translate-y-1/2 opacity-0 transition-all duration-500"
        aria-hidden
      />
      <div
        ref={watermarkRef}
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[56%] select-none whitespace-nowrap text-[min(16vw,160px)] font-extrabold uppercase leading-none tracking-wide opacity-0 transition-opacity duration-500"
        style={{ color: "rgba(120,170,140,.07)" }}
        aria-hidden
      />
      <svg ref={svgRef} className="absolute inset-0 h-full w-full cursor-pointer">
        <defs>
          <radialGradient id="hubFillMap">
            <stop offset="0" stopColor="#0f1a15" />
            <stop offset="1" stopColor="#070907" />
          </radialGradient>
        </defs>
        <g ref={graphRef} />
      </svg>
      <div
        ref={backHintRef}
        className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#8b9389] opacity-0 transition-opacity duration-300"
      >
        <kbd className="rounded border border-[#2a322c] px-1.5 py-0.5">Esc</kbd> voltar ao mapa
      </div>
    </div>
  );
}
