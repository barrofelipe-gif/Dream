"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import TelegramCommunity from "./TelegramCommunity";
import TelegramDiscovery from "./TelegramDiscovery";
import TelegramSources from "./TelegramSources";
import type { dashboard } from "@/lib/telegram/growth";
import s from "./telegram-dashboard.module.css";

export type Dashboard = Awaited<ReturnType<typeof dashboard>>;
type Tab = "overview" | "links" | "discovery" | "community" | "sources";
type Metric = "audience" | "clicks" | "visits" | "sales" | "revenue";
const labels: Record<Metric, string> = {
  audience: "Público adquirido",
  clicks: "Cliques nos links",
  visits: "Visitas no site",
  sales: "Vendas atribuídas",
  revenue: "Receita atribuída",
};
const colors: Record<Metric, string> = {
  audience: "#6366f1",
  clicks: "#2563eb",
  visits: "#0891b2",
  sales: "#059669",
  revenue: "#153a63",
};
const number = (v: number) =>
  v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const money = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const shortDate = (v: string) =>
  new Date(`${v}T12:00:00-03:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
const stamp = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Ainda sem sincronização";
const value = (v: number, metric: Metric) =>
  metric === "revenue" ? money(v) : number(v);
function Arrow() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}
function Plane() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="m21.5 3-3.3 17c-.2 1-1 1.2-1.8.7l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L5.6 13.3l-5-1.6c-1-.3-1-1 .3-1.5L20.4 2.7c.9-.3 1.5.2 1.1.3Z" />
    </svg>
  );
}
function delta(current: number, previous: number) {
  if (!previous)
    return current
      ? "Primeiros resultados no período"
      : "Sem comparação anterior";
  const n = ((current - previous) / previous) * 100;
  return `${n > 0 ? "+" : ""}${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. período anterior`;
}
function ready(data: Dashboard, metric: Metric) {
  if (metric === "audience") return true;
  if (metric === "clicks") return data.tracking.links > 0;
  if (metric === "visits")
    return data.tracking.installed || !!data.tracking.lastVisit;
  return (
    !!data.tracking.syncedAt &&
    data.tracking.trayConnected &&
    (data.tracking.installed ||
      !!data.tracking.lastVisit ||
      data.tracking.gaAttribution?.status === "ready" ||
      data.totals.sales > 0 ||
      data.totals.pending > 0 ||
      data.previous.sales > 0)
  );
}
export default function TelegramDashboard() {
  const [tab, setTab] = useState<Tab>("overview"),
    [communityOpened, setCommunityOpened] = useState(false);
  const [preparedSource, setPreparedSource] = useState<{ id: number; accountId: number; request: number }>();
  const [days, setDays] = useState(30),
    [source, setSource] = useState("");
  const [data, setData] = useState<Dashboard | null>(null),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState("");
  const [refresh, setRefresh] = useState(0),
    [metric, setMetric] = useState<Metric>("clicks");
  const dialog = useRef<HTMLDialogElement>(null);
  const go = (next: Tab) => {
    if (next === "community") setCommunityOpened(true);
    if (tab === "community" && next !== "community") reload();
    setTab(next);
  };
  const reload = () => {
    setLoading(true);
    setRefresh((n) => n + 1);
  };
  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/telegram/growth?days=${days}&source=${encodeURIComponent(source)}${refresh ? "&fresh=1" : ""}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (r) => {
        const result = await r.json();
        if (!r.ok)
          throw new Error(
            result.error || "Não foi possível carregar as métricas.",
          );
        return result;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [days, source, refresh]);
  async function post(path: string, input: Record<string, unknown>) {
    if (!data?.csrf) throw new Error("Aguarde o carregamento do painel.");
    const response = await fetch(`/api/telegram/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": data.csrf,
      },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Não foi possível concluir esta ação.");
    return result;
  }
  async function action(
    name: string,
    path: string,
    input: Record<string, unknown>,
    success: string,
  ) {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await post(path, input);
      setNotice(success);
      reload();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível concluir esta ação.",
      );
    } finally {
      setBusy("");
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("create");
    setError("");
    try {
      await post("growth/links", Object.fromEntries(form.entries()));
      dialog.current?.close();
      go("links");
      setSource("");
      reload();
      setNotice(
        "Link criado. Copie e use nas publicações do Telegram para acompanhar os resultados.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível criar o link.",
      );
    } finally {
      setBusy("");
    }
  }
  async function copy(slug: string) {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/t/${slug}`,
      );
      setNotice("Link copiado.");
    } catch {
      setError(
        "Não foi possível copiar. Selecione o endereço do link para copiá-lo.",
      );
    }
  }
  const newLink = () => {
    setError("");
    dialog.current?.showModal();
  };
  const toggle = (id: string, active: boolean) =>
    action(
      id,
      "growth/link",
      { id, active },
      active
        ? "Medição retomada."
        : "Medição pausada. O link continua abrindo a loja.",
    );
  return (
    <section className={s.dashboard} aria-label="Dashboard Telegram BFF">
      <header className={s.header}>
        <div className={s.brand}>
          <span className={s.plane}>
            <Plane />
          </span>
          <div>
            <div className={s.eyebrow}>BFF FITNESS · GROWTH</div>
            <h1>
              Telegram<span className={s.badge}>Crescimento</span>
            </h1>
            <p>
              Da comunidade ao resultado. Acompanhe o que traz público, visitas
              e vendas.
            </p>
          </div>
        </div>
        <div className={s.headerActions}>
          <button className={s.connection} aria-busy={!data} onClick={() => go("community")}>
            <span
              className={
                data?.connection === "connected" ? s.greenDot : s.grayDot
              }
            />
            {!data
              ? "Verificando conexão…"
              : data.connection === "connected"
                ? "Telegram conectado"
                : "Conectar Telegram"}
          </button>
          <button className={s.primary} onClick={newLink} disabled={!data}>
            + Criar link rastreado
          </button>
        </div>
      </header>
      <nav className={s.tabs} aria-label="Seções do Telegram">
        {(
          [
            ["overview", "Visão geral"],
            ["links", "Links e vendas"],
            ["discovery", "Descobrir públicos"],
            ["sources", "Integrações"],
            ["community", "Conta e comunidade"],
          ] as [Tab, string][]
        ).map(([id, title]) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? "page" : undefined}
            className={tab === id ? s.tabActive : ""}
            onClick={() => go(id)}
          >
            {title}
          </button>
        ))}
      </nav>
      <div className={s.live} aria-live="polite">
        {notice && <p className={s.success}>{notice}</p>}
      </div>
      {error && (
        <div className={s.error} role="alert">
          {error} <button onClick={reload}>Tentar novamente</button>
        </div>
      )}
      {tab !== "community" && tab !== "discovery" && (
        <div className={s.filters}>
          <div>
            <h2>
              {tab === "overview"
                ? "Seu crescimento, em um só lugar"
                : tab === "sources"
                  ? "Suas fontes de dados, conectadas"
                  : "Os links por trás dos resultados"}
            </h2>
            <p>
              {data
                ? `${shortDate(data.from)} a ${shortDate(data.to)} · horário de Brasília`
                : "Carregando suas métricas…"}
            </p>
          </div>
          <div className={s.filterControls}>
            <label>
              <span className={s.srOnly}>Origem</span>
              <select
                value={source}
                onChange={(e) => {
                  setLoading(true);
                  setSource(e.target.value);
                }}
              >
                <option value="">Todas as origens</option>
                {data?.sources.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              <span className={s.srOnly}>Período</span>
              <select
                value={days}
                onChange={(e) => {
                  setLoading(true);
                  setDays(Number(e.target.value));
                }}
              >
                <option value={7}>Últimos 7 dias</option>
                <option value={30}>Últimos 30 dias</option>
                <option value={90}>Últimos 90 dias</option>
              </select>
            </label>
            <button className={s.secondary} onClick={reload} disabled={loading}>
              {loading ? "Atualizando…" : "↻ Atualizar"}
            </button>
          </div>
        </div>
      )}
      {!data && loading && (
        <div className={s.skeleton} role="status">
          Preparando sua central de crescimento…
        </div>
      )}
      {data && (
        <>
          {data.tracking.truncated && (
            <p className={s.warning}>
              A última sincronização encontrou mais pedidos que o limite de
              leitura. Os resultados comerciais são parciais.
            </p>
          )}
          {tab === "overview" && (
            <div aria-busy={loading}>
              <div className={s.kpis}>
                {(Object.keys(labels) as Metric[]).map((key, index) => (
                  <button
                    key={key}
                    onClick={() => setMetric(key)}
                    className={`${s.kpi} ${key === "revenue" ? s.revenue : ""} ${metric === key ? s.kpiSelected : ""}`}
                    aria-pressed={metric === key}
                  >
                    <span className={s.kpiLabel}>
                      <span className={s.kpiIcon}>
                        {["♧", "↗", "⌁", "✓", "R$"][index]}
                      </span>
                      {labels[key]}
                    </span>
                    <strong>
                      {ready(data, key) ? value(data.totals[key], key) : "—"}
                    </strong>
                    <small>
                      {ready(data, key)
                        ? delta(data.totals[key], data.previous[key])
                        : key === "clicks"
                          ? "Crie seu primeiro link"
                          : key === "visits"
                            ? "Conecte a medição do site"
                            : "Aguardando atribuição de compras"}
                    </small>
                  </button>
                ))}
              </div>
              <div className={s.chartGrid}>
                <Evolution data={data} metric={metric} setMetric={setMetric} />
                <div className={s.card}>
                  <div className={s.sectionTop}>
                    <div>
                      <span className={s.eyebrow}>JORNADA</span>
                      <h3>Do interesse à compra</h3>
                    </div>
                    <span className={s.smallIcon}>↗</span>
                  </div>
                  <p className={s.muted}>Etapas acompanhadas no período</p>
                  <div className={s.journey}>
                    {(["clicks", "visits", "sales"] as Metric[]).map(
                      (key, i) => (
                        <div key={key}>
                          <div>
                            <span>
                              <b className={s.step}>{i + 1}</b>
                              {key === "visits"
                                ? "Chegadas confirmadas"
                                : labels[key]}
                            </span>
                            <strong>
                              {ready(data, key)
                                ? number(data.totals[key])
                                : "—"}
                            </strong>
                          </div>
                          <div className={s.bar}>
                            <span
                              style={{
                                width:
                                  ready(data, key) && data.totals.clicks
                                    ? `${Math.min(100, (data.totals[key] / data.totals.clicks) * 100)}%`
                                    : "0%",
                                background: colors[key],
                              }}
                            />
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                  <div className={s.journeyFooter}>
                    <strong>
                      {data.totals.visits && data.totals.sales
                        ? money(data.totals.ticket)
                        : "Cada etapa tem sua medição"}
                    </strong>
                    <p>
                      {data.totals.visits && data.totals.sales
                        ? "Ticket médio das vendas atribuídas"
                        : "Cliques não são visitas. Visitas não são vendas."}
                    </p>
                  </div>
                </div>
              </div>
              <div className={s.sectionHeading}>
                <div>
                  <span className={s.eyebrow}>PRÓXIMOS PASSOS</span>
                  <h2>Onde vale agir agora</h2>
                </div>
                <span className={s.muted}>
                  Insights a partir dos seus dados
                </span>
              </div>
              <div className={s.insights}>
                <Insight
                  n="01"
                  category="MEDIÇÃO"
                  title={
                    !data.tracking.links
                      ? "Comece pelo seu catálogo"
                      : !data.tracking.installed
                        ? "Enxergue o que vem depois do clique"
                        : "Confira o resultado comercial"
                  }
                  text={
                    !data.tracking.links
                      ? "Crie um link para uma coleção ou oferta. Cada origem terá seus próprios resultados."
                      : !data.tracking.installed
                        ? "Ative a medição da loja para confirmar as chegadas e vincular os pedidos."
                        : `${data.totals.sales} vendas pagas atribuídas no período. ${data.totals.pending} pedidos aguardam pagamento.`
                  }
                  action={
                    !data.tracking.links
                      ? "Criar primeiro link"
                      : "Ver links e medição"
                  }
                  onClick={() =>
                    !data.tracking.links ? newLink() : go("links")
                  }
                />
                <Insight
                  n="02"
                  category="CONTEÚDO"
                  title={
                    data.links[0]?.clicks
                      ? `Interesse em ${data.links[0].name}`
                      : "Teste uma oferta de cada vez"
                  }
                  text={
                    data.links[0]?.clicks
                      ? `${data.links[0].clicks} cliques e ${data.links[0].sales} vendas neste link. Compare ofertas da mesma origem antes de ampliar a divulgação.`
                      : "Use links diferentes para catálogo, novidades e promoções. Assim você descobre o que desperta mais interesse."
                  }
                  action="Comparar links"
                  onClick={() => go("links")}
                />
                <Insight
                  n="03"
                  category="PÚBLICO"
                  title="Encontre sua próxima comunidade"
                  text="Explore fitness no atacado, biquínis e revendedoras. Compare o tamanho informado e a relação com o seu nicho."
                  action="Descobrir públicos"
                  onClick={() => go("discovery")}
                />
              </div>
              <LinkTable
                data={data}
                compact
                copy={copy}
                newLink={newLink}
                onToggle={toggle}
                busy={busy}
                details={() => go("links")}
              />
              <div className={s.bottomGrid}>
                <button
                  className={s.discoverBanner}
                  onClick={() => go("discovery")}
                >
                  <span className={s.eyebrow}>EXPANDA SEU ALCANCE</span>
                  <h3>
                    Seu próximo cliente pode estar
                    <br />
                    em uma nova comunidade.
                  </h3>
                  <p>Fitness atacado · Biquíni · Moda praia</p>
                  <span className={s.inlineLink}>
                    Explorar grupos e canais <Arrow />
                  </span>
                </button>
                <div className={s.card}>
                  <h3>O que estes números medem?</h3>
                  <ul className={s.definitions}>
                    <li>
                      <b>Público:</b> pessoas únicas com nova inclusão
                      confirmada pelo painel; entradas orgânicas não estão
                      incluídas.
                    </li>
                    <li>
                      <b>Cliques:</b> acessos aos seus links, com prévias e
                      robôs conhecidos filtrados. {number(data.totals.visitors)}{" "}
                      navegadores únicos no período.
                    </li>
                    <li>
                      <b>Vendas:</b> pedidos pagos confirmados na Tray, ligados
                      a um clique em até 30 dias pela sessão da loja ou por
                      referência verificada no Google Analytics. Cada pedido
                      é contado uma vez.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}
          {tab === "sources" && (
            <TelegramSources
              data={data}
              busy={busy}
              reconnect={() =>
                action(
                  "tray",
                  "growth/reconnect-tray",
                  {},
                  "Loja BFF reconectada. Agora você pode ativar o rastreamento e conferir as vendas.",
                )
              }
              install={() =>
                action(
                  "install",
                  "growth/install",
                  {},
                  "Rastreador registrado na loja Tray.",
                )
              }
              sync={() =>
                action("sync", "growth/sync", {}, "Pedidos conferidos na Tray.")
              }
            />
          )}
          {tab === "links" && (
            <div aria-busy={loading}>
              <div className={s.trackingCard}>
                <div>
                  <span className={s.eyebrow}>MEDIÇÃO DA LOJA</span>
                  <h3>
                    {data.tracking.installed
                      ? "Rastreador registrado na Tray"
                      : "Conecte os cliques às vendas"}
                  </h3>
                  <p>
                    {data.tracking.lastVisit
                      ? `Última chegada confirmada: ${stamp(data.tracking.lastVisit)}`
                      : "As visitas começam a aparecer quando alguém usa um link rastreado e a loja confirma a chegada."}
                  </p>
                  <small>
                    Última conferência de pedidos:{" "}
                    {stamp(data.tracking.syncedAt)}
                  </small>
                </div>
                <div className={s.trackingActions}>
                  {!data.tracking.installed && (
                    <button
                      className={s.primary}
                      disabled={!!busy || !data.tracking.trayConnected}
                      onClick={() =>
                        action(
                          "install",
                          "growth/install",
                          {},
                          "Rastreador registrado na loja Tray. As próximas chegadas poderão ser confirmadas.",
                        )
                      }
                    >
                      {busy === "install"
                        ? "Conectando…"
                        : "Conectar medição da loja"}
                    </button>
                  )}
                  <button
                    className={s.secondary}
                    disabled={!!busy || !data.tracking.trayConnected}
                    onClick={() =>
                      action(
                        "sync",
                        "growth/sync",
                        {},
                        "Pedidos conferidos na Tray. Os resultados foram atualizados.",
                      )
                    }
                  >
                    {busy === "sync"
                      ? "Conferindo pedidos…"
                      : "Sincronizar vendas"}
                  </button>
                  {!data.tracking.trayConnected && (
                    <a href="/conectar-tray">Conectar loja Tray →</a>
                  )}
                </div>
              </div>
              <LinkTable
                data={data}
                copy={copy}
                newLink={newLink}
                onToggle={toggle}
                busy={busy}
              />
              <details className={s.method}>
                <summary>
                  Como funciona a atribuição e quais são os limites?
                </summary>
                <p>
                  Janela de 30 dias. O painel usa o último clique confirmado
                  pela sessão da loja. Quando essa correlação não está
                  disponível, pode usar a referência assinada do link registrada
                  na compra do Google Analytics, após conferir o mesmo pedido e
                  horário na Tray. Cada pedido conta uma vez. Receita inclui o
                  total dos pedidos com pagamento confirmado pela Tray, com
                  frete e descontos. Cancelamentos são retirados na próxima
                  sincronização. Os pedidos são conferidos diariamente e pelo
                  botão acima.
                </p>
                <p>
                  Visitas são chegadas confirmadas uma vez por clique, não todas
                  as páginas vistas. O rastreador depende de JavaScript e da
                  sessão disponibilizada pelo tema da Tray. Troca de
                  dispositivo, bloqueadores ou checkout com outra sessão podem
                  impedir a atribuição. Links encaminhados continuam associados
                  à origem cadastrada. Links pausados abrem o destino sem gerar
                  novos eventos.
                </p>
                <p>
                  A comparação usa os {days} dias anteriores. O histórico começa
                  com o uso dos links; não há recuperação retroativa de cliques.
                  A leitura cobre até 1.000 pedidos recentes e até 80 consultas
                  de detalhes por sincronização e revisa até 20 pedidos antigos
                  já atribuídos, priorizando os menos recentemente conferidos; a
                  tela informa quando a cobertura é parcial.
                </p>
              </details>
            </div>
          )}
          {tab === "discovery" && (
            <TelegramDiscovery
              data={data}
              post={post}
              notify={setNotice}
              onChanged={reload}
              connect={() => go("community")}
              openCommunity={(sourceId, accountId) => {
                setPreparedSource((previous) => ({ id: sourceId, accountId, request: (previous?.request || 0) + 1 }));
                go("community");
              }}
            />
          )}
        </>
      )}
      <div hidden={tab !== "community"}>
        {communityOpened && <TelegramCommunity selection={preparedSource} />}
      </div>
      {data && tab !== "community" && (
        <footer className={s.footer}>
          <span>Dados próprios · Atualizado {stamp(data.updatedAt)}</span>
          <span>Telegram BFF Fitness</span>
        </footer>
      )}
      <dialog
        ref={dialog}
        className={s.dialog}
        aria-labelledby="tg-create-title"
      >
        <form onSubmit={create}>
          <div className={s.sectionTop}>
            <div>
              <span className={s.eyebrow}>NOVO RASTREAMENTO</span>
              <h2 id="tg-create-title">Criar link rastreado</h2>
            </div>
            <button
              type="button"
              aria-label="Fechar"
              className={s.close}
              onClick={() => dialog.current?.close()}
            >
              ×
            </button>
          </div>
          <p>Dê um nome à oferta e identifique onde você vai divulgá-la.</p>
          <label>
            Nome do link
            <input
              name="name"
              required
              maxLength={100}
              placeholder="Coleção fitness · novembro"
            />
          </label>
          <label>
            Link de destino
            <input
              name="destination"
              required
              type="url"
              placeholder="https://www.bfffitnessatacado.com.br/…"
              defaultValue="https://www.bfffitnessatacado.com.br/"
            />
          </label>
          <label>
            Grupo ou canal de origem
            <input
              name="sourceName"
              required
              maxLength={100}
              placeholder="Minha comunidade BFF"
              list="tg-sources"
            />
            <datalist id="tg-sources">
              {data?.sources.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </datalist>
          </label>
          <label>
            Campanha
            <input
              name="campaign"
              required
              maxLength={100}
              placeholder="Lançamento de verão"
            />
          </label>
          {error && (
            <p role="alert" className={s.error}>
              {error}
            </p>
          )}
          <div className={s.dialogActions}>
            <button
              type="button"
              className={s.secondary}
              onClick={() => dialog.current?.close()}
            >
              Cancelar
            </button>
            <button className={s.primary} disabled={!!busy}>
              {busy === "create" ? "Criando…" : "Criar link"}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
function Insight({
  n,
  category,
  title,
  text,
  action,
  onClick,
}: {
  n: string;
  category: string;
  title: string;
  text: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <article className={s.insight}>
      <div className={s.insightTop}>
        <span>{category}</span>
        <b>{n}</b>
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      <button className={s.textButton} onClick={onClick}>
        {action}
        <Arrow />
      </button>
    </article>
  );
}
function Evolution({
  data,
  metric,
  setMetric,
}: {
  data: Dashboard;
  metric: Metric;
  setMetric: (m: Metric) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const valid = ready(data, metric),
    maximum = Math.max(1, ...data.daily.map((d) => d[metric]));
  const points = data.daily.map(
    (d, i) =>
      `${42 + (i / Math.max(1, data.daily.length - 1)) * 658},${208 - (d[metric] / maximum) * 165}`,
  );
  const detail = hover !== null && data.daily[hover];
  return (
    <div className={s.card}>
      <div className={s.sectionTop}>
        <div>
          <span className={s.eyebrow}>ACOMPANHAMENTO</span>
          <h3>Evolução do Telegram</h3>
        </div>
        <strong style={{ color: colors[metric] }}>
          {valid ? value(data.totals[metric], metric) : "—"}
        </strong>
      </div>
      <div className={s.chartTabs} aria-label="Métrica do gráfico">
        {(Object.keys(labels) as Metric[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMetric(m);
              setHover(null);
            }}
            aria-pressed={metric === m}
            className={metric === m ? s.chartTabActive : ""}
          >
            {
              {
                audience: "Público",
                clicks: "Cliques",
                visits: "Visitas",
                sales: "Vendas",
                revenue: "Receita",
              }[m]
            }
          </button>
        ))}
      </div>
      <div className={s.chart}>
        <svg
          viewBox="0 0 728 245"
          role="img"
          aria-label={`${labels[metric]}: ${valid ? value(data.totals[metric], metric) : "medição indisponível"} no período`}
        >
          <defs>
            <linearGradient id="tg-chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors[metric]} stopOpacity=".16" />
              <stop offset="100%" stopColor={colors[metric]} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <line
                x1="42"
                x2="700"
                y1={43 + i * 55}
                y2={43 + i * 55}
                stroke="#e8edf3"
                strokeDasharray="4 5"
              />
              <text x="0" y={47 + i * 55} fill="#8993a4" fontSize="10">
                {number(maximum * (1 - i / 3))}
              </text>
            </g>
          ))}
          {valid && data.totals[metric] > 0 && (
            <>
              <polygon
                points={`${points.join(" ")} 700,208 42,208`}
                fill="url(#tg-chart-fill)"
              />
              <polyline
                points={points.join(" ")}
                fill="none"
                stroke={colors[metric]}
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              {data.daily.map((d, i) => (
                <circle
                  key={d.day}
                  cx={42 + (i / Math.max(1, data.daily.length - 1)) * 658}
                  cy={208 - (d[metric] / maximum) * 165}
                  r="9"
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${shortDate(d.day)}: ${value(d[metric], metric)}`}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>
                    {shortDate(d.day)}: {value(d[metric], metric)}
                  </title>
                </circle>
              ))}
            </>
          )}
          {[0, Math.floor((data.days - 1) / 2), data.days - 1].map((i) => (
            <text
              key={i}
              x={42 + (i / Math.max(1, data.daily.length - 1)) * 658}
              y="236"
              textAnchor={
                i === 0 ? "start" : i === data.days - 1 ? "end" : "middle"
              }
              fill="#8993a4"
              fontSize="11"
            >
              {shortDate(data.daily[i].day)}
            </text>
          ))}
        </svg>
        {(!valid || !data.totals[metric]) && (
          <div className={s.chartEmpty}>
            <span className={s.chartEmptyIcon}>⌁</span>
            <strong>
              {valid
                ? "Os primeiros resultados vão aparecer aqui"
                : "Uma etapa pronta para conectar"}
            </strong>
            <p>
              {valid
                ? "O gráfico será preenchido conforme os eventos forem registrados."
                : "Veja a aba Links e vendas para conectar a medição da loja."}
            </p>
          </div>
        )}
      </div>
      <div className={s.chartCaption} aria-live="polite">
        {detail
          ? `${shortDate(detail.day)} · ${labels[metric]}: ${value(detail[metric], metric)}`
          : "Valores por dia · passe o cursor ou use Tab nos pontos para explorar"}
      </div>
    </div>
  );
}
function LinkTable({
  data,
  compact,
  copy,
  newLink,
  onToggle,
  busy,
  details,
}: {
  data: Dashboard;
  compact?: boolean;
  copy: (s: string) => void;
  newLink: () => void;
  onToggle: (id: string, active: boolean) => void;
  busy: string;
  details?: () => void;
}) {
  const [sort, setSort] = useState<"revenue" | "clicks" | "sales">("revenue");
  const links = [...data.links]
    .sort((a, b) => b[sort] - a[sort] || b.clicks - a.clicks)
    .slice(0, compact ? 5 : undefined);
  return (
    <div className={s.card}>
      <div className={s.sectionTop}>
        <div>
          <span className={s.eyebrow}>PERFORMANCE</span>
          <h3>Links que geram resultado</h3>
        </div>
        <button className={s.textButton} onClick={compact ? details : newLink}>
          {compact ? "Ver todos os links" : "+ Novo link"}
          <Arrow />
        </button>
      </div>
      {!links.length ? (
        <div className={s.empty}>
          <span className={s.emptyIcon}>↗</span>
          <h3>Seu próximo link já pode ter resultado medido</h3>
          <p>
            Crie um link para o catálogo, uma coleção ou uma oferta e acompanhe
            o interesse por aqui.
          </p>
          <button className={s.primary} onClick={newLink}>
            Criar primeiro link
          </button>
        </div>
      ) : (
        <>
          <div className={s.tableTools}>
            <span>
              {data.links.length} link(s) · {data.source || "Todas as origens"}
            </span>
            <label>
              Ordenar por{" "}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
              >
                <option value="revenue">Receita</option>
                <option value="clicks">Cliques</option>
                <option value="sales">Vendas</option>
              </select>
            </label>
          </div>
          <div className={s.linkTable}>
            <div className={s.tableHeader}>
              <span>Link / origem</span>
              <span>Cliques</span>
              <span>Visitas</span>
              <span>Vendas</span>
              <span>Receita</span>
              <span>Ações</span>
            </div>
            {links.map((l) => (
              <article className={s.linkRow} key={l.id}>
                <div>
                  <strong>{l.name}</strong>
                  <small>
                    {l.sourceName} · {l.campaign}
                  </small>
                  <code>
                    {typeof window !== "undefined"
                      ? window.location.origin
                      : ""}
                    /t/{l.slug}
                  </code>
                  {!l.active && (
                    <span className={s.paused}>Medição pausada</span>
                  )}
                  <details className={s.linkDetails}>
                    <summary>Destino e campanha</summary>
                    <a
                      href={l.destination}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {l.destination}
                    </a>
                    <p>Campanha: {l.campaign}</p>
                  </details>
                </div>
                <div>
                  <span className={s.mobileLabel}>Cliques</span>
                  {number(l.clicks)}
                </div>
                <div>
                  <span className={s.mobileLabel}>Visitas</span>
                  {ready(data, "visits") ? number(l.visits) : "—"}
                </div>
                <div>
                  <span className={s.mobileLabel}>Vendas</span>
                  {ready(data, "sales") ? number(l.sales) : "—"}
                </div>
                <div className={s.linkRevenue}>
                  <span className={s.mobileLabel}>Receita</span>
                  {ready(data, "revenue") ? money(l.revenue) : "—"}
                </div>
                <div className={s.rowActions}>
                  <button
                    className={s.secondary}
                    onClick={() => copy(l.slug)}
                    aria-label={`Copiar link ${l.name}`}
                  >
                    Copiar
                  </button>
                  {!compact && (
                    <button
                      className={s.textButton}
                      disabled={!!busy}
                      onClick={() => onToggle(l.id, !l.active)}
                      aria-label={`${l.active ? "Pausar" : "Retomar"} medição de ${l.name}`}
                    >
                      {l.active ? "Pausar" : "Retomar"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
