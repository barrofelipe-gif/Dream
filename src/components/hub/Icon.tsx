/**
 * Biblioteca de ícones do hub — os mesmos traços lineares do protótipo
 * original (Infuser Skilltree), portados 1:1 do `ICONS` de app.js. Manter
 * essa mesma linguagem visual em vez de trocar por outro pacote de ícones é
 * o que faz o hub/áreas parecerem continuação do cérebro, não uma tela nova.
 */

export const ICON_PATHS: Record<string, string> = {
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3 14.4a2 2 0 0 1 2.9-2.8L8 14"/>',
  brain: '<path d="M9.5 3a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5.5A3 3 0 0 0 6 18a3 3 0 0 0 3.5 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3z"/><path d="M14.5 3a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5.5A3 3 0 0 1 18 18a3 3 0 0 1-3.5 3 3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.1 10a6 6 0 1 1-8 8M7 6h1v4M16.7 13.7l.7.7-2.8 2.8"/>',
  scale: '<path d="M12 3v18M3 21h18M6 7l-3 7a4 4 0 0 0 6 0L6 7zM18 7l-3 7a4 4 0 0 0 6 0l-3-7zM6 7h12"/>',
  sparkle: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9zM19 3v3M20.5 4.5h-3M5 17v3M6.5 18.5h-3"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  rocket:
    '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8-.8-.7-2-.7-2.8 0zM12 15l-3-3 3-6c2-3 6-3 9-3 0 3 0 7-3 9l-6 3z"/><path d="M9 12H5l2-3M12 15v4l3-2"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v9"/>',
  headset:
    '<path d="M3 14v-3a9 9 0 0 1 18 0v3"/><path d="M21 15a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h3zM3 15a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2H3z"/>',
  bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 12 5a5.5 5.5 0 0 0-10 3.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
  layers: '<path d="M12 2l10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  server: '<rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/><path d="M6 6.5h.01M6 17.5h.01"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
  check: '<path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  receipt:
    '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 2V2l-3 2-3-2-3 2-3-2-3 2zM8 8h8M8 12h8M8 16h5"/>',
  calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h8"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8"/>',
  percent: '<path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  umbrella: '<path d="M22 12a10 10 0 0 0-20 0zM12 12v8a2 2 0 0 0 4 0M12 2v1"/>',
  gavel:
    '<path d="m14 13-7.5 7.5a2.1 2.1 0 1 1-3-3L11 10M16 16l6-6M8 8l6-6M9 7l8 8M21 11l-8-8"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  pen: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
  handshake:
    '<path d="m11 17 2 2a1 1 0 1 0 3-3M14 14l2.5 2.5a1 1 0 1 0 3-3l-3.9-3.9a5 5 0 0 0-7 0L8 10M3 8l3-3 4 4M21 8l-3-3-4 4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  mega: '<path d="m3 11 18-5v12L3 14v-3zM11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/>',
  ad: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 16l2.5-8 2.5 8M9 13h3M16 8v8"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
};

export type IconName = keyof typeof ICON_PATHS;

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const d = ICON_PATHS[name] ?? ICON_PATHS.sparkle;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}
