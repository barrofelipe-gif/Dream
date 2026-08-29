// Paleta de status (fixa, não temática) — mesma família usada no resto do
// app pra semáforo, validada pra contraste em fundo escuro.
export type SectorStatus = "good" | "warning" | "critical" | "unknown";

export const STATUS_STYLE: Record<SectorStatus, { label: string; hex: string }> = {
  good: { label: "Dentro do esperado", hex: "#0ca30c" },
  warning: { label: "Na borda do limite", hex: "#fab219" },
  critical: { label: "Precisa de atenção", hex: "#d03b3b" },
  unknown: { label: "Sem dados ainda", hex: "#71717a" },
};
