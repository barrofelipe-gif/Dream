"use client";
import { useRef, useState, type FormEvent } from "react";
import type { Dashboard } from "./TelegramDashboard";
import type { PublicGroup } from "@/lib/telegram/domain";
import s from "./telegram-dashboard.module.css";

const terms = [
  "fitness atacado",
  "biquíni atacado",
  "moda praia",
  "revendedoras",
];
export default function TelegramDiscovery({
  data,
  post,
  notify,
  onChanged,
  connect,
}: {
  data: Dashboard;
  post: (
    path: string,
    input: Record<string, unknown>,
  ) => Promise<{ groups?: PublicGroup[]; query?: string }>;
  notify: (text: string) => void;
  onChanged: () => void;
  connect: () => void;
}) {
  const [query, setQuery] = useState("fitness atacado"),
    [searched, setSearched] = useState("");
  const [groups, setGroups] = useState<PublicGroup[]>([]),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [saving, setSaving] = useState<number | null>(null);
  const [kind, setKind] = useState("all"),
    [view, setView] = useState("results"),
    [sort, setSort] = useState("relevance");
  const input = useRef<HTMLInputElement>(null);
  const connected = data.connection === "connected";
  async function search(event: FormEvent) {
    event.preventDefault();
    if (!connected || busy) return;
    setBusy(true);
    setError("");
    setGroups([]);
    setView("results");
    try {
      const result = await post("discover", { query, include_channels: true });
      setGroups(result.groups || []);
      setSearched(result.query || query);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível pesquisar.");
    } finally {
      setBusy(false);
    }
  }
  async function save(group: PublicGroup, remove = false) {
    setSaving(group.id);
    setError("");
    try {
      await post("growth/prospect", { id: group.id, remove });
      notify(
        remove
          ? "Público removido dos salvos."
          : "Público salvo para comparar depois.",
      );
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(null);
    }
  }
  const list = view === "saved" ? data.prospects : groups;
  const filtered = list.filter(
    (g) => kind === "all" || (g.kind || "group") === kind,
  );
  if (sort === "members")
    filtered.sort((a, b) => (b.members ?? -1) - (a.members ?? -1));
  return (
    <div className={s.discovery}>
      <div className={s.discoveryHero}>
        <span className={s.eyebrow}>NOVAS OPORTUNIDADES</span>
        <h2>Encontre onde o seu público está.</h2>
        <p>
          Descubra grupos e canais de fitness, atacado e moda praia.
          <br />
          Compare comunidades antes de escolher sua próxima ação.
        </p>
        <form onSubmit={search} className={s.searchForm}>
          <label className={s.srOnly} htmlFor="tg-niche">
            Pesquisar grupos e canais
          </label>
          <input
            ref={input}
            id="tg-niche"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            required
            minLength={3}
            maxLength={100}
            placeholder="Assunto, nome, @usuário ou link t.me"
          />
          <button className={s.primary} disabled={!connected || busy}>
            {busy ? "Pesquisando…" : "Pesquisar"}
          </button>
        </form>
        <div className={s.chips}>
          {terms.map((term) => (
            <button
              key={term}
              onClick={() => {
                setQuery(term);
                input.current?.focus();
              }}
            >
              {term}
            </button>
          ))}
        </div>
      </div>
      {!connected && (
        <div className={s.connectNotice}>
          <div>
            <strong>Conecte sua conta para pesquisar no Telegram</strong>
            <p>Seu dashboard e os públicos salvos continuam disponíveis.</p>
          </div>
          <button className={s.primary} onClick={connect}>
            Conectar Telegram →
          </button>
        </div>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <div className={s.discoveryTools}>
        <div className={s.chartTabs}>
          <button
            aria-pressed={view === "results"}
            className={view === "results" ? s.chartTabActive : ""}
            onClick={() => setView("results")}
          >
            Resultados {groups.length ? `(${groups.length})` : ""}
          </button>
          <button
            aria-pressed={view === "saved"}
            className={view === "saved" ? s.chartTabActive : ""}
            onClick={() => setView("saved")}
          >
            Públicos salvos ({data.prospects.length})
          </button>
        </div>
        <div className={s.filterControls}>
          <label>
            <span className={s.srOnly}>Tipo de público</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">Grupos e canais</option>
              <option value="group">Grupos</option>
              <option value="channel">Canais</option>
            </select>
          </label>
          <label>
            <span className={s.srOnly}>Ordenação dos públicos</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="relevance">Ordem do Telegram</option>
              <option value="members">Maior público informado</option>
            </select>
          </label>
        </div>
      </div>
      <div aria-live="polite" className={s.muted}>
        {busy
          ? "Consultando resultados públicos do Telegram…"
          : searched && view === "results"
            ? `${filtered.length} resultado(s) para “${searched}”`
            : ""}
      </div>
      {filtered.length ? (
        <div className={s.prospects}>
          {filtered.map((group) => {
            const saved = data.prospects.some((g) => g.id === group.id);
            return (
              <article className={s.prospect} key={group.id}>
                <div className={s.sectionTop}>
                  <span className={s.prospectIcon}>
                    {group.kind === "channel" ? "◈" : "♧"}
                  </span>
                  <span className={s.typeBadge}>
                    {group.kind === "channel" ? "Canal" : "Grupo"}
                  </span>
                </div>
                <h3>{group.name}</h3>
                <p className={s.muted}>@{group.username}</p>
                <strong className={s.memberCount}>
                  {group.members === null
                    ? "Público não informado"
                    : `${group.members.toLocaleString("pt-BR")} ${group.kind === "channel" ? "inscritos" : "participantes"}`}
                </strong>
                {group.sponsored && (
                  <span className={s.paused}>Patrocinado</span>
                )}
                <p className={s.prospectNote}>
                  Confira as publicações e a atividade recente para avaliar a
                  relação com o seu nicho.
                </p>
                <div className={s.prospectActions}>
                  <a
                    className={s.secondary}
                    href={`https://t.me/${encodeURIComponent(group.username)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir no Telegram ↗
                  </a>
                  <button
                    className={s.textButton}
                    disabled={saving !== null}
                    onClick={() => save(group, saved)}
                  >
                    {saving === group.id
                      ? "Salvando…"
                      : saved
                        ? "★ Salvo"
                        : "☆ Salvar"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className={s.empty}>
          <span className={s.emptyIcon}>⌕</span>
          <h3>
            {view === "saved"
              ? "Guarde os públicos que fizerem sentido"
              : searched
                ? "Nenhum público encontrado nesta pesquisa"
                : "Uma nova comunidade começa com uma boa busca"}
          </h3>
          <p>
            {view === "saved"
              ? "Use Salvar em um resultado para compará-lo depois."
              : searched
                ? "Tente menos palavras, como “fitness”, ou pesquise um @usuário exato."
                : "Escolha um nicho acima ou digite o nome de um grupo ou canal."}
          </p>
        </div>
      )}
      <div className={s.researchNote}>
        <b>Como escolher onde investir sua atenção</b>
        <p>
          Tamanho do público é um ponto de partida. Observe se as conversas
          combinam com sua oferta, se há atividade recente e se aparecem
          lojistas ou revendedoras. A busca mostra informações disponibilizadas
          pelo Telegram; quantidade de membros não comprova intenção de compra.
        </p>
      </div>
    </div>
  );
}
