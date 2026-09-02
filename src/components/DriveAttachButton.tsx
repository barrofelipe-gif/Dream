"use client";

import { useState } from "react";
import { IconPaperclip } from "@/components/icons";

export interface DriveAttachment {
  fileId: string;
  name: string;
  url: string;
}

// Tipagem mínima do que usamos da API global do Google Picker (carregada via script)
interface GooglePickerView {
  setIncludeFolders: (v: boolean) => GooglePickerView;
}
interface PickerResponse {
  action: string;
  docs?: { id: string; name: string; url: string }[];
}
interface GooglePickerBuilder {
  addView: (view: GooglePickerView) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setCallback: (cb: (data: PickerResponse) => void) => GooglePickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
}

declare global {
  interface Window {
    gapi?: { load: (mod: string, cb: () => void) => void };
    google?: {
      picker: {
        PickerBuilder: new () => GooglePickerBuilder;
        DocsView: new () => GooglePickerView;
        Action: { PICKED: string };
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

// Carrega o script do Picker uma única vez por sessão de navegador.
function loadPickerScript(): Promise<void> {
  if (typeof window !== "undefined" && window.google?.picker) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.onload = () => window.gapi?.load("picker", () => resolve());
    script.onerror = () => {
      scriptPromise = null; // permite tentar de novo depois de uma falha de rede
      reject(new Error("Falha ao carregar o Google Picker"));
    };
    document.body.appendChild(script);
  });

  return scriptPromise;
}

interface DriveAttachButtonProps {
  onAttach: (attachment: DriveAttachment) => void;
  disabled?: boolean;
}

export default function DriveAttachButton({ onAttach, disabled }: DriveAttachButtonProps) {
  const [loading, setLoading] = useState(false);

  async function openPicker() {
    setLoading(true);
    try {
      const res = await fetch("/api/drive/picker-token");
      const data = await res.json();

      if (!res.ok || !data.accessToken) {
        alert(
          data.error === "Nenhuma conta Google conectada"
            ? "Conecta uma conta Google primeiro (menu Conectar Gmail)."
            : "Não consegui abrir o seletor de arquivos do Drive."
        );
        return;
      }

      await loadPickerScript();
      const picker = window.google?.picker;
      if (!picker) throw new Error("Picker indisponível");

      const view = new picker.DocsView().setIncludeFolders(true);
      const builder = new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(data.accessToken)
        .setCallback((result: PickerResponse) => {
          if (result.action !== picker.Action.PICKED) return;
          const doc = result.docs?.[0];
          if (doc) onAttach({ fileId: doc.id, name: doc.name, url: doc.url });
        });

      // developerKey é opcional; sem ele o Picker ainda funciona pro próprio usuário
      if (data.apiKey) builder.setDeveloperKey(data.apiKey);

      builder.build().setVisible(true);
    } catch {
      alert("Não consegui abrir o seletor de arquivos do Drive.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={openPicker}
      disabled={disabled || loading}
      className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-60"
    >
      <IconPaperclip className="h-4 w-4" />
      {loading ? "Abrindo..." : "Anexar do Drive"}
    </button>
  );
}
