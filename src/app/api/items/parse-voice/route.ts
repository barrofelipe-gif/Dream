import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { parseVoiceDraft } from "@/lib/anthropic";

const input = z.object({ transcript: z.string().trim().min(1) });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY não configurada — adicione no .env pra usar o ditado inteligente." },
      { status: 501 }
    );
  }

  const parsed = input.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Transcrição vazia" }, { status: 400 });

  try {
    const draft = await parseVoiceDraft(parsed.data.transcript);
    return NextResponse.json(draft);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
