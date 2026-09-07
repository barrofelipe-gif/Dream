"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Atalho de teclado da home: Enter leva pro login, igual clicar no botão. */
export default function EnterKeyShortcut({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter" && !e.repeat) {
        const alvo = e.target as HTMLElement | null;
        if (alvo && ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName)) return;
        router.push(href);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [href, router]);

  return null;
}
