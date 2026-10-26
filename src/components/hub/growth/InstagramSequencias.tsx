"use client";

import { useCallback, useEffect, useState } from "react";

type Conta = { id: string; username: string; loja: string };
type Passo = { atrasoMinutos: number; texto: string };
type Sequencia = {
  id: string;
  accountId: string;
  nome: string;
  ativa: boolean;
  passos: Passo[];
  pararSeResponder: boolean;
  etiquetaAoEntrar: string | null;
  etiquetaAoConcluir: string | null;
  createdAt: string;
  account: { username: string | null; loja: string };
  contagem: { ativos: number; concluidos: number; parados: number };
};
type Unidade = "min" | "h" | "d";
type PassoEditor = { valor: number; unidade: Unidade; texto: string };
type Rascunho = {
  id: string | null;
  accountId: string;
  nome: string;
  passos: PassoEditor[];
  pararSeResponder: boolean;
  etiquetaAoEntrar: string;
  etiquetaAoConcluir: string;
};

const campo =
  "w-full rounded-xl border border-[#e3e5ea] px-3 py-2.5 text-sm text-[#1b1f2b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/15";
const SUGESTOES = ["Comprador", "Pediu humano", "Sem dúvida informada", "Não atendido", "Quer comprar", "Resolvido pelo robô", "Pedido atrasado"];
const FATOR: Record<Unidade, number> = { min: 1, h: 60, d: 1440 };
const NOME_UNIDADE: Record<Unidade, [string, string]> = { min: ["minuto", "minutos"], h: ["hora", "horas"], d: ["dia", "dias"] };

const paraEditor = (p: Passo): PassoEditor => {
  const m = p.atrasoMinutos;
  const unidade: Unidade = m > 0 && m % 1440 === 0 ? "d" : m > 0 && m % 60 === 0 ? "h" : "min";
  return { valor: m / FATOR[unidade], unidade, texto: p.texto };
};
const paraMinutos = (p: PassoEditor) => Math.max(0, Math.round((Number(p.valor) || 0) * FATOR[p.unidade]));
const descreverAtraso = (min: number, primeiro: boolean) => {
  if (min === 0) return primeiro ? "Na hora da inscrição" : "Logo depois da anterior";
  const { valor, unidade } = paraEditor({ atrasoMinutos: min, texto: "" });
  const nome = NOME_UNIDADE[unidade][valor === 1 ? 0 : 1];
  return `${valor} ${nome} depois ${primeiro ? "da inscrição" : "da anterior"}`;
};
const vazio = (accountId: string): Rascunho => ({
  id: null,
  accountId,
  nome: "",
  passos: [
    { valor: 0, unidade: "min", texto: "" },
    { valor: 1, unidade: "d", texto: "" },
  ],
  pararSeResponder: true,
  etiquetaAoEntrar: "",
  etiquetaAoConcluir: "",
});

