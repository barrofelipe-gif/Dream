"use client";

import Link from "next/link";
import { SECTORS, Sector } from "@/lib/sectors";
import { STATUS_STYLE, SectorStatus } from "@/lib/sectorStatus";

interface EmpresaHubProps {
  sectors: Sector[]; // já filtrado pelo acesso do usuário
  // Sem fonte de dado ligada ainda (ver README) — todo setor nasce "unknown".
  // O tipo já fica pronto pra receber status real assim que a Tray entrar.
  statusBySector?: Partial<Record<Sector, SectorStatus>>;
}

const RADIUS = 36; // % do container

export default function EmpresaHub({ sectors, statusBySector = {} }: EmpresaHubProps) {
  const nodes = sectors.map((value, i) => {
    const angle = -Math.PI / 2 + i * ((2 * Math.PI) / sectors.length);
    const x = 50 + RADIUS * Math.cos(angle);
    const y = 50 + RADIUS * Math.sin(angle);
    const meta = SECTORS.find((s) => s.value === value)!;
    const status = statusBySector[value] ?? "unknown";
    return { value, x, y, meta, status };
  });

  // Saúde geral = pior status entre os setores visíveis (mesma regra de
  // consolidação da spec: um 🔴 basta pro conjunto virar 🔴).
  const overall: SectorStatus = nodes.some((n) => n.status === "critical")
    ? "critical"
    : nodes.some((n) => n.status === "warning")
    ? "warning"
    : nodes.some((n) => n.status === "good")
    ? "good"
    : "unknown";

  return (
    <div className="rounded-2xl bg-[#15161a] p-6 sm:p-10">
      <div className="relative mx-auto aspect-square w-full max-w-xl">
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
          {nodes.map((n) => (
            <line
              key={n.value}
              x1={50}
              y1={50}
              x2={n.x}
              y2={n.y}
              stroke={STATUS_STYLE[n.status].hex}
              strokeOpacity={n.status === "unknown" ? 0.15 : 0.4}
              strokeWidth={0.4}
            />
          ))}
        </svg>

        {/* núcleo — saúde geral da empresa */}
        <div
          className="absolute flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border text-center sm:h-24 sm:w-24"
          style={{
            left: "50%",
            top: "50%",
            borderColor: STATUS_STYLE[overall].hex,
            boxShadow: `0 0 24px -4px ${STATUS_STYLE[overall].hex}`,
            background: "#1b1c21",
          }}
        >
          <span className="text-[11px] font-bold tracking-wide text-white">BFF</span>
          <span className="text-[9px] text-zinc-400">Fitness</span>
        </div>

        {nodes.map((n) => {
          const Icon = n.meta.icon;
          const style = STATUS_STYLE[n.status];
          return (
            <Link
              key={n.value}
              href={`/empresa/${n.value}`}
              className="group absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
              style={{ left: `${n.x}%`, top: `${n.y}%` }}
            >
              <span className="relative flex h-12 w-12 items-center justify-center rounded-full border-2 bg-[#1b1c21] transition-transform group-hover:scale-110 sm:h-14 sm:w-14"
                style={{ borderColor: style.hex }}
              >
                {n.status === "critical" && (
                  <span
                    className="sector-pulse-ring absolute inset-0 rounded-full"
                    style={{ border: `2px solid ${style.hex}` }}
                    aria-hidden
                  />
                )}
                <span style={{ color: style.hex }}>
                  <Icon className="h-5 w-5" />
                </span>
              </span>
              <span className="max-w-[6.5rem] text-center text-[11px] font-medium leading-tight text-zinc-300 group-hover:text-white">
                {n.meta.label}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 border-t border-white/10 pt-4">
        {(Object.entries(STATUS_STYLE) as [SectorStatus, (typeof STATUS_STYLE)[SectorStatus]][]).map(
          ([key, s]) => (
            <span key={key} className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span className="h-2 w-2 rounded-full" style={{ background: s.hex }} />
              {s.label}
            </span>
          )
        )}
      </div>
    </div>
  );
}
