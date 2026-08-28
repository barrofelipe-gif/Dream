"use client";

import { useSpeechToText } from "@/lib/useSpeechToText";
import { IconMic } from "@/components/icons";

interface MicButtonProps {
  onResult: (text: string) => void;
  label: string; // ex: "Ditar título" — pra leitor de tela
}

export default function MicButton({ onResult, label }: MicButtonProps) {
  const { supported, listening, start, stop } = useSpeechToText(onResult);

  if (!supported) return null;

  return (
    <button
      type="button"
      title={listening ? "Parar ditado" : label}
      aria-label={listening ? "Parar ditado" : label}
      onClick={() => (listening ? stop() : start())}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
        listening
          ? "animate-pulse bg-rose-500 text-white"
          : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
      }`}
    >
      <IconMic className="h-4 w-4" />
    </button>
  );
}
