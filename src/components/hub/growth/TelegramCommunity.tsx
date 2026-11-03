"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export default function TelegramCommunity({ selection }: { selection?: { id: number; accountId: number; request: number } }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1500);
  const [frameUnavailable, setFrameUnavailable] = useState(false);
  const selectSource = useCallback(() => {
    if (selection)
      frame.current?.contentWindow?.postMessage(
        { type: "bff-telegram-source", ...selection },
        window.location.origin,
      );
  }, [selection]);
  useEffect(() => { selectSource(); }, [selectSource]);
  useEffect(() => {
    function resize(event: MessageEvent) {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      if (
        event.data?.type === "bff-telegram-dialog" &&
        typeof event.data.top === "number"
      ) {
        window.scrollTo({
          top:
            window.scrollY +
            frame.current!.getBoundingClientRect().top +
            event.data.top -
            100,
          behavior: "smooth",
        });
        return;
      }
      if (
        event.data?.type !== "bff-telegram-height" ||
        typeof event.data.height !== "number"
      )
        return;
      setHeight(Math.max(700, Math.min(12000, event.data.height)));
      setFrameUnavailable(false);
    }
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, []);
  return (
    <div className="mt-5 min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[#294c75]">Conta, canal e participantes</h2>
        <a href="/api/telegram/painel" target="_blank" rel="noopener noreferrer"
          className="rounded-lg border border-[#d5deea] bg-white px-4 py-2 text-sm font-semibold text-[#2563eb]">
          Abrir painel em nova aba ↗
        </a>
      </div>
      {frameUnavailable && (
        <p role="status" className="rounded-xl border border-[#d5deea] bg-white p-5 text-sm text-[#536780]">
          Use o botão acima para acessar a configuração do canal e a lista de participantes.
        </p>
      )}
      <iframe
        ref={frame}
        title="Telegram BFF — conexão e comunidade privada"
        src="/api/telegram/painel"
        onLoad={() => {
          setFrameUnavailable(!frame.current?.contentDocument?.getElementById("connection-title"));
          selectSource();
        }}
        hidden={frameUnavailable}
        className="w-full rounded-xl border border-[#e3e5ea] bg-[#f3f6fa]"
        style={{ height }}
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

