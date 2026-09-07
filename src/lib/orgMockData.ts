import type { Area } from "@/lib/orgCatalog";

/**
 * Dado de DEMONSTRAÇÃO para o dashboard interno de cada área — não vem de
 * nenhuma fonte real. Decisão explícita: entregar o fluxo (cérebro → login →
 * hub → área → dashboard) primeiro, conectar dado de verdade depois, área
 * por área. Por isso todo número aqui é claramente rotulado como
 * demonstração na tela (ver AreaDashboard) — o problema encontrado no
 * protótipo original foi exatamente números fixos (ex: "100% certificado")
 * aparentando ser métrica real sem dizer que não é.
 *
 * Determinístico por `area.id` (hash simples), não `Math.random()`: assim o
 * server e o client renderizam o mesmo número e não há erro de hidratação.
 */

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function rngFrom(seed: string) {
  let s = hashSeed(seed) || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export interface KpiDemo {
  label: string;
  valor: string;
  variacao: string;
}

export interface ProjetoDemo {
  nome: string;
  cliente: string;
  status: "Em andamento" | "Em revisão" | "Concluído";
  atualizado: string;
}

export interface TarefaDemo {
  titulo: string;
  feita: boolean;
}

export interface MensagemDemo {
  nome: string;
  resumo: string;
  quando: string;
}

export interface AreaDashboardDemo {
  kpis: KpiDemo[];
  progresso: number[]; // 6 pontos, últimos 6 meses
  projetos: ProjetoDemo[];
  tarefas: TarefaDemo[];
  mensagens: MensagemDemo[];
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun"];

export function gerarDashboardDemo(area: Area): AreaDashboardDemo {
  const rnd = rngFrom(area.id);
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));

  const kpis: KpiDemo[] = [
    { label: "Itens ativos", valor: String(int(3, 24)), variacao: `+${int(5, 30)}%` },
    { label: "Concluídos (mês)", valor: String(int(8, 60)), variacao: `+${int(5, 40)}%` },
    { label: "Papéis na área", valor: String(area.children.length), variacao: "" },
    { label: "Pendências", valor: String(int(0, 9)), variacao: `${int(-20, 10)}%` },
  ];

  const progresso = Array.from({ length: 6 }, () => int(4, 22));

  const projetos: ProjetoDemo[] = area.children.slice(0, 3).map((papel, i) => ({
    nome: `${papel.title.replace(/^Agente( de| do| Consultivo| Tributário| Previdenciário)?/, papel.label).trim()}`,
    cliente: papel.skills[0] ?? area.name,
    status: (["Em andamento", "Em revisão", "Concluído"] as const)[i % 3],
    atualizado: `há ${int(1, 5)} ${i % 2 === 0 ? "horas" : "dias"}`,
  }));

  const tarefas: TarefaDemo[] = area.children.slice(0, 5).map((papel, i) => ({
    titulo: `${papel.skills[0] ?? papel.label.toLowerCase()} — ${papel.label.toLowerCase()}`,
    feita: i === 0,
  }));

  const mensagens: MensagemDemo[] = [
    { nome: `${area.children[0]?.title ?? area.name}`, resumo: "Atualização de status disponível.", quando: "10:24" },
    { nome: `${area.children[1]?.title ?? area.name}`, resumo: "Precisa de aprovação pra seguir.", quando: "ontem" },
  ];

  return {
    kpis,
    progresso,
    projetos,
    tarefas,
    mensagens,
  };
}

export const MESES_GRAFICO = MESES;

/**
 * Sinal de "tem pendência" por papel — pedido do usuário: o nó do papel
 * pisca vermelho no mapa mental quando tem algo pendente ali, tipo um alerta
 * ("dor de cabeça"). Por enquanto é demonstração (~1 em cada 5 papéis,
 * determinístico pelo id — não muda a cada reload), até decidirmos de qual
 * fonte real puxar pendência por papel (o painel de pendências atual não
 * tem esse vínculo por área/papel ainda).
 */
export function papelTemPendencia(papelId: string): boolean {
  return hashSeed(papelId) % 5 === 0;
}
