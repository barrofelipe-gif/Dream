"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export default function TelegramCommunity({ selection }: { selection?: { id: number; accountId: number; request: number } }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1500);
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
    }
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, []);
  return (
    <div className="mt-5 min-w-0">
      <iframe
        ref={frame}
        title="Telegram BFF — conexão e comunidade privada"
        src="/api/telegram/painel"
        onLoad={selectSource}
        className="w-full rounded-xl border border-[#e3e5ea] bg-[#f3f6fa]"
        style={{ height }}
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

