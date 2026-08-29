import "server-only";
import { prisma } from "@/lib/prisma";
import { SECTORS, Sector } from "@/lib/sectors";

/** Admin vê tudo; membro só vê os setores liberados na SectorAccess. */
export async function getAccessibleSectors(userId: string, role: string): Promise<Sector[]> {
  if (role === "admin") return SECTORS.map((s) => s.value);

  const access = await prisma.sectorAccess.findMany({
    where: { userId },
    select: { sector: true },
  });
  return access.map((a) => a.sector as Sector);
}

export async function hasSectorAccess(userId: string, role: string, sector: Sector): Promise<boolean> {
  if (role === "admin") return true;
  const access = await prisma.sectorAccess.findUnique({
    where: { userId_sector: { userId, sector } },
  });
  return !!access;
}
