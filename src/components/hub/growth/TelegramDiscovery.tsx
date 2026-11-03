"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Dashboard } from "./TelegramDashboard";
import type { PublicGroup } from "@/lib/telegram/domain";
import type { SavedProspect } from "@/lib/telegram/prospects";
import s from "./telegram-dashboard.module.css";

type MonitoredProspect = Dashboard["prospects"][number];
type RefreshResult = {
  accountId?: number;
  source?: { id: number; name: string };
  groups?: PublicGroup[];
  query?: string;
  checked?: number;
  failed?: number;
};
type RefreshProgress = {
  total: number;
  done: number;
  failed: number;
  current: string;
  finished: boolean;
  stopped: boolean;
};
type CheckState = { state: "checking" | "done" | "failed"; message: string };
const terms = [
  "fitness atacado",
  "biquíni atacado",
  "moda praia",
  "revendedoras",
];
const number = (value: number) => value.toLocaleString("pt-BR");
function dateTime(value?: string | null) {
  if (!value) return "Não registrada";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Não registrada";
}
function signed(value: number) {
  return `${value > 0 ? "+" : ""}${number(value)}`;
}
function due(prospect: SavedProspect, at: number) {
  return (
    !!prospect.lastError ||
    (!!prospect.nextCheckAt && new Date(prospect.nextCheckAt).getTime() <= at)
  );
}

