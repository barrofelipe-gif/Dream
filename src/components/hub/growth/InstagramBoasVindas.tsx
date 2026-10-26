"use client";

import { useCallback, useEffect, useState } from "react";

type Config = {
  ativo: boolean;
  mensagem: string;
  botao: string;
  pedirSeguir: boolean;
  textoSeguir: string;
  infoTexto: string;
  linkTitulo: string;
  linkUrl: string;
};

const LOJAS: [string, string][] = [
  ["bff", "BFF Fitness Atacado"],
  ["moranga", "Moranga Biquínis"],
];

function Toggle({ valor, onChange }: { valor: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!valor)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${valor ? "bg-[#6366f1]" : "bg-[#d5d8e0]"}`}
      aria-pressed={valor}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${valor ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

const campo =
  "w-full rounded-xl border border-[#e3e5ea] px-3 py-2.5 text-sm text-[#1b1f2b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/15";

export default function InstagramBoasVindas() {
  const [loja, setLoja] = useState("bff");
  const [cfg, setCfg] = useState<Config | null>(null);
  const [salvo, setSalvo] = useState(true);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [gerando, setGerando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async (l: string) => {
    setCfg(null);
    const r = await fetch(`/api/instagram/boas-vindas?loja=${l}`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      setCfg(j.config);
      setSalvo(j.salvo);
    }
  }, []);

  useEffect(() => {
    carregar(loja);
  }, [loja, carregar]);

  const set = <K extends keyof Config>(k: K, v: Config[K]) => {
    setCfg((c) => (c ? { ...c, [k]: v } : c));
    setMsg(null);
  };

  async function salvar() {
    if (!cfg) return;
    setSalvando(true);
    const r = await fetch("/api/instagram/boas-vindas", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loja, ...cfg }),
    });
    setSalvando(false);
    if (r.ok) {
      setSalvo(true);
      setMsg({ tipo: "ok", texto: "Salvo. A próxima pessoa que chamar já recebe esta versão." });
    } else {
      setMsg({ tipo: "erro", texto: ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Não foi possível salvar." });
    }
  }

  async function gerar() {
    setGerando(true);
    setMsg(null);
    const r = await fetch("/api/instagram/boas-vindas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loja }),
    });
    setGerando(false);
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      set("infoTexto", j.texto);
      setMsg({ tipo: "ok", texto: "Sugestão montada só com a base da loja. Leia, ajuste se quiser e clique em Salvar." });
    } else {
      setMsg({ tipo: "erro", texto: j.error ?? "Não foi possível gerar." });
    }
  }

  const exemplo = (t: string) => t.replaceAll("{nome}", "Maria");

  return (
    <section className="rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-[#1b1f2b]">Boas-vindas automáticas</p>
          <p className="text-xs text-[#8a8f9c]">
            Quando uma pessoa chama pela primeira vez, ela recebe esta mensagem com botões, é convidada a seguir a loja e recebe as informações para comprar.
          </p>
        </div>
        <div className="flex gap-1.5">
          {LOJAS.map(([v, r]) => (
            <button
              key={v}
              onClick={() => setLoja(v)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${loja === v ? "bg-[#1b1f2b] text-white" : "bg-[#eef0f4] text-[#5a5f6d] hover:bg-[#e3e5ea]"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {!cfg ? (
        <p className="py-8 text-center text-sm text-[#8a8f9c]">Carregando…</p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_300px]">
          {/* Formulário */}
          <div className="space-y-5">
            <div className="flex items-center justify-between rounded-xl bg-[#f7f8fa] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[#1b1f2b]">Automação ligada</p>
                <p className="text-[11px] text-[#8a8f9c]">{salvo ? "Usando a versão salva." : "Ainda usando o texto padrão (nunca foi salvo)."}</p>
              </div>
              <Toggle valor={cfg.ativo} onChange={(v) => set("ativo", v)} />
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#a1a5b0]">Eles receberão</p>
              <label className="mb-1 block text-sm font-medium text-[#1b1f2b]">Uma mensagem de boas-vindas</label>
              <textarea value={cfg.mensagem} onChange={(e) => set("mensagem", e.target.value)} rows={4} className={campo} />
              <p className="mt-1 text-[11px] text-[#a1a5b0]">Use {"{nome}"} para o primeiro nome da pessoa (se o Instagram não informar, o nome é omitido).</p>

              <label className="mb-1 mt-3 block text-sm font-medium text-[#1b1f2b]">Botão de resposta (opcional)</label>
              <input value={cfg.botao} maxLength={20} onChange={(e) => set("botao", e.target.value)} className={campo} />
              <p className="mt-1 text-[11px] text-[#a1a5b0]">Deixe vazio para mandar só a pergunta e esperar a resposta (recomendado). Se preencher, vai junto o botão &ldquo;Tenho uma dúvida&rdquo;.</p>
            </div>

            <div className="rounded-xl border border-[#e3e5ea] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[#1b1f2b]">Pedir para seguir a loja</p>
                  <p className="text-[11px] text-[#8a8f9c]">Só aparece para quem ainda não segue. Não bloqueia nada: a pessoa recebe as informações do mesmo jeito.</p>
                </div>
                <Toggle valor={cfg.pedirSeguir} onChange={(v) => set("pedirSeguir", v)} />
              </div>
              {cfg.pedirSeguir && (
                <textarea value={cfg.textoSeguir} onChange={(e) => set("textoSeguir", e.target.value)} rows={2} className={`${campo} mt-3`} />
              )}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#a1a5b0]">E então, ao tocar no botão, eles recebem</p>
              <label className="mb-1 block text-sm font-medium text-[#1b1f2b]">Uma DM com as informações para comprar</label>
              <textarea
                value={cfg.infoTexto}
                onChange={(e) => set("infoTexto", e.target.value)}
                rows={7}
                placeholder="Deixe vazio para o robô montar o texto na hora, só com as respostas da base da loja."
                className={campo}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button onClick={gerar} disabled={gerando} className="rounded-lg bg-[#eef0f4] px-3 py-1.5 text-xs font-medium text-[#1b1f2b] hover:bg-[#e3e5ea] disabled:opacity-50">
                  {gerando ? "Montando…" : "✨ Montar a partir da base"}
                </button>
                <span className="text-[11px] text-[#a1a5b0]">Texto com link: até 640 caracteres aparecem junto do botão.</span>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-[160px_1fr]">
                <input value={cfg.linkTitulo} maxLength={20} onChange={(e) => set("linkTitulo", e.target.value)} placeholder="Texto do botão" className={campo} />
                <input value={cfg.linkUrl} onChange={(e) => set("linkUrl", e.target.value)} placeholder="https://… (link do botão, opcional)" className={campo} />
              </div>
            </div>

            {msg && (
              <p className={`rounded-lg px-3 py-2 text-xs ${msg.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.texto}</p>
            )}
            <button onClick={salvar} disabled={salvando} className="rounded-xl bg-[#6366f1] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#4f52d9] disabled:opacity-50">
              {salvando ? "Salvando…" : "Salvar"}
            </button>
          </div>

          {/* Prévia do celular */}
          <div className="flex justify-center">
            <div className="w-[280px] rounded-[2.2rem] bg-[#0b0c10] p-3 shadow-xl">
              <div className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-[#2a2c35]" />
              <div className="rounded-[1.6rem] bg-[#12131a] p-3" style={{ minHeight: 470 }}>
                <p className="mb-2 text-center text-[10px] text-[#7d8190]">@{loja === "bff" ? "bfffitness_atacado" : "moranga_biquinis"}</p>
                <div className="space-y-2 text-[12px] leading-snug">
                  <div className="max-w-[88%] rounded-2xl bg-[#262833] px-3 py-2 text-[#e9eaf0]">
                    <p className="whitespace-pre-wrap">{exemplo(cfg.mensagem)}{cfg.pedirSeguir ? `\n\n${cfg.textoSeguir}` : ""}</p>
                  </div>
                  {cfg.botao.trim() ? (
                    <>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-[#6366f1] px-3 py-1 text-[11px] text-[#a5a8ff]">{cfg.botao || "Botão"}</span>
                    <span className="rounded-full border border-[#6366f1] px-3 py-1 text-[11px] text-[#a5a8ff]">Tenho uma dúvida</span>
                  </div>
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl bg-[#6366f1] px-3 py-2 text-white">{cfg.botao || "Botão"}</div>
                  </div>
                    </>
                  ) : (
                    <p className="pt-1 text-center text-[10px] text-[#7d8190]">…espera a resposta da pessoa…</p>
                  )}
                  <div className={`max-w-[88%] rounded-2xl bg-[#262833] px-3 py-2 text-[#e9eaf0] ${cfg.botao.trim() ? "" : "hidden"}`}>
                    <p className="whitespace-pre-wrap">
                      {cfg.infoTexto.trim() ? exemplo(cfg.infoTexto) : "As informações para comprar (pedido mínimo, pagamento, prazo…) montadas na hora a partir da base da loja."}
                    </p>
                    {cfg.linkUrl && (
                      <div className="mt-2 rounded-lg bg-[#343644] px-3 py-1.5 text-center text-[11px] font-medium">{cfg.linkTitulo || "Ver o site"}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
