/**
 * Ilustrações isométricas (prédio / escritório) do mapa mental — portadas
 * quase literalmente do protótipo original (`app.js`, seção "PRÉDIO E
 * ESCRITÓRIO"). São funções puras que devolvem uma string de SVG (polígonos
 * desenhados à mão em projeção isométrica), a mesma técnica do original —
 * só traduzida de IIFE-com-DOM pra função que devolve markup, pra poder
 * injetar via dangerouslySetInnerHTML dentro de um componente React.
 */

type P3 = (x: number, y: number, z: number) => [number, number];

function makeIso(ox: number, oy: number): P3 {
  const c30 = 0.92,
    s30 = 0.24;
  return (x, y, z) => [ox + (x - y) * c30, oy + (x + y) * s30 - z];
}

function pts(a: [number, number][]): string {
  return a.map((p) => p.join(",")).join(" ");
}

interface FloorOpts {
  cols?: number;
  rows?: number;
  screens?: number;
}

function floor(P: P3, X: number, Y: number, z0: number, hF: number, opts: FloorOpts = {}): string {
  const ov = 3;
  let s = "";
  const th = 4;
  const top: [number, number][] = [P(-ov, -ov, z0), P(X + ov, -ov, z0), P(X + ov, Y + ov, z0), P(-ov, Y + ov, z0)];
  const fr: [number, number][] = [
    P(-ov, Y + ov, z0),
    P(X + ov, Y + ov, z0),
    P(X + ov, Y + ov, z0 - th),
    P(-ov, Y + ov, z0 - th),
  ];
  const fl: [number, number][] = [
    P(X + ov, -ov, z0),
    P(X + ov, Y + ov, z0),
    P(X + ov, Y + ov, z0 - th),
    P(X + ov, -ov, z0 - th),
  ];
  const wallL: [number, number][] = [P(0, 0, z0), P(0, Y, z0), P(0, Y, z0 + hF), P(0, 0, z0 + hF)];
  const wallR: [number, number][] = [P(0, 0, z0), P(X, 0, z0), P(X, 0, z0 + hF), P(0, 0, z0 + hF)];
  s += `<polygon points="${pts(fr)}" fill="#151a16"/><polygon points="${pts(fl)}" fill="#0d110e"/><polygon points="${pts(top)}" fill="#1c221d" stroke="#2b332c" stroke-width=".5"/>`;
  s += `<polygon points="${pts(wallL)}" fill="#0c100d"/><polygon points="${pts(wallR)}" fill="#090c0a"/>`;
  s += `<polygon points="${pts([P(0, 0, z0), P(X, 0, z0), P(X, Y, z0), P(0, Y, z0)])}" fill="url(#gFloorWarm)"/>`;

  const nScr = opts.screens ?? 3;
  for (let i = 0; i < nScr; i++) {
    const y0 = 6 + i * ((Y - 12) / nScr),
      y1 = y0 + (Y - 12) / nScr - 5;
    s += `<polygon points="${pts([P(0, y0, z0 + 9), P(0, y1, z0 + 9), P(0, y1, z0 + hF - 7), P(0, y0, z0 + hF - 7)])}" fill="#0f2416" stroke="#1f4a2b" stroke-width=".5"/>`;
    for (let k = 0; k < 3; k++) {
      const yy = y0 + 2 + k * ((y1 - y0 - 4) / 3);
      const a = P(0, yy, z0 + hF - 11 - k * 5);
      const b = P(0, yy + (y1 - y0) * (0.35 + 0.3 * Math.random()), z0 + hF - 11 - k * 5);
      s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#9fe23a" stroke-width=".9" opacity=".8"/>`;
    }
  }
  s += `<polygon points="${pts([P(X * 0.7, 0, z0 + 11), P(X * 0.9, 0, z0 + 11), P(X * 0.9, 0, z0 + hF - 9), P(X * 0.7, 0, z0 + hF - 9)])}" fill="#f3e2b0" opacity=".75"/>`;

  const lc = P(X * 0.5, Y * 0.5, z0 + hF * 0.55);
  s += `<ellipse cx="${lc[0]}" cy="${lc[1]}" rx="${X * 0.7}" ry="${hF * 0.6}" fill="url(#gLamp)" opacity=".85"/>`;

  const cols = opts.cols ?? 3,
    rows = opts.rows ?? 2;
  for (let r = 0; r < rows; r++)
    for (let ci = 0; ci < cols; ci++) {
      const dx = 10 + ci * ((X - 14) / cols),
        dy = 12 + r * ((Y - 16) / rows),
        w = (X - 14) / cols - 8,
        d = (Y - 16) / rows - 8,
        hd = 6;
      const dt: [number, number][] = [P(dx, dy, z0 + hd), P(dx + w, dy, z0 + hd), P(dx + w, dy + d, z0 + hd), P(dx, dy + d, z0 + hd)];
      s += `<polygon points="${pts(dt)}" fill="#3a3324"/>`;
      s += `<polygon points="${pts([P(dx, dy + d, z0 + hd), P(dx + w, dy + d, z0 + hd), P(dx + w, dy + d, z0), P(dx, dy + d, z0)])}" fill="#221d14"/>`;
      s += `<polygon points="${pts([P(dx + w, dy, z0 + hd), P(dx + w, dy + d, z0 + hd), P(dx + w, dy + d, z0), P(dx + w, dy, z0)])}" fill="#1a160f"/>`;
      for (let m = 0; m < 2; m++) {
        const mx = dx + 3 + m * (w / 2),
          my = dy + 3;
        const mon: [number, number][] = [
          P(mx, my, z0 + hd + 1),
          P(mx + 4.5, my, z0 + hd + 1),
          P(mx + 4.5, my, z0 + hd + 4.5),
          P(mx, my, z0 + hd + 4.5),
        ];
        s += `<polygon points="${pts(mon)}" fill="${m % 2 ? "#8fe6cf" : "#d9ff6a"}" opacity=".7"/>`;
      }
      const chair = P(dx + w * 0.5, dy + d + 4, z0 + 3);
      s += `<circle cx="${chair[0]}" cy="${chair[1]}" r="1.6" fill="#2a2620"/>`;
    }

  const pl = P(X - 6, Y - 6, z0 + 8);
  s += `<circle cx="${pl[0]}" cy="${pl[1]}" r="3.2" fill="#2f7a3d"/><circle cx="${pl[0] - 1.5}" cy="${pl[1] - 1.5}" r="2" fill="#3f9a4c"/>`;

  s += `<polygon points="${pts([P(0, Y, z0), P(X, Y, z0), P(X, Y, z0 + hF), P(0, Y, z0 + hF)])}" fill="rgba(120,200,190,.05)" stroke="rgba(160,220,200,.16)" stroke-width=".5"/>`;
  s += `<polygon points="${pts([P(X, 0, z0), P(X, Y, z0), P(X, Y, z0 + hF), P(X, 0, z0 + hF)])}" fill="rgba(120,200,190,.04)" stroke="rgba(160,220,200,.14)" stroke-width=".5"/>`;

  const q1 = P(-ov, Y + ov, z0),
    q2 = P(-ov, Y + ov, z0 - th);
  s += `<line x1="${q1[0]}" y1="${q1[1]}" x2="${q2[0]}" y2="${q2[1]}" stroke="#c9ff3d" stroke-width="1.4" filter="url(#glow)"/>`;
  const e1 = P(-ov, Y + ov, z0 - th),
    e2 = P(X * 0.35, Y + ov, z0 - th);
  s += `<line x1="${e1[0]}" y1="${e1[1]}" x2="${e2[0]}" y2="${e2[1]}" stroke="#c9ff3d" stroke-width=".8" opacity=".7"/>`;
  return s;
}

