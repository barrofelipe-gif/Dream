"use client";

import { useCallback, useEffect, useState } from "react";

type Conta = { id: string; username: string; loja: string };
type Gatilho = "ETIQUETA_APLICADA" | "ETIQUETA_REMOVIDA" | "PALAVRA_NA_MENSAGEM" | "CONVERSA_TRANSFERIDA";
type TipoAcao = "ADICIONAR_ETIQUETA" | "REMOVER_ETIQUETA" | "ENVIAR_MENSAGEM" | "CHAMAR_ATENDENTE" | "ENCERRAR" | "DEVOLVER_AO_ROBO" | "NOTIFICAR_EQUIPE";
type Acao = { tipo: TipoAcao; valor?: string; texto?: string; motivo?: string };
type Regra = {
  id: string;
  accountId: string;
  nome: string;
  ativa: boolean;
  quando: { tipo: Gatilho; valor?: string };
  fazer: Acao[];
  createdAt: string;
  account: { username: string; loja: string };
};
type Notificacao = {
  id: string;
  conversationId: string;
  motivo: string;
  lida: boolean;
  createdAt: string;
  conversa: { id: string; nome: string | null; username: string | null; status: string; account: { username: string } } | null;
};
type Email = { id: string; email: string; ativo: boolean };

const campo =
  "w-full rounded-xl border border-[#e3e5ea] px-3 py-2.5 text-sm text-[#1b1f2b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/15";
const SUGESTOES = ["Comprador", "Pediu humano", "Sem dúvida informada", "Não atendido", "Quer comprar", "Resolvido pelo robô", "Pedido atrasado", "Veio de anúncio"];

const GATILHOS: { v: Gatilho; rotulo: string }[] = [
  { v: "ETIQUETA_APLICADA", rotulo: "Uma etiqueta for aplicada" },
  { v: "ETIQUETA_REMOVIDA", rotulo: "Uma etiqueta for removida" },
  { v: "PALAVRA_NA_MENSAGEM", rotulo: "A mensagem do cliente tiver a palavra" },
  { v: "CONVERSA_TRANSFERIDA", rotulo: "A conversa for transferida para a equipe" },
];
const ACOES: { v: TipoAcao; rotulo: string }[] = [
  { v: "ADICIONAR_ETIQUETA", rotulo: "Adicionar etiqueta" },
  { v: "REMOVER_ETIQUETA", rotulo: "Remover etiqueta" },
  { v: "ENVIAR_MENSAGEM", rotulo: "Enviar mensagem" },
  { v: "CHAMAR_ATENDENTE", rotulo: "Chamar atendente" },
  { v: "NOTIFICAR_EQUIPE", rotulo: "Avisar a equipe (sino)" },
  { v: "DEVOLVER_AO_ROBO", rotulo: "Devolver ao robô" },
  { v: "ENCERRAR", rotulo: "Encerrar conversa" },
];

const quando = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

function descreverQuando(q: Regra["quando"]) {
  switch (q.tipo) {
    case "ETIQUETA_APLICADA":
      return q.valor ? `etiqueta "${q.valor}" for aplicada` : "qualquer etiqueta for aplicada";
    case "ETIQUETA_REMOVIDA":
      return q.valor ? `etiqueta "${q.valor}" for removida` : "qualquer etiqueta for removida";
    case "PALAVRA_NA_MENSAGEM":
      return `a mensagem tiver: ${q.valor}`;
    case "CONVERSA_TRANSFERIDA":
      return "a conversa for transferida para a equipe";
  }
}

function descreverAcao(a: Acao) {
  const r = ACOES.find((x) => x.v === a.tipo)?.rotulo ?? a.tipo;
  if (a.tipo === "ADICIONAR_ETIQUETA" || a.tipo === "REMOVER_ETIQUETA") return `${r} "${a.valor}"`;
  if (a.tipo === "ENVIAR_MENSAGEM") return `${r}: "${(a.texto ?? "").slice(0, 50)}${(a.texto ?? "").length > 50 ? "…" : ""}"`;
  return r;
}

const NOVA = { id: "", accountId: "", nome: "", ativa: true, quando: { tipo: "ETIQUETA_APLICADA" as Gatilho, valor: "" }, fazer: [{ tipo: "ADICIONAR_ETIQUETA" as TipoAcao, valor: "" }] as Acao[] };

