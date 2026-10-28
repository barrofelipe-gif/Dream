"use client";

import { useCallback, useEffect, useState } from "react";
import { lojaDoNavegador } from "@/lib/igLojaCliente";

const LOJAS: [string, string][] = [
  ["bff", "BFF Fitness Atacado"],
  ["moranga", "Moranga Biquínis"],
];

const campo =
  "w-full rounded-xl border border-[#e3e5ea] px-3 py-2.5 text-sm text-[#1b1f2b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/15";

export default function InstagramMenu() {
  // Empresa escolhida no topo do painel (o seletor de lá recarrega a página).
  const [loja] = useState(lojaDoNavegador);
  const [iniciadores, setIniciadores] = useState<string | null>(null);
  const [menu, setMenu] = useState("");
  const [salvo, setSalvo] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const carregar = useCallback(async (l: string) => {
    setIniciadores(null);
    setMsg(null);
    const r = await fetch(`/api/instagram/menu?loja=${l}`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      setIniciadores(j.iniciadores);
      setMenu(j.menu);
      setSalvo(j.salvo);
    }
  }, []);
  useEffect(() => {
    carregar(loja);
  }, [loja, carregar]);

  async function publicar() {
    setSalvando(true);
    setMsg(null);
    const r = await fetch("/api/instagram/menu", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loja, iniciadores, menu }),
    });
    setSalvando(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg({ tipo: "erro", texto: j.error ?? "Não foi possível publicar." });
      return;
    }
    const resultados: string[] = j.resultados ?? [];
    const falhou = resultados.filter((x) => x.includes("erro"));
    setSalvo(true);
    setMsg(
      falhou.length
        ? { tipo: "erro", texto: `Salvo, mas o Instagram recusou: ${falhou.join(" · ")}` }
        : { tipo: "ok", texto: resultados.length ? "Publicado no Instagram. Pode levar alguns minutos para aparecer no app." : "Salvo. Conecte a conta dessa loja para publicar." },
    );
  }

  const perguntas = (iniciadores ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 4);
  const itensMenu = menu.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 5);

  return (
    <section className="rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-[#1b1f2b]">Iniciadores de conversa e menu principal</p>
          <p className="text-xs text-[#8a8f9c]">
            Botões que o cliente vê ao abrir o chat da loja e o menu (ícone de hambúrguer) dentro do direct. Ao tocar, o robô responde como se a pessoa tivesse digitado.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[#eef0f4] px-3 py-1 text-xs font-medium text-[#1b1f2b]">{LOJAS.find(([v]) => v === loja)?.[1]}</span>
      </div>

      {iniciadores === null ? (
        <p className="py-8 text-center text-sm text-[#8a8f9c]">Carregando…</p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-5">
            <div>
              <label className="mb-1 block text-sm font-semibold text-[#1b1f2b]">Iniciadores de conversa (até 4)</label>
              <textarea value={iniciadores} onChange={(e) => { setIniciadores(e.target.value); setMsg(null); setSalvo(false); }} rows={5} className={campo} placeholder={"Qual o pedido mínimo?\nComo faço para pagar?"} />
              <p className="mt-1 text-[11px] text-[#a1a5b0]">Uma pergunta por linha, até 80 caracteres. Aparecem como botões quando a pessoa abre o chat pela primeira vez.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-[#1b1f2b]">Menu principal (até 5 itens)</label>
              <textarea value={menu} onChange={(e) => { setMenu(e.target.value); setMsg(null); setSalvo(false); }} rows={5} className={campo} placeholder={"Baixar o app | https://link\nRastrear meu pedido"} />
              <p className="mt-1 text-[11px] text-[#a1a5b0]">
                Uma linha por item. Com link: <code>Título | https://…</code>. Sem link: só o título, e o robô responde como se a pessoa tivesse escrito aquilo.
              </p>
            </div>
            {msg && <p className={`rounded-lg px-3 py-2 text-xs ${msg.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.texto}</p>}
            <div className="flex items-center gap-3">
              <button onClick={publicar} disabled={salvando} className="rounded-xl bg-[#6366f1] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#4f52d9] disabled:opacity-50">
                {salvando ? "Publicando…" : "Salvar e publicar no Instagram"}
              </button>
              {!salvo && <span className="text-[11px] text-amber-700">Alterações ainda não publicadas</span>}
            </div>
          </div>

          <div className="flex justify-center">
            <div className="w-[260px] rounded-[2.2rem] bg-[#0b0c10] p-3 shadow-xl">
              <div className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-[#2a2c35]" />
              <div className="flex flex-col rounded-[1.6rem] bg-[#12131a] p-3" style={{ minHeight: 420 }}>
                <p className="text-center text-[10px] uppercase tracking-wide text-[#7d8190]">Chat da loja</p>
                <div className="mt-auto space-y-1.5">
                  {perguntas.map((p) => (
                    <div key={p} className="rounded-full border border-[#3a3c48] px-3 py-1.5 text-center text-[11px] text-[#e9eaf0]">{p}</div>
                  ))}
                  <div className="flex items-center gap-2 pt-2">
                    <span className="text-lg text-[#7d8190]">☰</span>
                    <div className="flex-1 rounded-full bg-[#1d1f28] px-3 py-1.5 text-[10px] text-[#7d8190]">Mensagem…</div>
                  </div>
                  {itensMenu.length > 0 && (
                    <div className="rounded-xl bg-[#1d1f28] p-2 text-[11px] text-[#e9eaf0]">
                      <p className="mb-1 text-[9px] uppercase tracking-wide text-[#7d8190]">Menu</p>
                      {itensMenu.map((i) => (
                        <p key={i} className="border-t border-[#2a2c35] py-1">{i.split("|")[0].trim()}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