const DEFS = `<defs>
  <radialGradient id="gLamp"><stop offset="0" stop-color="#ffd27a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
  <linearGradient id="gFloorWarm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2416"/><stop offset="1" stop-color="#12100a"/></linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter>
</defs>`;

function brainGlyph(P: P3, x: number, y: number, z: number, axis: "x" | "y"): string {
  const w = 26,
    h = 22;
  const q: [number, number][] =
    axis === "x"
      ? [P(x, y, z), P(x + w, y, z), P(x + w, y, z + h), P(x, y, z + h)]
      : [P(x, y, z), P(x, y + w, z), P(x, y + w, z + h), P(x, y, z + h)];
  const cx = (q[0][0] + q[2][0]) / 2,
    cy = (q[0][1] + q[2][1]) / 2;
  const sk = axis === "x" ? "skewY(-30)" : "skewY(30)";
  return `<polygon points="${pts(q)}" fill="#070907" stroke="#1f261f" stroke-width=".6"/>
    <g transform="translate(${cx},${cy}) ${sk} scale(1.35)" fill="none" stroke="#c9ff3d" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)" style="transform-box:fill-box">
      <path d="M-2.5 -9a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5.5A3 3 0 0 0-6 6a3 3 0 0 0 3.5 3 3 3 0 0 0 3-3V-6a3 3 0 0 0-3-3z"/><path d="M2.5 -9a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5.5A3 3 0 0 1 6 6a3 3 0 0 1-3.5 3 3 3 0 0 1-3-3V-6a3 3 0 0 1 3-3z"/>
    </g>`;
}

