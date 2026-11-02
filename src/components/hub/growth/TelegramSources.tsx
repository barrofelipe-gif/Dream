"use client";
import type { Dashboard } from "./TelegramDashboard";
import s from "./telegram-dashboard.module.css";

const n = (v: number) =>
  v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export default function TelegramSources({
  data,
  busy,
  reconnect,
  install,
  sync,
}: {
  data: Dashboard;
  busy: string;
  reconnect: () => void;
  install: () => void;
  sync: () => void;
}) {
  const ga = data.analytics;
  return (
    <div>
      <div className={s.sourcesGrid}>
        <article className={s.card}>
          <div className={s.sectionTop}>
            <h3>Loja Tray</h3>
            <span
              className={
                data.tracking.trayConnected
                  ? s.sourceConnected
                  : s.sourcePending
              }
            >
              {data.tracking.trayConnected ? "Conectada" : "Reconectar"}
            </span>
          </div>
          <p className={s.sourceDescription}>
            Confirma pagamentos e atualiza as vendas atribuídas aos seus links.
          </p>
          <dl className={s.sourceFacts}>
            <div>
              <dt>Conta da loja</dt>
              <dd>
                {data.tracking.trayConnected
                  ? "BFF Fitness"
                  : "Conexão pendente"}
              </dd>
            </div>
            <div>
              <dt>Rastreador do site</dt>
              <dd>
                {data.tracking.installed
                  ? "Ativo na loja"
                  : "Aguardando ativação"}
              </dd>
            </div>
            <div>
              <dt>Conferência Google + Tray</dt>
              <dd>
                {data.tracking.gaAttribution?.status === "ready"
                  ? "Disponível"
                  : data.tracking.gaAttribution?.status === "unavailable"
                    ? "Consulta indisponível"
                    : "Aguardando conferência"}
              </dd>
            </div>
            <div>
              <dt>Último teste do rastreador</dt>
              <dd>
                {data.tracking.lastTestAt
                  ? new Date(data.tracking.lastTestAt).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                      dateStyle: "short",
                      timeStyle: "short",
                    })
                  : "Ainda não realizado"}
              </dd>
            </div>
          </dl>
          <div className={s.sourceActions}>
            {!data.tracking.trayConnected ? (
              data.tracking.canRestoreTray ? (
                <button
                  className={s.primary}
                  disabled={!!busy}
                  onClick={reconnect}
                >
                  {busy === "tray" ? "Reconectando…" : "Reconectar loja BFF"}
                </button>
              ) : (
                <a className={s.primary} href="/conectar-tray">
                  Conectar loja Tray
                </a>
              )
            ) : (
              <>
                {data.tracking.installed && data.tracking.testUrl && (
                  <a
                    className={s.secondary}
                    href={data.tracking.testUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Testar rastreamento ↗
                  </a>
                )}
                {!data.tracking.installed && (
                  <button
                    className={s.primary}
                    disabled={!!busy}
                    onClick={install}
                  >
                    {busy === "install" ? "Ativando…" : "Ativar rastreamento"}
                  </button>
                )}
                <button
                  className={s.secondary}
                  disabled={!!busy}
                  onClick={sync}
                >
                  {busy === "sync" ? "Conferindo…" : "Conferir vendas"}
                </button>
              </>
            )}
          </div>
        </article>
        <article className={s.card}>
          <div className={s.sectionTop}>
            <h3>Google Analytics 4</h3>
            <span
              className={ga.connected ? s.sourceConnected : s.sourcePending}
            >
              {ga.connected
                ? "Conectado"
                : ga.configured
                  ? "Consulta indisponível"
                  : "Configuração pendente"}
            </span>
          </div>
          <p className={s.sourceDescription}>
            Propriedade BFF Fitness Atacado. Consulta somente leitura para
            acompanhar as sessões e compras registradas com origem Telegram.
          </p>
          <dl className={s.sourceFacts}>
            <div>
              <dt>Propriedade</dt>
              <dd>{ga.propertyId}</dd>
            </div>
            <div>
              <dt>Origem consultada</dt>
              <dd>Telegram e referências t.me</dd>
            </div>
            <div>
              <dt>Fuso da propriedade</dt>
              <dd>{ga.timeZone || "Não informado"}</dd>
            </div>
            <div>
              <dt>Última verificação</dt>
              <dd>
                {new Date(ga.checkedAt).toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </dd>
            </div>
          </dl>
          {ga.error && <p className={s.warning}>{ga.error}</p>}
        </article>
        <article className={s.card}>
          <div className={s.sectionTop}>
            <h3>Solomon</h3>
            <span className={s.sourcePending}>Sincronização pendente</span>
          </div>
          <p className={s.sourceDescription}>
            A Solomon ainda não está sincronizando dados com este painel. O
            serviço de consulta está indisponível. Tray e Google Analytics
            continuam disponíveis.
          </p>
          <div className={s.sourceActions}>
            <a
              className={s.secondary}
              href="https://analytics.solomon.com.br/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir Solomon ↗
            </a>
          </div>
        </article>
      </div>
      <article className={s.card} style={{ marginTop: 20 }}>
        <div className={s.sectionTop}>
          <div>
            <span className={s.eyebrow}>GOOGLE ANALYTICS · TELEGRAM</span>
            <h3>Resultados registrados no site</h3>
          </div>
          <span className={s.muted}>
            {data.source || "Todas as origens Telegram"} ·{" "}
            {ga.from.split("-").reverse().join("/")} a{" "}
            {ga.to.split("-").reverse().join("/")}
          </span>
        </div>
        <div className={s.gaMetrics}>
          {[
            ["Sessões no site", ga.sessions],
            ["Compras registradas", ga.purchases],
            ["Receita registrada", ga.revenue],
          ].map(([label, value], i) => (
            <div key={String(label)}>
              <span>{label}</span>
              <strong>
                {ga.connected
                  ? i === 2
                    ? brl(Number(value))
                    : n(Number(value))
                  : "—"}
              </strong>
              <small>
                {i === 0
                  ? "Origem Telegram no GA4"
                  : "Eventos de compra do GA4"}
              </small>
            </div>
          ))}
        </div>
        {ga.partial && (
          <p className={s.warning}>
            O Google informou limitação de cobertura, amostragem ou privacidade
            neste relatório. Os valores podem ser parciais.
          </p>
        )}
        <p className={s.sourceDescription}>
          Estes números seguem a atribuição e o processamento do Google
          Analytics, no fuso {ga.timeZone || "configurado na propriedade"}. O
          dia de hoje é parcial e o Google pode processar os eventos com atraso;
          consultas ficam em cache por até cinco minutos. Compras registradas no
          GA4 não comprovam pagamento. A confirmação de vendas pagas continua
          vindo da Tray. As duas fontes são exibidas separadamente e não são
          somadas.
        </p>
        {data.source && (
          <p className={s.sourceDescription}>
            O filtro desta origem usa os links rastreados cadastrados no painel.
            Tráfego antigo sem identificação do link não entra nesta seleção.
          </p>
        )}
        {!!ga.daily.length && (
          <details className={s.method}>
            <summary>Ver evolução diária no Google Analytics</summary>
            <div className={s.gaDaily}>
              <div>
                <b>Dia</b>
                <b>Sessões</b>
                <b>Compras</b>
                <b>Receita</b>
              </div>
              {ga.daily.map((d) => (
                <div key={d.day}>
                  <span>{d.day.split("-").reverse().join("/")}</span>
                  <span>{n(d.sessions)}</span>
                  <span>{n(d.purchases)}</span>
                  <span>{brl(d.revenue)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </article>
    </div>
  );
}