/** Sino com contador de conversas que precisam de alguém da equipe. Pode ser usado sozinho no topo do painel. */
export function SinoInstagram({ onAbrirConversa }: { onAbrirConversa?: (conversationId: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [naoLidas, setNaoLidas] = useState(0);
  const [itens, setItens] = useState<Notificacao[]>([]);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/instagram/notificacoes", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    setNaoLidas(j.naoLidas);
    setItens(j.itens);
  }, []);
  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 30000);
    return () => clearInterval(t);
  }, [carregar]);

  async function marcar(body: Record<string, unknown>) {
    await fetch("/api/instagram/notificacoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    carregar();
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setAberto((a) => !a)}
        className="relative rounded-full border border-[#e3e5ea] p-2 text-[#5a5f6d] hover:bg-[#f2f3f6]"
        aria-label={`Avisos: ${naoLidas} não lido${naoLidas === 1 ? "" : "s"}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {naoLidas > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
            {naoLidas > 99 ? "99+" : naoLidas}
          </span>
        )}
      </button>
      {aberto && (
        <div className="absolute right-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-[#e3e5ea] bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-[#1b1f2b]">Precisam de atendimento</span>
            {naoLidas > 0 && (
              <button onClick={() => marcar({})} className="text-[11px] text-[#6366f1] hover:underline">
                Marcar todas como lidas
              </button>
            )}
          </div>
          {itens.length === 0 ? (
            <p className="py-4 text-center text-xs text-[#a1a5b0]">Nenhum aviso novo.</p>
          ) : (
            <ul className="max-h-80 space-y-1.5 overflow-y-auto">
              {itens.map((n) => (
                <li key={n.id} className="rounded-xl bg-[#f7f8fa] px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => {
                        onAbrirConversa?.(n.conversationId);
                        marcar({ conversationId: n.conversationId });
                      }}
                      className="min-w-0 truncate text-left font-medium text-[#1b1f2b] hover:underline"
                    >
                      {n.conversa?.nome || (n.conversa?.username ? `@${n.conversa.username}` : "Contato")}
                    </button>
                    <span className="shrink-0 text-[10px] text-[#a1a5b0]">{quando(n.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-[#5a5f6d]">{n.motivo}</p>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-[#a1a5b0]">
                    <span>{n.conversa ? `@${n.conversa.account.username}` : "conversa apagada"}</span>
                    <button onClick={() => marcar({ ids: [n.id] })} className="text-[#6366f1] hover:underline">
                      Lida
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ConfigNotificacoes() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [novo, setNovo] = useState("");
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    const r = await fetch("/api/instagram/notificacoes/config", { cache: "no-store" });
    if (r.ok) setEmails((await r.json()).emails);
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function adicionar() {
    setErro("");
    const r = await fetch("/api/instagram/notificacoes/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: novo }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setNovo("");
      carregar();
    } else setErro(j.error ?? "Não foi possível salvar");
  }
  async function alternar(e: Email) {
    await fetch("/api/instagram/notificacoes/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id, ativo: !e.ativo }) });
    carregar();
  }
  async function remover(e: Email) {
    await fetch(`/api/instagram/notificacoes/config?id=${encodeURIComponent(e.id)}`, { method: "DELETE" });
    carregar();
  }

  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-[#a1a5b0]">Avisos para a equipe</p>
        <SinoInstagram />
      </div>
      <p className="mb-3 text-xs text-[#8a8f9c]">
        Quando uma conversa precisa de alguém (o robô chamou uma atendente ou uma regra pediu), aparece um aviso no sino. O mesmo contato não gera outro aviso em menos de 10
        minutos enquanto o anterior não for lido.
      </p>
      <div className="space-y-3 rounded-2xl border border-[#e3e5ea] p-4">
        <p className="text-xs text-[#5a5f6d]">
          E-mails da equipe <span className="text-[#a1a5b0]">(ficam guardados; o envio por e-mail ainda não está ligado, hoje o aviso sai só no sino)</span>
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            adicionar();
          }}
          className="flex gap-2"
        >
          <input type="email" value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="nome@empresa.com.br" className={campo} />
          <button disabled={!novo.trim()} className="shrink-0 rounded-lg bg-[#1b1f2b] px-4 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-40">
            Adicionar
          </button>
        </form>
        {erro && <p className="text-xs text-red-600">{erro}</p>}
        {emails.length > 0 && (
          <ul className="space-y-1.5">
            {emails.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded-xl bg-[#f7f8fa] px-3 py-2 text-sm">
                <span className={`min-w-0 truncate ${e.ativo ? "text-[#1b1f2b]" : "text-[#a1a5b0] line-through"}`}>{e.email}</span>
                <span className="flex shrink-0 gap-3 text-[11px]">
                  <button onClick={() => alternar(e)} className="text-[#6366f1] hover:underline">
                    {e.ativo ? "Pausar" : "Ativar"}
                  </button>
                  <button onClick={() => remover(e)} className="text-red-600 hover:underline">
                    Remover
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function InstagramRegras() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [regras, setRegras] = useState<Regra[]>([]);
  const [form, setForm] = useState<typeof NOVA | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/instagram/regras", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    setContas(j.contas);
    setRegras(j.regras);
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const novaRegra = () => setForm({ ...NOVA, accountId: contas[0]?.id ?? "", fazer: [{ tipo: "ADICIONAR_ETIQUETA", valor: "" }] });
  const editar = (r: Regra) =>
    setForm({ id: r.id, accountId: r.accountId, nome: r.nome, ativa: r.ativa, quando: { tipo: r.quando.tipo, valor: r.quando.valor ?? "" }, fazer: r.fazer.map((a) => ({ ...a })) });

  async function salvar() {
    if (!form) return;
    setSalvando(true);
    setMsg(null);
    const r = await fetch(form.id ? `/api/instagram/regras/${form.id}` : "/api/instagram/regras", {
      method: form.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: form.accountId, nome: form.nome, ativa: form.ativa, quando: form.quando, fazer: form.fazer }),
    });
    const j = await r.json().catch(() => ({}));
    setSalvando(false);
    if (r.ok) {
      setMsg({ tipo: "ok", texto: form.id ? "Regra atualizada." : "Regra criada." });
      setForm(null);
      carregar();
    } else setMsg({ tipo: "erro", texto: j.error ?? "Não foi possível salvar" });
  }

  async function alternar(r: Regra) {
    await fetch(`/api/instagram/regras/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativa: !r.ativa }) });
    carregar();
  }

  async function apagar(r: Regra) {
    if (!window.confirm(`Apagar a regra "${r.nome}"?`)) return;
    await fetch(`/api/instagram/regras/${r.id}`, { method: "DELETE" });
    carregar();
  }

  const mudarAcao = (i: number, a: Acao) => form && setForm({ ...form, fazer: form.fazer.map((x, j) => (j === i ? a : x)) });
  const precisaValor = form?.quando.tipo !== "CONVERSA_TRANSFERIDA";

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-1 flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-[#a1a5b0]">Regras de automação</p>
          {!form && (
            <button onClick={novaRegra} disabled={contas.length === 0} className="rounded-lg bg-[#1b1f2b] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black disabled:opacity-40">
              + Nova regra
            </button>
          )}
        </div>
        <p className="mb-3 text-xs text-[#8a8f9c]">
          &quot;Quando isso acontecer, faça aquilo&quot;. A mesma regra não roda duas vezes no mesmo contato em 1 minuto, e uma regra só pode disparar outra até 3 níveis. Mensagens só
          saem para quem falou com a loja nas últimas 24 horas.
        </p>
        <datalist id="tags-regras">
          {SUGESTOES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>

        {form && (
          <div className="mb-3 space-y-4 rounded-2xl border border-[#6366f1]/40 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome da regra (só para você)" maxLength={60} className={campo} />
              <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} disabled={!!form.id} className={`${campo} disabled:bg-[#f7f8fa]`}>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    @{c.username} ({c.loja})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold text-[#1b1f2b]">Quando</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <select value={form.quando.tipo} onChange={(e) => setForm({ ...form, quando: { tipo: e.target.value as Gatilho, valor: "" } })} className={campo}>
                  {GATILHOS.map((g) => (
                    <option key={g.v} value={g.v}>
                      {g.rotulo}
                    </option>
                  ))}
                </select>
                {precisaValor && (
                  <input
                    list={form.quando.tipo === "PALAVRA_NA_MENSAGEM" ? undefined : "tags-regras"}
                    value={form.quando.valor}
                    onChange={(e) => setForm({ ...form, quando: { ...form.quando, valor: e.target.value } })}
                    placeholder={form.quando.tipo === "PALAVRA_NA_MENSAGEM" ? "Palavras separadas por vírgula (ex.: preço, valor)" : "Etiqueta (vazio = qualquer uma)"}
                    className={campo}
                  />
                )}
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold text-[#1b1f2b]">Faça</p>
              <div className="space-y-2">
                {form.fazer.map((a, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-xl bg-[#f7f8fa] p-2.5 sm:flex-row sm:items-start">
                    <span className="hidden pt-2.5 text-xs text-[#a1a5b0] sm:block">{i + 1}.</span>
                    <select value={a.tipo} onChange={(e) => mudarAcao(i, { tipo: e.target.value as TipoAcao })} className={`${campo} bg-white sm:w-56 sm:shrink-0`}>
                      {ACOES.map((x) => (
                        <option key={x.v} value={x.v}>
                          {x.rotulo}
                        </option>
                      ))}
                    </select>
                    <div className="min-w-0 flex-1">
                      {(a.tipo === "ADICIONAR_ETIQUETA" || a.tipo === "REMOVER_ETIQUETA") && (
                        <input list="tags-regras" value={a.valor ?? ""} onChange={(e) => mudarAcao(i, { ...a, valor: e.target.value })} placeholder="Etiqueta" className={`${campo} bg-white`} />
                      )}
                      {a.tipo === "ENVIAR_MENSAGEM" && (
                        <textarea
                          value={a.texto ?? ""}
                          onChange={(e) => mudarAcao(i, { ...a, texto: e.target.value })}
                          rows={3}
                          maxLength={900}
                          placeholder="Mensagem. Use {nome} para o primeiro nome. Só sai dentro da janela de 24h."
                          className={`${campo} bg-white`}
                        />
                      )}
                      {a.tipo === "NOTIFICAR_EQUIPE" && (
                        <input value={a.motivo ?? ""} onChange={(e) => mudarAcao(i, { ...a, motivo: e.target.value })} placeholder="Texto do aviso (opcional)" maxLength={200} className={`${campo} bg-white`} />
                      )}
                      {a.tipo === "CHAMAR_ATENDENTE" && <p className="pt-2.5 text-xs text-[#8a8f9c]">Passa a conversa para a equipe e acende o sino.</p>}
                      {a.tipo === "ENCERRAR" && <p className="pt-2.5 text-xs text-[#8a8f9c]">Fecha a conversa (o robô para de responder).</p>}
                      {a.tipo === "DEVOLVER_AO_ROBO" && <p className="pt-2.5 text-xs text-[#8a8f9c]">O robô volta a responder este contato.</p>}
                    </div>
                    {form.fazer.length > 1 && (
                      <button onClick={() => setForm({ ...form, fazer: form.fazer.filter((_, j) => j !== i) })} className="self-end px-2 pt-2 text-xs text-red-600 hover:underline sm:self-start">
                        Remover
                      </button>
                    )}
                  </div>
                ))}
                {form.fazer.length < 10 && (
                  <button onClick={() => setForm({ ...form, fazer: [...form.fazer, { tipo: "ADICIONAR_ETIQUETA", valor: "" }] })} className="text-xs font-medium text-[#6366f1] hover:underline">
                    + Adicionar ação
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-[#5a5f6d]">
                <input type="checkbox" checked={form.ativa} onChange={(e) => setForm({ ...form, ativa: e.target.checked })} />
                Regra ativa
              </label>
              <div className="flex gap-2">
                <button onClick={() => setForm(null)} className="rounded-lg px-3 py-2 text-xs font-medium text-[#5a5f6d] hover:bg-[#f2f3f6]">
                  Cancelar
                </button>
                <button onClick={salvar} disabled={salvando || !form.nome.trim()} className="rounded-lg bg-[#1b1f2b] px-4 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-40">
                  {salvando ? "Salvando…" : form.id ? "Salvar alterações" : "Criar regra"}
                </button>
              </div>
            </div>
          </div>
        )}
        {msg && <p className={`mb-3 text-xs ${msg.tipo === "ok" ? "text-emerald-700" : "text-red-600"}`}>{msg.texto}</p>}

        {regras.length === 0 && !form ? (
          <p className="rounded-2xl border border-dashed border-[#e3e5ea] p-6 text-center text-xs text-[#a1a5b0]">Nenhuma regra ainda.</p>
        ) : (
          <div className="space-y-2">
            {regras.map((r) => (
              <div key={r.id} className={`rounded-xl border border-[#e3e5ea] p-3 text-sm ${r.ativa ? "" : "opacity-60"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium text-[#1b1f2b]">{r.nome}</span>
                  <button
                    onClick={() => alternar(r)}
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${r.ativa ? "bg-emerald-100 text-emerald-700" : "bg-[#eef0f4] text-[#8a8f9c]"}`}
                  >
                    {r.ativa ? "Ativa" : "Desativada"}
                  </button>
                </div>
                <p className="mt-1 text-xs text-[#5a5f6d]">
                  <span className="font-semibold">Quando</span> {descreverQuando(r.quando)}
                </p>
                <ul className="mt-0.5 space-y-0.5 text-xs text-[#5a5f6d]">
                  {r.fazer.map((a, i) => (
                    <li key={i}>
                      <span className="text-[#a1a5b0]">→</span> {descreverAcao(a)}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center justify-between text-[11px] text-[#8a8f9c]">
                  <span>@{r.account.username}</span>
                  <span className="flex gap-3">
                    <button onClick={() => editar(r)} className="text-[#6366f1] hover:underline">
                      Editar
                    </button>
                    <button onClick={() => apagar(r)} className="text-red-600 hover:underline">
                      Apagar
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfigNotificacoes />
    </div>
  );
}
