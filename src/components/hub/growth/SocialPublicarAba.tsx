"use client";

import { useState } from "react";
import SocialPublicador from "@/components/hub/growth/SocialPublicador";
import SocialMapa from "@/components/hub/growth/SocialMapa";

/** Aba Redes › Publicar: o publicador e o mapa de publicação lado a lado, trocando por botão, sem sair da tela. */
export default function SocialPublicarAba() {
  const [vista, setVista] = useState<"publicar" | "mapa">("publicar");
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-[#e3e5ea] bg-white p-1" role="tablist" aria-label="Publicar">
        {(
          [
            ["publicar", "Nova postagem"],
            ["mapa", "Mapa de publicação"],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={vista === id}
            onClick={() => setVista(id)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${vista === id ? "bg-[#1b1f2b] text-white" : "text-[#6b7280] hover:text-[#1b1f2b]"}`}
          >
            {rotulo}
          </button>
        ))}
      </div>
      {/* O publicador fica montado (escondido) para não perder o que já foi escrito ao olhar o mapa. */}
      <div hidden={vista !== "publicar"}>
        <SocialPublicador abrirMapa={() => setVista("mapa")} />
      </div>
      {vista === "mapa" && <SocialMapa />}
    </div>
  );
}
