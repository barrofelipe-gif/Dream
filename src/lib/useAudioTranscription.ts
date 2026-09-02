"use client";

import { useRef, useState } from "react";

/**
 * Gravação de áudio pelo MediaRecorder + transcrição no servidor (Whisper).
 *
 * Diferente de useSpeechToText (Web Speech API), funciona em qualquer
 * navegador com microfone — inclusive celular, Safari e Firefox. Em troca,
 * não tem prévia ao vivo: o texto chega quando a gravação termina.
 */
export function useAudioTranscription(onText: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const supported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // libera o microfone assim que para de gravar (tira o indicador do navegador)
        stream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size === 0) return;

        setTranscribing(true);
        try {
          const body = new FormData();
          body.append("audio", blob, "audio.webm");
          const res = await fetch("/api/items/transcribe", { method: "POST", body });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Falha ao transcrever");
          if (data.text?.trim()) onText(data.text.trim());
        } catch (e) {
          setError(e instanceof Error ? e.message : "Não deu pra transcrever o áudio.");
        } finally {
          setTranscribing(false);
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError("Não consegui acessar o microfone. Confere a permissão do navegador.");
    }
  }

  function stop() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  return { supported, recording, transcribing, error, start, stop };
}
