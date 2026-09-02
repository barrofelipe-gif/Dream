"use client";

import { useState } from "react";
import { useSpeechToText } from "@/lib/useSpeechToText";
import { useAudioTranscription } from "@/lib/useAudioTranscription";
import { VoiceDraft } from "@/lib/types";
import { IconClose, IconMic } from "@/components/icons";

interface VoiceCaptureModalProps {
  onClose: () => void;
  onDraftReady: (draft: VoiceDraft) => void;
}

export default function VoiceCaptureModal({ onClose, onDraftReady }: VoiceCaptureModalProps) {
  const [transcript, setTranscript] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appendChunk = (chunk: string) =>
    setTranscript((prev) => [prev, chunk].filter(Boolean).join(" "));

  // Ditado nativo do navegador (Chrome/Edge): grátis e com prévia ao vivo.
  const speech = useSpeechToText(appendChunk, { continuous: true });
  // Fallback pros demais navegadores/celular: grava e transcreve com Whisper.
  const audio = useAudioTranscription(appendChunk);

  const useWhisper = !speech.supported;
  const supported = speech.supported || audio.supported;
  const listening = useWhisper ? audio.recording : speech.listening;
  const interimText = useWhisper ? "" : speech.interimText;
  const start = useWhisper ? audio.start : speech.start;
  const stop = useWhisper ? audio.stop : speech.stop;

  async function handleUseText() {
    if (!transcript.trim()) return;
    if (listening) stop();
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/items/parse-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: transcript.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao organizar o áudio");
      onDraftReady(data as VoiceDraft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não deu pra organizar esse áudio.");
    } finally {
      setParsing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-900">Ditar pendência</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
          >
            <IconClose />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {!supported ? (
            <p className="text-sm text-zinc-500">
              Seu navegador não tem microfone disponível pra ditado. Tenta no Chrome, Edge ou
              Safari.
            </p>
          ) : (
            <>
              <p className="text-sm text-zinc-500">
                Fala o que precisa fazer — categoria, prazo, prioridade, empresa. Depois eu organizo
                tudo nos campos certos pra você revisar.
              </p>

              <div className="flex flex-col items-center gap-3 py-2">
                <button
                  type="button"
                  onClick={() => (listening ? stop() : start())}
                  className={`flex h-16 w-16 items-center justify-center rounded-full transition-colors ${
                    listening ? "animate-pulse bg-rose-500 text-white" : "bg-indigo-600 text-white hover:bg-indigo-700"
                  }`}
                >
                  <IconMic className="h-7 w-7" />
                </button>
                <span className="text-xs text-zinc-400">
                  {audio.transcribing
                    ? "Transcrevendo o áudio..."
                    : listening
                    ? useWhisper
                      ? "Gravando... toca de novo pra transcrever"
                      : "Ouvindo... toca de novo pra parar"
                    : "Toca pra falar"}
                </span>
              </div>

              <div>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  rows={3}
                  placeholder="A transcrição aparece aqui — pode editar pra corrigir antes de usar."
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                />
                {interimText && <p className="mt-1 text-xs text-zinc-400">Ouvindo: {interimText}</p>}
              </div>

              {(error || audio.error) && (
                <p className="text-sm text-rose-600">{error ?? audio.error}</p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleUseText}
            disabled={!transcript.trim() || parsing || audio.transcribing}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {parsing ? "Organizando..." : "Usar esse texto"}
          </button>
        </div>
      </div>
    </div>
  );
}
