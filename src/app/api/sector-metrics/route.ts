import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { hasSectorAccess } from "@/lib/permissions";
import { getSectorMetrics, upsertSectorMetric } from "@/lib/sectorMetrics";
import { SECTORS, Sector } from "@/lib/sectors";

const SECTOR_VALUES = SECTORS.map((s) => s.value) as [string, ...string[]];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const sector = req.nextUrl.searchParams.get("sector") as Sector | null;
  if (!sector || !SECTORS.some((s) => s.value === sector)) {
    return NextResponse.json({ error: "Setor inválido" }, { status: 400 });
  }

  const allowed = await hasSectorAccess(session.user.id, session.user.role, sector);
  if (!allowed) return NextResponse.json({ error: "Sem acesso a esse setor" }, { status: 403 });

  const metrics = await getSectorMetrics(sector);
  return NextResponse.json({ metrics });
}

const patchSchema = z.object({
  sector: z.enum(SECTOR_VALUES),
  blockKey: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(["good", "warning", "critical", "unknown"]),
  value: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const allowed = await hasSectorAccess(session.user.id, session.user.role, parsed.data.sector as Sector);
  if (!allowed) return NextResponse.json({ error: "Sem acesso a esse setor" }, { status: 403 });

  const metric = await upsertSectorMetric({
    ...parsed.data,
    sector: parsed.data.sector as Sector,
    updatedById: session.user.id,
  });
  return NextResponse.json({ metric });
}
