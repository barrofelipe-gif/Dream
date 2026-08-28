"use client";

import { useRef, useState } from "react";

// Tipagem mínima da Web Speech API (não faz parte do lib.dom padrão do TS)
interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface UseSpeechToTextOptions {
  // false (padrão): pára sozinho na primeira pausa — bom pra ditar um campo.
  // true: fica ouvindo até o usuário mandar parar, com prévia do que ainda
  // não foi confirmado — bom pra ditar a pendência inteira de uma vez.
  continuous?: boolean;
}

/**
 * Ditado por voz usando a Web Speech API nativa do navegador (Chrome/Edge —
 * grátis, sem chamada de API externa). Em navegadores sem suporte
 * (Firefox, Safari), `supported` fica false e quem usa o hook deve
 * esconder o próprio botão de microfone.
 */
export function useSpeechToText(onResult: (text: string) => void, opts: UseSpeechToTextOptions = {}) {
  // Componente só monta no cliente (dentro do modal, após interação), então
  // não há divergência de hidratação em calcular isso direto no useState.
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  function start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = "pt-BR";
    recognition.continuous = opts.continuous ?? false;
    recognition.interimResults = opts.continuous ?? false;

    recognition.onresult = (e) => {
      let finalChunk = "";
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) finalChunk += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (finalChunk.trim()) onResult(finalChunk.trim());
      setInterimText(interim);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => {
      setListening(false);
      setInterimText("");
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  function stop() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  return { supported, listening, interimText, start, stop };
}
