import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { auth } from "@/auth";

/**
 * Transcreve um áudio gravado no navegador (Whisper da OpenAI).
 *
 * Existe pro ditado funcionar em qualquer navegador/celular — a Web Speech
 * API nativa (usada em src/lib/useSpeechToText.ts) só existe no Chrome/Edge
 * no desktop. Aqui o navegador só grava o áudio e manda; quem transcreve é
 * a API. Devolve texto puro: quem organiza nos campos continua sendo
 * /api/items/parse-voice (Claude).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Transcrição por áudio não configurada (falta OPENAI_API_KEY)." },
      { status: 501 }
    );
  }

  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "Áudio ausente" }, { status: 400 });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: "whisper-1",
      language: "pt",
    });

    return NextResponse.json({ text: transcription.text });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao transcrever o áudio";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
