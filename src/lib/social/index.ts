import { adaptador as instagram } from "@/lib/social/instagram";
import { adaptador as facebook } from "@/lib/social/facebook";
import { adaptador as tiktok } from "@/lib/social/tiktok";
import { adaptador as youtube } from "@/lib/social/youtube";
import { adaptador as pinterest } from "@/lib/social/pinterest";
import type { Rede, RedeAdapter } from "@/lib/social/types";

/** Todas as redes do publicador. Cada arquivo de rede exporta `adaptador`; aqui só se junta. */
export const ADAPTADORES: Record<Rede, RedeAdapter> = { instagram, facebook, tiktok, youtube, pinterest };

export function adaptadorDe(rede: string): RedeAdapter | null {
  return (ADAPTADORES as Record<string, RedeAdapter>)[rede] ?? null;
}