export default function TelegramDiscovery({
  data,
  post,
  notify,
  onChanged,
  connect,
  openCommunity,
}: {
  data: Dashboard;
  post: (
    path: string,
    input: Record<string, unknown>,
  ) => Promise<RefreshResult>;
  notify: (text: string) => void;
  onChanged: () => void;
  connect: () => void;
  openCommunity: (sourceId: number, accountId: number) => void;
}) {
  const monitored: MonitoredProspect[] = data.prospects;
  const [query, setQuery] = useState("fitness atacado");
  const [searched, setSearched] = useState("");
  const [groups, setGroups] = useState<PublicGroup[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState<number | null>(null);
  const [saving, setSaving] = useState<{ id: number; remove: boolean } | null>(
    null,
  );
  const [progress, setProgress] = useState<RefreshProgress | null>(null);
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [stopRequested, setStopRequested] = useState(false);
  const [kind, setKind] = useState("all");
  const [view, setView] = useState<"saved" | "results">(() =>
    monitored.length ? "saved" : "results",
  );
  const [sort, setSort] = useState(() =>
    monitored.length ? "review" : "relevance",
  );
  const [listFilter, setListFilter] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const working = useRef(false);
  const mounted = useRef(true);
  const stop = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop.current = true;
    };
  }, []);
  const connected = data.connection === "connected";
  const refreshing = !!progress && !progress.finished;
  const locked = busy || saving !== null || preparing !== null || refreshing;
  const reviewAt = new Date(data.updatedAt).getTime();
  const needsReview = monitored.filter((group) => due(group, reviewAt)).length;
  const savedById = new Map(monitored.map((group) => [group.id, group]));
  const filter = listFilter.trim().toLocaleLowerCase("pt-BR");
  const list: PublicGroup[] = view === "saved" ? monitored : groups;
  const filtered = list.filter(
    (group) =>
      (kind === "all" || (group.kind || "group") === kind) &&
      (view !== "saved" ||
        !filter ||
        `${group.name} ${group.username} ${savedById.get(group.id)?.query || ""}`
          .toLocaleLowerCase("pt-BR")
          .includes(filter)),
  );
  if (sort === "members")
    filtered.sort((a, b) => (b.members ?? -1) - (a.members ?? -1));
  if (sort === "review")
    filtered.sort((a, b) => {
      const first = savedById.get(a.id),
        second = savedById.get(b.id);
      const firstDue = first ? due(first, reviewAt) : false;
      const secondDue = second ? due(second, reviewAt) : false;
      return (
        Number(secondDue) - Number(firstDue) ||
        new Date(first?.nextCheckAt || "9999-01-01").getTime() -
          new Date(second?.nextCheckAt || "9999-01-01").getTime()
      );
    });
  function changeView(next: "saved" | "results") {
    setView(next);
    setSort(next === "saved" ? "review" : "relevance");
  }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connected || working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setProgress(null);
    changeView("results");
    try {
      const result = await post("discover", { query, include_channels: true });
      if (mounted.current) {
        setGroups(result.groups || []);
        setSearched(result.query || query);
      }
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "Não foi possível pesquisar.",
        );
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function save(group: PublicGroup, remove = false) {
    if (working.current) return;
    if (
      remove &&
      !window.confirm(
        `Remover “${group.name}” da lista monitorada?\n\nO histórico de tamanho deste público será apagado. As coletas já registradas permanecerão no sistema.`,
      )
    )
      return;
    working.current = true;
    setSaving({ id: group.id, remove });
    setError("");
    try {
      await post("growth/prospect", { id: group.id, remove });
      notify(
        remove
          ? "Público removido da lista monitorada."
          : "Público salvo. A descoberta e as próximas consultas ficarão nesta lista.",
      );
      onChanged();
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error ? reason.message : "Não foi possível salvar.",
        );
    } finally {
      working.current = false;
      if (mounted.current) setSaving(null);
    }
  }
  async function prepareOrigin(group: PublicGroup) {
    if (!connected || working.current || group.kind === "channel") return;
    working.current = true;
    setPreparing(group.id);
    setError("");
    try {
      const result = await post("connection/prepare-origin", { id: group.id });
      if (!result.source || result.source.id !== group.id || !Number.isSafeInteger(result.accountId))
        throw new Error("O Telegram não confirmou a origem. Atualize os grupos antes de continuar.");
      if (mounted.current) {
        notify(`Origem preparada: ${result.source.name}. Escolha o destino e consulte os participantes.`);
        onChanged();
        openCommunity(result.source.id, result.accountId!);
      }
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : "Não foi possível preparar a origem.");
    } finally {
      working.current = false;
      if (mounted.current) setPreparing(null);
    }
  }
  async function refresh(targets: SavedProspect[]) {
    if (!connected || working.current || !targets.length) return;
    working.current = true;
    stop.current = false;
    setStopRequested(false);
    setError("");
    let done = 0,
      failed = 0;
    setProgress({
      total: targets.length,
      done,
      failed,
      current: targets[0].name,
      finished: false,
      stopped: false,
    });
    for (const group of targets) {
      if (!mounted.current || stop.current) break;
      setProgress({
        total: targets.length,
        done,
        failed,
        current: group.name,
        finished: false,
        stopped: false,
      });
      setChecks((previous) => ({
        ...previous,
        [group.id]: {
          state: "checking",
          message: "Consultando a contagem no Telegram…",
        },
      }));
      try {
        const result = await post("growth/prospects/refresh", { id: group.id });
        if (
          (result.failed || 0) > 0 ||
          !(result.checked && result.checked > 0)
        ) {
          failed++;
          if (mounted.current)
            setChecks((previous) => ({
              ...previous,
              [group.id]: {
                state: "failed",
                message:
                  "Não foi possível atualizar. O último dado consultado foi preservado.",
              },
            }));
        } else if (mounted.current) {
          setChecks((previous) => ({
            ...previous,
            [group.id]: { state: "done", message: "Consulta concluída." },
          }));
        }
      } catch (reason) {
        failed++;
        if (mounted.current)
          setChecks((previous) => ({
            ...previous,
            [group.id]: {
              state: "failed",
              message:
                reason instanceof Error
                  ? reason.message
                  : "Não foi possível atualizar este público. O último dado foi preservado.",
            },
          }));
      }
      done++;
      if (mounted.current)
        setProgress({
          total: targets.length,
          done,
          failed,
          current: group.name,
          finished: false,
          stopped: false,
        });
    }
    working.current = false;
    if (done) onChanged();
    if (mounted.current) {
      const stopped = stop.current && done < targets.length;
      setProgress({
        total: targets.length,
        done,
        failed,
        current: "",
        finished: true,
        stopped,
      });
      notify(
        `${done - failed} público(s) atualizado(s)${failed ? `; ${failed} consulta(s) sem confirmação` : ""}${stopped ? ". A fila foi interrompida após a consulta atual" : ""}.`,
      );
    }
  }
  return (
    <div className={s.discovery}>
      <div className={s.discoveryHero}>
        <span className={s.eyebrow}>NOVAS OPORTUNIDADES</span>
        <h2>Encontre seu público. Acompanhe a evolução.</h2>
        <p>
          Pesquise grupos e canais de fitness, atacado e moda praia.
          <br />
          Salve os resultados para manter as datas, contagens e coletas em um só
          lugar.
        </p>
        <form onSubmit={search} className={s.searchForm}>
          <label className={s.srOnly} htmlFor="tg-niche">
            Pesquisar grupos e canais
          </label>
          <input
            ref={input}
            id="tg-niche"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            required
            minLength={3}
            maxLength={100}
            disabled={locked}
            placeholder="Assunto, nome, @usuário ou link t.me"
          />
          <button className={s.primary} disabled={!connected || locked}>
            {busy ? "Pesquisando…" : "Pesquisar"}
          </button>
        </form>
        <div className={s.chips}>
          {terms.map((term) => (
            <button
              key={term}
              disabled={locked}
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
            <strong>Conecte sua conta para consultar o Telegram</strong>
            <p>
              A lista monitorada e todo o histórico salvo continuam disponíveis.
            </p>
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
      <div
        className={s.discoverySummary}
        aria-label="Resumo dos públicos monitorados"
      >
        <div>
          <span>Públicos monitorados</span>
          <strong>{number(monitored.length)}</strong>
        </div>
        <div>
          <span>Para revisar</span>
          <strong>{number(needsReview)}</strong>
          <small>Revisão vencida ou última consulta com falha</small>
        </div>
        <div>
          <span>Revisão sugerida</span>
          <strong>Mensal</strong>
          <small>
            Atualize os públicos quando quiser pela lista monitorada
          </small>
        </div>
      </div>
      <div className={s.discoveryTools}>
        <div className={s.chartTabs} aria-label="Lista de públicos">
          <button
            aria-pressed={view === "saved"}
            disabled={refreshing}
            className={view === "saved" ? s.chartTabActive : ""}
            onClick={() => changeView("saved")}
          >
            Lista monitorada ({monitored.length})
          </button>
          <button
            aria-pressed={view === "results"}
            disabled={refreshing}
            className={view === "results" ? s.chartTabActive : ""}
            onClick={() => changeView("results")}
          >
            Resultados {groups.length ? `(${groups.length})` : ""}
          </button>
        </div>
        <div className={s.filterControls}>
          <label>
            <span className={s.srOnly}>Tipo de público</span>
            <select
              value={kind}
              disabled={locked}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="all">Grupos e canais</option>
              <option value="group">Grupos</option>
              <option value="channel">Canais</option>
            </select>
          </label>
          <label>
            <span className={s.srOnly}>Ordenação dos públicos</span>
            <select
              value={sort}
              disabled={locked}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="relevance">
                {view === "saved" ? "Ordem da lista" : "Ordem do Telegram"}
              </option>
              <option value="members">Maior público informado</option>
              {view === "saved" && (
                <option value="review">Priorizar revisões</option>
              )}
            </select>
          </label>
        </div>
      </div>
      {view === "saved" && (
        <div className={s.monitorTools}>
          <label>
            <span className={s.srOnly}>Filtrar lista monitorada</span>
            <input
              value={listFilter}
              onChange={(event) => setListFilter(event.target.value)}
              disabled={locked}
              placeholder="Filtrar sua lista por nome, @usuário ou nicho"
            />
          </label>
          <button
            className={s.secondary}
            disabled={!connected || locked || !filtered.length}
            onClick={() =>
              refresh(filtered.map((group) => savedById.get(group.id)!))
            }
          >
            Atualizar visíveis ({filtered.length})
          </button>
        </div>
      )}
      {progress && (
        <div
          className={`${s.monitorProgress} ${progress.failed ? s.monitorProgressWarning : ""}`}
          role="status"
          aria-live="polite"
        >
          <div>
            <strong>
              {progress.finished
                ? progress.stopped
                  ? "Consultas interrompidas"
                  : "Consultas concluídas"
                : `Consultando ${progress.done + 1} de ${progress.total}`}
            </strong>
            <p>
              {progress.finished
                ? `${progress.done - progress.failed} atualizado(s) · ${progress.failed} sem confirmação${progress.stopped ? ` · ${progress.total - progress.done} não consultado(s)` : ""}`
                : progress.current}
            </p>
          </div>
          {!progress.finished && (
            <button
              className={s.textButton}
              disabled={stopRequested}
              onClick={() => {
                stop.current = true;
                setStopRequested(true);
              }}
            >
              {stopRequested
                ? "Finalizando a consulta atual…"
                : "Parar consultas"}
            </button>
          )}
        </div>
      )}
      <div aria-live="polite" className={s.muted}>
        {busy
          ? "Consultando resultados públicos do Telegram…"
          : view === "saved"
            ? `${filtered.length} de ${monitored.length} público(s) na sua lista · datas no horário de Brasília`
            : searched
              ? `${filtered.length} resultado(s) para “${searched}”`
              : ""}
      </div>
      {busy && !filtered.length ? (
        <div className={s.discoverySearching} role="status">
          <span aria-hidden="true">⌕</span>
          <strong>Buscando grupos e canais…</strong>
          <p>Os resultados aparecerão assim que o Telegram responder.</p>
        </div>
      ) : filtered.length ? (
        <div className={s.prospects} aria-busy={busy}>
          {filtered.map((group) => {
            const saved = savedById.get(group.id);
            const history = saved
              ? [...saved.history].sort(
                  (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
                )
              : [];
            const latest = history[history.length - 1];
            const balance = latest?.delta;
            const check = checks[group.id];
            const needsCheck = saved ? due(saved, reviewAt) : false;
            const collection = saved?.collection;
            const runs = [...(collection?.runs || [])].sort(
              (a, b) =>
                new Date(b.collectedAt).getTime() -
                new Date(a.collectedAt).getTime(),
            );
            return (
              <article
                className={`${s.prospect} ${view === "saved" ? s.monitoredProspect : ""}`}
                key={group.id}
              >
                <div className={s.sectionTop}>
                  <span className={s.prospectIcon} aria-hidden="true">
                    {group.kind === "channel" ? "◈" : "♧"}
                  </span>
                  <div className={s.prospectBadges}>
                    <span className={s.typeBadge}>
                      {group.kind === "channel" ? "Canal" : "Grupo"}
                    </span>
                    {view === "saved" && (
                      <span
                        className={needsCheck ? s.reviewDue : s.reviewCurrent}
                      >
                        {needsCheck
                          ? saved?.lastError
                            ? "Revisar consulta"
                            : "Revisão pendente"
                          : "Acompanhando"}
                      </span>
                    )}
                  </div>
                </div>
                <h3>{group.name}</h3>
                <p className={s.muted}>@{group.username}</p>
                <strong className={s.memberCount}>
                  {group.members == null
                    ? "Público não informado"
                    : `${number(group.members)} ${group.kind === "channel" ? "inscritos" : "participantes"}`}
                </strong>
                {group.sponsored && (
                  <span className={s.paused}>Patrocinado</span>
                )}
                {view === "saved" && saved ? (
                  <>
                    <div className={s.prospectBalance}>
                      <strong
                        className={
                          typeof balance === "number" && balance < 0
                            ? s.balanceNegative
                            : s.balanceNeutral
                        }
                      >
                        {typeof balance === "number" ? signed(balance) : "—"}
                      </strong>
                      <span>
                        {typeof balance === "number"
                          ? "Saldo de tamanho na última consulta"
                          : history.filter((point) => point.members !== null)
                                .length < 2
                            ? "Aguardando duas contagens informadas"
                            : "Comparação não informada nesta consulta"}
                      </span>
                    </div>
                    <dl className={s.prospectDates}>
                      <div>
                        <dt>Descoberto em</dt>
                        <dd>{dateTime(saved.discoveredAt)}</dd>
                      </div>
                      <div>
                        <dt>Salvo em</dt>
                        <dd>{dateTime(saved.savedAt)}</dd>
                      </div>
                      <div>
                        <dt>Última consulta</dt>
                        <dd>{dateTime(saved.lastCheckedAt)}</dd>
                      </div>
                      <div>
                        <dt>Próxima revisão</dt>
                        <dd>{dateTime(saved.nextCheckAt)}</dd>
                      </div>
                    </dl>
                    <p className={s.prospectQuery}>Pesquisa: {saved.query}</p>
                    {saved.lastError && (
                      <div className={s.prospectError}>
                        <strong>Última consulta sem confirmação</strong>
                        <p>{saved.lastError}</p>
                        <small>
                          Tentativa: {dateTime(saved.lastAttemptAt)}. O último
                          resultado foi mantido.
                        </small>
                      </div>
                    )}
                    {check && (
                      <p
                        className={`${s.prospectCheck} ${check.state === "failed" ? s.prospectCheckFailed : ""}`}
                        role="status"
                      >
                        {check.message}
                      </p>
                    )}
                    <details className={s.prospectHistory}>
                      <summary>Histórico de tamanho ({history.length})</summary>
                      <p>
                        Variação da contagem informada pelo Telegram. O saldo
                        não identifica novas pessoas.
                      </p>
                      {history.length ? (
                        <div className={s.historyTable}>
                          <div className={s.historyHeader}>
                            <span>Consulta</span>
                            <span>Público</span>
                            <span>Saldo</span>
                          </div>
                          {history
                            .slice(-12)
                            .reverse()
                            .map((snapshot, index) => (
                              <div key={`${snapshot.at}-${index}`}>
                                <span>{dateTime(snapshot.at)}</span>
                                <span>
                                  {snapshot.members == null
                                    ? "Não informado"
                                    : number(snapshot.members)}
                                </span>
                                <span>
                                  {snapshot.delta == null
                                    ? "—"
                                    : signed(snapshot.delta)}
                                </span>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <p>As contagens confirmadas serão registradas aqui.</p>
                      )}
                    </details>
                    <details className={s.prospectHistory}>
                      <summary>Coletas registradas ({runs.length})</summary>
                      <dl className={s.prospectDates}>
                        <div>
                          <dt>Primeira coleta registrada</dt>
                          <dd>{dateTime(collection?.firstCollectedAt)}</dd>
                        </div>
                        <div>
                          <dt>Última coleta registrada</dt>
                          <dd>{dateTime(collection?.lastCollectedAt)}</dd>
                        </div>
                        <div>
                          <dt>Contatos registrados</dt>
                          <dd>{number(collection?.totalContacts || 0)}</dd>
                        </div>
                      </dl>
                      {runs.length ? (
                        <div className={s.collectionHistory}>
                          {runs.slice(0, 12).map((run) => (
                            <div key={run.id}>
                              <strong>{dateTime(run.collectedAt)}</strong>
                              <p>
                                {number(run.received)} recebido(s) ·{" "}
                                {number(run.newContacts)} novo(s) na lista ·{" "}
                                {number(run.knownContacts)} já conhecido(s)
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p>
                          Nenhuma coleta de participantes registrada para este
                          público.
                        </p>
                      )}
                    </details>
                  </>
                ) : (
                  <p className={s.prospectNote}>
                    {saved
                      ? "Este público está na sua lista monitorada. Consulte o histórico na aba Lista monitorada."
                      : "Salve este público para acompanhar as contagens, as datas de consulta e as coletas registradas."}
                  </p>
                )}
                <div className={s.prospectActions}>
                  {group.kind !== "channel" && (
                    <button
                      className={s.primary}
                      disabled={!connected || locked}
                      onClick={() => prepareOrigin(group)}
                    >
                      {preparing === group.id ? "Entrando e verificando…" : "Entrar e preparar coleta"}
                    </button>
                  )}
                  <a
                    className={s.secondary}
                    href={`https://t.me/${encodeURIComponent(group.username)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir no Telegram ↗
                  </a>
                  {view === "saved" && saved ? (
                    <button
                      className={s.textButton}
                      disabled={!connected || locked}
                      onClick={() => refresh([saved])}
                    >
                      {check?.state === "checking"
                        ? "Consultando…"
                        : "Atualizar agora"}
                    </button>
                  ) : (
                    <button
                      className={s.textButton}
                      disabled={locked}
                      onClick={() =>
                        saved ? changeView("saved") : save(group)
                      }
                    >
                      {saving?.id === group.id
                        ? "Salvando…"
                        : saved
                          ? "★ Na lista"
                          : "☆ Salvar"}
                    </button>
                  )}
                </div>
                {view === "saved" && saved && (
                  <button
                    className={s.removeProspect}
                    disabled={locked}
                    onClick={() => save(group, true)}
                    aria-label={`Remover ${group.name} da lista monitorada`}
                  >
                    {saving?.id === group.id && saving.remove
                      ? "Removendo…"
                      : "Remover da lista"}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className={s.empty}>
          <span className={s.emptyIcon} aria-hidden="true">
            ⌕
          </span>
          <h3>
            {view === "saved"
              ? monitored.length
                ? "Nenhum público corresponde ao filtro"
                : "Sua lista monitorada começa aqui"
              : searched
                ? "Nenhum público encontrado nesta pesquisa"
                : "Uma nova comunidade começa com uma boa busca"}
          </h3>
          <p>
            {view === "saved"
              ? monitored.length
                ? "Ajuste o nome, o nicho ou o tipo de público para ver outros resultados salvos."
                : "Pesquise um nicho e use Salvar para guardar grupos e canais com seu histórico."
              : searched
                ? "Tente menos palavras, como “fitness”, ou pesquise um @usuário exato."
                : "Escolha um nicho acima ou digite o nome de um grupo ou canal."}
          </p>
        </div>
      )}
      <div className={s.researchNote}>
        <b>Histórico para decidir onde vale acompanhar</b>
        <p>
          A contagem de membros mostra o tamanho informado pelo Telegram.
          Compare a evolução, a atividade e a relação com o seu nicho. As datas
          de coleta registram as consultas de participantes feitas pelo painel;
          elas não representam novas entradas na sua comunidade.
        </p>
      </div>
    </div>
  );
}