/** SVG (viewBox "0 0 360 620") do prédio — visão geral do mapa. */
export function buildingSvg(): string {
  const X = 104,
    Y = 70,
    hF = 38,
    N = 7;
  const P = makeIso(122, 378);
  let s = DEFS + '<g transform="scale(1.5)">';
  s += `<ellipse cx="122" cy="392" rx="110" ry="14" fill="#c9ff3d" opacity=".10" filter="url(#soft)"/>`;
  const base = (ov: number, z: number, th: number, fill: string) => {
    const t: [number, number][] = [P(-ov, -ov, z), P(X + ov, -ov, z), P(X + ov, Y + ov, z), P(-ov, Y + ov, z)];
    return `<polygon points="${pts([t[3], t[2], P(X + ov, Y + ov, z - th), P(-ov, Y + ov, z - th)])}" fill="#0f130f"/><polygon points="${pts([t[1], t[2], P(X + ov, Y + ov, z - th), P(X + ov, -ov, z - th)])}" fill="#0a0d0a"/><polygon points="${pts(t)}" fill="${fill}" stroke="#2a312b" stroke-width=".5" stroke-linejoin="round"/>
      <polyline points="${pts([P(-ov, Y + ov, z - th), P(X + ov, Y + ov, z - th), P(X + ov, -ov, z - th)])}" fill="none" stroke="#c9ff3d" stroke-width=".9" stroke-linejoin="round" opacity=".85" filter="url(#glow)"/>`;
  };
  s += base(13, 4, 6, "#161b17");
  s += base(7, 11, 7, "#131814");
  for (let k = 0; k < N; k++) s += floor(P, X, Y, 14 + k * (hF + 4), hF, { cols: 3, rows: 2, screens: 3 });
  const zt = 14 + N * (hF + 4),
    ov = 3;
  s += `<polygon points="${pts([P(-ov, Y + ov, zt), P(X + ov, Y + ov, zt), P(X + ov, Y + ov, zt - 4), P(-ov, Y + ov, zt - 4)])}" fill="#151a16"/><polygon points="${pts([P(X + ov, -ov, zt), P(X + ov, Y + ov, zt), P(X + ov, Y + ov, zt - 4), P(X + ov, -ov, zt - 4)])}" fill="#0d110e"/><polygon points="${pts([P(-ov, -ov, zt), P(X + ov, -ov, zt), P(X + ov, Y + ov, zt), P(-ov, Y + ov, zt)])}" fill="#1c221d" stroke="#2b332c" stroke-width=".5"/>`;
  const bx = X * 0.5 - 16,
    by = Y * 0.5 - 16,
    bw = 32,
    bh = 28;
  s += `<polygon points="${pts([P(bx, by + bw, zt), P(bx + bw, by + bw, zt), P(bx + bw, by + bw, zt + bh), P(bx, by + bw, zt + bh)])}" fill="#0b0f0c" stroke="#232a24" stroke-width=".5"/>`;
  s += `<polygon points="${pts([P(bx + bw, by, zt), P(bx + bw, by + bw, zt), P(bx + bw, by + bw, zt + bh), P(bx + bw, by, zt + bh)])}" fill="#070907" stroke="#232a24" stroke-width=".5"/>`;
  s += `<polygon points="${pts([P(bx, by, zt + bh), P(bx + bw, by, zt + bh), P(bx + bw, by + bw, zt + bh), P(bx, by + bw, zt + bh)])}" fill="#161c17"/>`;
  s += brainGlyph(P, bx + 1, by + bw, zt + 1, "x");
  s += brainGlyph(P, bx + bw, by + 1, zt + 1, "y");
  return s + "</g>";
}

/** SVG (viewBox "0 0 400 340") do escritório — visão de uma área expandida. */
export function officeSvg(): string {
  const X = 170,
    Y = 130,
    hF = 62;
  const P = makeIso(205, 196);
  let s = DEFS.replace(/id="/g, 'id="o').replace(/url\(#/g, "url(#o");
  s += '<g transform="scale(1)">';
  s += `<ellipse cx="205" cy="284" rx="160" ry="18" fill="#c9ff3d" opacity=".12" filter="url(#osoft)"/>`;
  const ov = 14,
    z = 0,
    th = 9;
  const t: [number, number][] = [P(-ov, -ov, z), P(X + ov, -ov, z), P(X + ov, Y + ov, z), P(-ov, Y + ov, z)];
  s += `<polygon points="${pts([t[3], t[2], P(X + ov, Y + ov, z - th), P(-ov, Y + ov, z - th)])}" fill="#0f130f"/><polygon points="${pts([t[1], t[2], P(X + ov, Y + ov, z - th), P(X + ov, -ov, z - th)])}" fill="#0a0d0a"/><polygon points="${pts(t)}" fill="#171c18" stroke="#2a312b" stroke-width=".5"/>
    <polyline points="${pts([P(-ov, Y + ov, z - th), P(X + ov, Y + ov, z - th), P(X + ov, -ov, z - th)])}" fill="none" stroke="#c9ff3d" stroke-width="1.4" stroke-linejoin="round" filter="url(#oglow)"/>`;
  s += floor(P, X, Y, 6, hF, { cols: 3, rows: 3, screens: 4 })
    .replace(/url\(#(?!o)/g, "url(#o")
    .replace(/filter="url\(#glow\)"/g, 'filter="url(#oglow)"');
  s += `<polygon points="${pts([P(-3, -3, 6 + hF), P(X + 3, -3, 6 + hF), P(X + 3, Y + 3, 6 + hF), P(-3, Y + 3, 6 + hF)])}" fill="rgba(140,210,200,.05)" stroke="rgba(180,230,215,.25)" stroke-width=".7"/>`;
  ([
    [0, 0],
    [X, 0],
    [0, Y],
    [X, Y],
  ] as [number, number][]).forEach(([x, y]) => {
    const a = P(x, y, 6),
      b = P(x, y, 6 + hF);
    s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#3a423b" stroke-width=".8"/>`;
  });
  return s + "</g>";
}