function EditorTags({ rotulo, valor, onChange, cor }: { rotulo: string; valor: string[]; onChange: (v: string[]) => void; cor: string }) {
  const [novo, setNovo] = useState("");
  const adicionar = (t: string) => {
    const x = t.trim();
    if (x && !valor.includes(x)) onChange([...valor, x]);
    setNovo("");
  };
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-[#5a5f6d]">{rotulo}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {valor.map((t) => (
          <span key={t} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cor}`}>
            {t}
            <button onClick={() => onChange(valor.filter((v) => v !== t))} className="opacity-60 hover:opacity-100">
              ×
            </button>
          </span>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            adicionar(novo);
          }}
        >
          <input
            list="tags-sequencia"
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            onBlur={() => novo && adicionar(novo)}
            placeholder="+ etiqueta"
            className="w-32 rounded-full border border-dashed border-[#d5d8e0] bg-transparent px-2.5 py-0.5 text-[11px] outline-none focus:border-[#6366f1]"
          />
        </form>
      </div>
    </div>
  );
}

function Inscrever({ seq, onFeito }: { seq: Sequencia; onFeito: () => void }) {
  const [incluir, setIncluir] = useState<string[]>([]);
  const [excluir, setExcluir] = useState<string[]>(["Comprador"]);
  const [reiniciar, setReiniciar] = useState(false);
  const [previa, setPrevia] = useState<{ total: number; novos: number; jaInscritos: number; exemplos: string[] } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  useEffect(() => {
    setPrevia(null);
    const t = setTimeout(async () => {
      const r = await fetch(`/api/instagram/sequencias/${seq.id}/inscrever`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previa: true, incluirTags: incluir, excluirTags: excluir, reiniciar }),
      });
      if (r.ok) setPrevia(await r.json());
    }, 400);
    return () => clearTimeout(t);
  }, [seq.id, incluir, excluir, reiniciar]);

  async function inscrever() {
    if (!previa || previa.novos === 0) return;
    if (!window.confirm(`Colocar ${previa.novos} pessoa${previa.novos > 1 ? "s" : ""} na sequência "${seq.nome}"?`)) return;
    setEnviando(true);
    setMsg(null);
    const r = await fetch(`/api/instagram/sequencias/${seq.id}/inscrever`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incluirTags: incluir, excluirTags: excluir, reiniciar }),
    });
    const j = await r.json().catch(() => ({}));
    setEnviando(false);
    if (r.ok) {
      setMsg({ tipo: "ok", texto: `${j.inscritos} pessoa${j.inscritos !== 1 ? "s" : ""} inscrita${j.inscritos !== 1 ? "s" : ""}${j.ignorados ? ` · ${j.ignorados} já estavam` : ""}.` });
      onFeito();
    } else setMsg({ tipo: "erro", texto: j.error ?? "Não foi possível inscrever" });
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl bg-[#f7f8fa] p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <EditorTags rotulo="Inscrever quem tem (qualquer uma). Vazio = todos" valor={incluir} onChange={setIncluir} cor="bg-emerald-100 text-emerald-700" />
        <EditorTags rotulo="Não inscrever quem tem" valor={excluir} onChange={setExcluir} cor="bg-red-100 text-red-700" />
      </div>
      <label className="flex items-center gap-2 text-xs text-[#5a5f6d]">
        <input type="checkbox" checked={reiniciar} onChange={(e) => setReiniciar(e.target.checked)} />
        Recomeçar quem já concluiu ou parou esta sequência
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-[#5a5f6d]">
          {previa === null
            ? "Calculando…"
            : previa.total === 0
              ? "Ninguém nesse filtro está na janela de 24h."
              : `${previa.novos} pessoa${previa.novos !== 1 ? "s" : ""} entraria${previa.novos !== 1 ? "m" : ""}${previa.jaInscritos ? ` · ${previa.jaInscritos} já passaram por ela` : ""}`}
          {previa && previa.exemplos.length > 0 && <span className="text-[#a1a5b0]"> · {previa.exemplos.join(", ")}…</span>}
        </span>
        <button
          onClick={inscrever}
          disabled={enviando || !previa || previa.novos === 0}
          className="rounded-lg bg-[#1b1f2b] px-4 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-40"
        >
          {enviando ? "Inscrevendo…" : "Inscrever"}
        </button>
      </div>
      {!seq.ativa && <p className="text-xs text-amber-700">A sequência está desativada: os inscritos só recebem quando você ativar.</p>}
      {msg && <p className={`text-xs ${msg.tipo === "ok" ? "text-emerald-700" : "text-red-600"}`}>{msg.texto}</p>}
    </div>
  );
}

export default function InstagramSequencias() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [lista, setLista] = useState<Sequencia[]>([]);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [inscrevendo, setInscrevendo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/instagram/sequencias", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    setContas(j.contas);
    setLista(j.sequencias);
  }, []);
  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 15000);
    return () => clearInterval(t);
  }, [carregar]);

  const editar = (s: Sequencia) => {
    setMsg(null);
    setInscrevendo(null);
    setRascunho({
      id: s.id,
      accountId: s.accountId,
      nome: s.nome,
      passos: s.passos.map(paraEditor),
      pararSeResponder: s.pararSeResponder,
      etiquetaAoEntrar: s.etiquetaAoEntrar ?? "",
      etiquetaAoConcluir: s.etiquetaAoConcluir ?? "",
    });
  };
  const mudarPasso = (i: number, p: Partial<PassoEditor>) =>
    setRascunho((r) => (r ? { ...r, passos: r.passos.map((x, j) => (j === i ? { ...x, ...p } : x)) } : r));
  const moverPasso = (i: number, d: -1 | 1) =>
    setRascunho((r) => {
      if (!r || i + d < 0 || i + d >= r.passos.length) return r;
      const passos = [...r.passos];
      [passos[i], passos[i + d]] = [passos[i + d], passos[i]];
      return { ...r, passos };
    });

  async function salvar() {
    if (!rascunho) return;
    const passos = rascunho.passos.filter((p) => p.texto.trim()).map((p) => ({ atrasoMinutos: paraMinutos(p), texto: p.texto.trim() }));
    if (!rascunho.nome.trim() || passos.length === 0) {
      setMsg({ tipo: "erro", texto: "Dê um nome e escreva pelo menos uma mensagem." });
      return;
    }
    setSalvando(true);
    setMsg(null);
    const corpo = {
      nome: rascunho.nome,
      passos,
      pararSeResponder: rascunho.pararSeResponder,
      etiquetaAoEntrar: rascunho.etiquetaAoEntrar,
      etiquetaAoConcluir: rascunho.etiquetaAoConcluir,
    };
    const r = rascunho.id
      ? await fetch(`/api/instagram/sequencias/${rascunho.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) })
      : await fetch("/api/instagram/sequencias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...corpo, accountId: rascunho.accountId }) });
    const j = await r.json().catch(() => ({}));
    setSalvando(false);
    if (r.ok) {
      setMsg({ tipo: "ok", texto: rascunho.id ? "Sequência salva." : "Sequência criada. Agora inscreva as pessoas." });
      setRascunho(null);
      carregar();
    } else setMsg({ tipo: "erro", texto: j.error ?? "Não foi possível salvar" });
  }

  async function alternar(s: Sequencia) {
    await fetch(`/api/instagram/sequencias/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativa: !s.ativa }) });
    carregar();
  }

  async function apagar(s: Sequencia) {
    if (!window.confirm(`Apagar a sequência "${s.nome}"? Quem está nela para de receber.`)) return;
    await fetch(`/api/instagram/sequencias/${s.id}`, { method: "DELETE" });
    if (rascunho?.id === s.id) setRascunho(null);
    carregar();
  }

  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[#a1a5b0]">Sequências (mensagens com intervalo)</p>
        {!rascunho && contas.length > 0 && (
          <button
            onClick={() => {
              setMsg(null);
              setInscrevendo(null);
              setRascunho(vazio(contas[0].id));
            }}
            className="rounded-lg bg-[#1b1f2b] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black"
          >
            + Nova sequência
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-[#8a8f9c]">
        Uma série de mensagens com espera entre elas (ex.: na hora, depois de 1 dia, depois de 3 dias). O Instagram só deixa enviar até 24 horas depois da última mensagem da pessoa:
        se um passo cair fora dessa janela, a pessoa sai da sequência sem receber nada.
      </p>
      <datalist id="tags-sequencia">
        {SUGESTOES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      {rascunho && (
        <div className="mb-3 space-y-3 rounded-2xl border border-[#e3e5ea] p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              value={rascunho.accountId}
              onChange={(e) => setRascunho({ ...rascunho, accountId: e.target.value })}
              disabled={!!rascunho.id}
              className={`${campo} disabled:bg-[#f7f8fa]`}
            >
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  @{c.username} ({c.loja})
                </option>
              ))}
            </select>
            <input value={rascunho.nome} onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })} placeholder="Nome da sequência (só para você)" className={campo} maxLength={60} />
          </div>

          <div className="space-y-2">
            {rascunho.passos.map((p, i) => (
              <div key={i} className="rounded-xl border border-[#e3e5ea] p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[#5a5f6d]">
                  <span className="font-semibold text-[#1b1f2b]">Mensagem {i + 1}</span>
                  <span>·</span>
                  <span>esperar</span>
                  <input
                    type="number"
                    min={0}
                    value={p.valor}
                    onChange={(e) => mudarPasso(i, { valor: Number(e.target.value) })}
                    className="w-16 rounded-lg border border-[#e3e5ea] px-2 py-1 text-xs outline-none focus:border-[#6366f1]"
                  />
                  <select
                    value={p.unidade}
                    onChange={(e) => mudarPasso(i, { unidade: e.target.value as Unidade })}
                    className="rounded-lg border border-[#e3e5ea] px-2 py-1 text-xs outline-none focus:border-[#6366f1]"
                  >
                    <option value="min">minutos</option>
                    <option value="h">horas</option>
                    <option value="d">dias</option>
                  </select>
                  <span>{i === 0 ? "depois da inscrição" : "depois da anterior"}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <button onClick={() => moverPasso(i, -1)} disabled={i === 0} className="text-[#8a8f9c] hover:text-[#1b1f2b] disabled:opacity-30">
                      ↑
                    </button>
                    <button onClick={() => moverPasso(i, 1)} disabled={i === rascunho.passos.length - 1} className="text-[#8a8f9c] hover:text-[#1b1f2b] disabled:opacity-30">
                      ↓
                    </button>
                    <button
                      onClick={() => setRascunho({ ...rascunho, passos: rascunho.passos.filter((_, j) => j !== i) })}
                      disabled={rascunho.passos.length === 1}
                      className="text-red-600 hover:underline disabled:opacity-30"
                    >
                      Remover
                    </button>
                  </span>
                </div>
                {paraMinutos(p) > 24 * 60 && <p className="mb-2 text-[11px] text-amber-700">Mais de 24h de espera: só chega se a pessoa tiver mandado mensagem nesse meio-tempo.</p>}
                <textarea
                  value={p.texto}
                  onChange={(e) => mudarPasso(i, { texto: e.target.value })}
                  rows={3}
                  maxLength={900}
                  placeholder="Mensagem. Use {nome} para o primeiro nome da pessoa."
                  className={campo}
                />
              </div>
            ))}
            {rascunho.passos.length < 20 && (
              <button
                onClick={() => setRascunho({ ...rascunho, passos: [...rascunho.passos, { valor: 1, unidade: "d", texto: "" }] })}
                className="w-full rounded-xl border border-dashed border-[#d5d8e0] py-2 text-xs font-medium text-[#5a5f6d] hover:border-[#6366f1] hover:text-[#6366f1]"
              >
                + Adicionar mensagem
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-[#5a5f6d]">Etiqueta ao entrar (opcional)</p>
              <input list="tags-sequencia" value={rascunho.etiquetaAoEntrar} onChange={(e) => setRascunho({ ...rascunho, etiquetaAoEntrar: e.target.value })} maxLength={40} className={campo} />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-[#5a5f6d]">Etiqueta ao concluir (opcional)</p>
              <input list="tags-sequencia" value={rascunho.etiquetaAoConcluir} onChange={(e) => setRascunho({ ...rascunho, etiquetaAoConcluir: e.target.value })} maxLength={40} className={campo} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-[#5a5f6d]">
            <input type="checkbox" checked={rascunho.pararSeResponder} onChange={(e) => setRascunho({ ...rascunho, pararSeResponder: e.target.checked })} />
            Parar a sequência quando a pessoa responder
          </label>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setRascunho(null)} className="rounded-lg px-4 py-2 text-xs font-medium text-[#5a5f6d] hover:bg-[#f7f8fa]">
              Cancelar
            </button>
            <button onClick={salvar} disabled={salvando} className="rounded-lg bg-[#1b1f2b] px-4 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-40">
              {salvando ? "Salvando…" : rascunho.id ? "Salvar alterações" : "Criar sequência"}
            </button>
          </div>
        </div>
      )}
      {msg && <p className={`mb-3 text-xs ${msg.tipo === "ok" ? "text-emerald-700" : "text-red-600"}`}>{msg.texto}</p>}

      {lista.length === 0 && !rascunho && <p className="rounded-xl border border-dashed border-[#e3e5ea] p-4 text-center text-xs text-[#8a8f9c]">Nenhuma sequência ainda.</p>}
      <div className="space-y-2">
        {lista.map((s) => (
          <div key={s.id} className="rounded-xl border border-[#e3e5ea] p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-medium text-[#1b1f2b]">
                {s.nome}
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.ativa ? "bg-emerald-100 text-emerald-700" : "bg-[#eef0f4] text-[#8a8f9c]"}`}>
                  {s.ativa ? "ativa" : "desativada"}
                </span>
              </span>
              <span className="text-[11px] text-[#8a8f9c]">
                @{s.account.username} · {s.passos.length} mensage{s.passos.length !== 1 ? "ns" : "m"}
              </span>
            </div>
            <ol className="mt-2 space-y-1">
              {s.passos.map((p, i) => (
                <li key={i} className="text-xs text-[#5a5f6d]">
                  <span className="text-[#a1a5b0]">{descreverAtraso(p.atrasoMinutos, i === 0)}:</span> <span className="line-clamp-1 inline">{p.texto}</span>
                </li>
              ))}
            </ol>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded-full bg-[#6366f1]/10 px-2.5 py-0.5 font-medium text-[#6366f1]">{s.contagem.ativos} ativos</span>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-medium text-emerald-700">{s.contagem.concluidos} concluídos</span>
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-medium text-amber-700">{s.contagem.parados} parados</span>
              {s.pararSeResponder && <span className="text-[#a1a5b0]">· para se a pessoa responder</span>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
              <button onClick={() => setInscrevendo(inscrevendo === s.id ? null : s.id)} className="font-medium text-[#6366f1] hover:underline">
                {inscrevendo === s.id ? "Fechar inscrição" : "Inscrever pessoas"}
              </button>
              <button onClick={() => editar(s)} className="text-[#5a5f6d] hover:underline">
                Editar
              </button>
              <button onClick={() => alternar(s)} className="text-[#5a5f6d] hover:underline">
                {s.ativa ? "Desativar" : "Ativar"}
              </button>
              <button onClick={() => apagar(s)} className="text-red-600 hover:underline">
                Apagar
              </button>
            </div>
            {inscrevendo === s.id && <Inscrever seq={s} onFeito={carregar} />}
          </div>
        ))}
      </div>
    </section>
  );
}
