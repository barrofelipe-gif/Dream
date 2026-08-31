import "server-only";
import { prisma } from "@/lib/prisma";
import { Sector } from "@/lib/sectors";
import { SectorStatus } from "@/lib/sectorStatus";

export interface SectorMetricDTO {
  blockKey: string;
  label: string;
  status: SectorStatus;
  value: string | null;
  note: string | null;
  updatedAt: string | null;
}

export async function getSectorMetrics(sector: Sector): Promise<Record<string, SectorMetricDTO>> {
  const rows = await prisma.sectorMetric.findMany({ where: { sector } });
  const out: Record<string, SectorMetricDTO> = {};
  for (const r of rows) {
    out[r.blockKey] = {
      blockKey: r.blockKey,
      label: r.label,
      status: r.status,
      value: r.value,
      note: r.note,
      updatedAt: r.updatedAt.toISOString(),
    };
  }
  return out;
}

/** Pior status entre os blocos preenchidos do setor — mesma regra do núcleo do hub. */
function worstStatus(statuses: SectorStatus[]): SectorStatus {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warning")) return "warning";
  if (statuses.includes("good")) return "good";
  return "unknown";
}

/** Status consolidado por setor, pra alimentar o núcleo/nós do EmpresaHub. */
export async function getStatusBySector(sectors: Sector[]): Promise<Partial<Record<Sector, SectorStatus>>> {
  if (sectors.length === 0) return {};
  const rows = await prisma.sectorMetric.findMany({
    where: { sector: { in: sectors } },
    select: { sector: true, status: true },
  });
  const bySector: Partial<Record<Sector, SectorStatus[]>> = {};
  for (const r of rows) {
    const list = bySector[r.sector as Sector] ?? [];
    list.push(r.status);
    bySector[r.sector as Sector] = list;
  }
  const out: Partial<Record<Sector, SectorStatus>> = {};
  for (const sector of sectors) {
    const list = bySector[sector];
    if (list && list.length > 0) out[sector] = worstStatus(list);
  }
  return out;
}

export async function upsertSectorMetric(input: {
  sector: Sector;
  blockKey: string;
  label: string;
  status: SectorStatus;
  value?: string | null;
  note?: string | null;
  updatedById: string;
}) {
  return prisma.sectorMetric.upsert({
    where: { sector_blockKey: { sector: input.sector, blockKey: input.blockKey } },
    create: {
      sector: input.sector,
      blockKey: input.blockKey,
      label: input.label,
      status: input.status,
      value: input.value ?? null,
      note: input.note ?? null,
      updatedById: input.updatedById,
    },
    update: {
      label: input.label,
      status: input.status,
      value: input.value ?? null,
      note: input.note ?? null,
      updatedById: input.updatedById,
    },
  });
}
