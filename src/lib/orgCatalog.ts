/**
 * Catálogo único das 7 áreas e 36 papéis do hub — fonte da verdade portada
 * do protótipo original (Infuser Skilltree, `DEPTS` em app.js). Nomes,
 * hierarquia e contagens preservados: 6 managers (dentro de CEO) + 30
 * agentes = 36 papéis, distribuídos em Cliente, Engenharia, Finanças,
 * Jurídico, Receita e Growth.
 *
 * `tools` (ferramentas do dashboard de cada área) e `kpis` (indicadores
 * demonstrativos) são PROPOSTA nova — não existiam no protótipo original —
 * usados só pra montar o dashboard interno de cada área com dado de
 * demonstração coerente com os papéis reais, nunca como métrica real.
 */

export type PapelTipo = "MANAGER" | "AGENTE";

export interface Papel {
  id: string;
  label: string;
  icon: string;
  type: PapelTipo;
  title: string;
  desc: string;
  skills: string[];
}

export interface Area {
  id: string;
  name: string;
  sub: string;
  color: "lime" | "teal";
  icon: string;
  desc: string;
  focoDashboard: string;
  tools: string[];
  children: Papel[];
}

export const AREAS: Area[] = [
  {
    id: "ceo",
    name: "CEO",
    sub: "decisão · pesquisa · direção",
    color: "lime",
    icon: "sparkle",
    desc: "Direção estratégica, decisões finais e delegação para os managers.",
    focoDashboard: "Prioridades, decisões pendentes e visão entre áreas.",
    tools: ["Projetos estratégicos", "Delegações", "Acompanhamento dos managers", "Decisões"],
    children: [
      { id: "mgr-eng", label: "ENGENHARIA", icon: "brain", type: "MANAGER", title: "Manager de Produto e Engenharia", desc: "Converter delegações do CEO em arquitetura, planos de execução, gates de qualidade e entregas verificadas.", skills: ["planejamento", "arquitetura", "qa", "entregas"] },
      { id: "mgr-growth", label: "GROWTH", icon: "rocket", type: "MANAGER", title: "Manager de Growth", desc: "Transformar as prioridades do CEO em conteúdo, marca e distribuição com metas medidas semanalmente.", skills: ["conteúdo", "marca", "distribuição"] },
      { id: "mgr-receita", label: "RECEITA", icon: "trend", type: "MANAGER", title: "Manager de Receita", desc: "Orquestrar prospecção, diagnóstico e proposta até o fechamento, com pipeline auditável.", skills: ["pipeline", "diagnóstico", "proposta"] },
      { id: "mgr-cliente", label: "CLIENTE", icon: "hand", type: "MANAGER", title: "Manager de Cliente", desc: "Garantir ativação, implementação e sucesso do cliente do onboarding à retenção.", skills: ["onboarding", "delivery", "suporte"] },
      { id: "mgr-fin", label: "FINANÇAS", icon: "coins", type: "MANAGER", title: "Manager de Finanças", desc: "Controlar caixa, margem e cobrança e reportar o resultado ao CEO com previsibilidade.", skills: ["caixa", "margem", "cobrança"] },
      { id: "mgr-jur", label: "JURÍDICO", icon: "scale", type: "MANAGER", title: "Manager Jurídico", desc: "Proteger a operação com contratos, conformidade e governança revisadas antes de cada decisão.", skills: ["contratos", "compliance", "governança"] },
    ],
  },
  {
    id: "cliente",
    name: "CLIENTE",
    sub: "ativação · implementação · sucesso",
    color: "teal",
    icon: "hand",
    desc: "Todo o ciclo do cliente após a venda: onboarding, entrega, suporte e retenção.",
    focoDashboard: "Ativação, entregas, atendimento e retenção.",
    tools: ["Checklist de onboarding", "Entregas", "Tickets", "Base de conhecimento"],
    children: [
      { id: "onboarding", label: "ONBOARDING", icon: "bulb", type: "AGENTE", title: "Agente de Onboarding", desc: "Ativar o cliente nos primeiros 7 dias com configuração guiada, checklist e primeira entrega de valor.", skills: ["ativação", "checklist", "kickoff"] },
      { id: "delivery", label: "DELIVERY", icon: "box", type: "AGENTE", title: "Agente de Delivery", desc: "Executar o plano de implementação combinado, com status semanal e gates de aceite.", skills: ["implementação", "status", "aceite"] },
      { id: "suporte", label: "SUPORTE", icon: "headset", type: "AGENTE", title: "Agente de Suporte", desc: "Responder tickets, classificar por severidade e escalar incidentes para Engenharia.", skills: ["tickets", "sla", "escalonamento"] },
      { id: "conhecimento", label: "CONHECIMENTO", icon: "book", type: "AGENTE", title: "Agente de Conhecimento", desc: "Manter a base de conhecimento, tutoriais e respostas padrão sempre atualizadas.", skills: ["base de conhecimento", "tutoriais", "faq"] },
      { id: "retencao", label: "RETENÇÃO", icon: "heart", type: "AGENTE", title: "Agente de Retenção", desc: "Monitorar saúde da conta, prever churn e acionar planos de recuperação.", skills: ["health score", "churn", "renovação"] },
    ],
  },
  {
    id: "engenharia",
    name: "ENGENHARIA",
    sub: "arquitetura · código · segurança",
    color: "lime",
    icon: "brain",
    desc: "Construção e operação do produto: arquitetura, código, qualidade e infraestrutura.",
    focoDashboard: "Projetos, entregas técnicas e qualidade.",
    tools: ["Tarefas", "Versões", "Revisões", "Incidentes", "Documentação"],
    children: [
      { id: "arquitetura", label: "ARQUITETURA", icon: "layers", type: "AGENTE", title: "Agente de Arquitetura", desc: "Desenhar a solução técnica, contratos de API e decisões registradas antes de codar.", skills: ["adr", "api", "modelagem"] },
      { id: "backend", label: "BACKEND", icon: "server", type: "AGENTE", title: "Agente de Backend", desc: "Implementar serviços, integrações e regras de negócio com testes automatizados.", skills: ["serviços", "integrações", "testes"] },
      { id: "frontend", label: "FRONTEND", icon: "code", type: "AGENTE", title: "Agente de Frontend", desc: "Construir interfaces acessíveis e responsivas a partir das especificações de produto.", skills: ["ui", "acessibilidade", "performance"] },
      { id: "qa", label: "QA", icon: "check", type: "AGENTE", title: "Agente de Qualidade", desc: "Rodar os gates de qualidade, testes de regressão e validação visual antes do deploy.", skills: ["regressão", "validação", "gates"] },
      { id: "seguranca", label: "SEGURANÇA", icon: "shield", type: "AGENTE", title: "Agente de Segurança", desc: "Auditar dependências, segredos e permissões; bloquear entregas fora do padrão.", skills: ["auditoria", "segredos", "permissões"] },
      { id: "devops", label: "DEVOPS", icon: "db", type: "AGENTE", title: "Agente de DevOps", desc: "Manter pipelines, ambientes e observabilidade com rollback pronto.", skills: ["ci/cd", "infra", "observabilidade"] },
      { id: "dados", label: "DADOS", icon: "db", type: "AGENTE", title: "Agente de Dados", desc: "Modelar dados, manter o warehouse e entregar métricas confiáveis aos departamentos.", skills: ["warehouse", "métricas", "pipelines"] },
    ],
  },
  {
    id: "financas",
    name: "FINANÇAS",
    sub: "caixa · margem · cobrança",
    color: "teal",
    icon: "coins",
    desc: "Faturamento, controladoria, planejamento e cobrança.",
    focoDashboard: "Caixa, faturamento, margem e pendências.",
    tools: ["Conciliação", "Planejamento", "Cobranças", "Documentos financeiros"],
    children: [
      { id: "faturamento", label: "FATURAMENTO", icon: "receipt", type: "AGENTE", title: "Agente de Faturamento", desc: "Emitir notas, conciliar recebimentos e fechar o faturamento diário sem pendências.", skills: ["nf-e", "conciliação", "fechamento"] },
      { id: "controladoria", label: "CONTROLADORIA", icon: "calc", type: "AGENTE", title: "Agente de Controladoria", desc: "Acompanhar margem, custo e DRE com alertas quando a meta do mês sai do trilho.", skills: ["dre", "margem", "custos"] },
      { id: "planejamento", label: "PLANEJAMENTO", icon: "calendar", type: "AGENTE", title: "Agente de Planejamento", desc: "Projetar fluxo de caixa a 30/60/90 dias e recomendar o teto de gastos.", skills: ["fluxo de caixa", "projeção", "orçamento"] },
      { id: "cobranca", label: "COBRANÇA", icon: "card", type: "AGENTE", title: "Agente de Cobrança", desc: "Acionar inadimplentes por régua de cobrança e reportar recuperação semanal.", skills: ["régua", "inadimplência", "recuperação"] },
    ],
  },
  {
    id: "juridico",
    name: "JURÍDICO",
    sub: "financeiro · jurídico · governança",
    color: "teal",
    icon: "scale",
    desc: "Contratos, tributário, previdenciário e conformidade.",
    focoDashboard: "Contratos, obrigações, consultas e respectivos prazos.",
    tools: ["Documentos versionados", "Agenda", "Acompanhamento de demandas"],
    children: [
      { id: "contratos", label: "CONTRATOS", icon: "file", type: "AGENTE", title: "Agente de Contratos", desc: "Redigir, revisar e versionar contratos com cláusulas padrão e alertas de risco.", skills: ["minutas", "revisão", "risco"] },
      { id: "tributario", label: "TRIBUTÁRIO", icon: "percent", type: "AGENTE", title: "Agente Tributário", desc: "Acompanhar obrigações fiscais, enquadramento e prazos de entrega.", skills: ["obrigações", "prazos", "enquadramento"] },
      { id: "previdenciario", label: "PREVIDENCIÁRIO", icon: "umbrella", type: "AGENTE", title: "Agente Previdenciário", desc: "Garantir conformidade trabalhista e previdenciária de contratos e rescisões.", skills: ["trabalhista", "rescisões", "conformidade"] },
      { id: "consultivo", label: "CONSULTIVO", icon: "gavel", type: "AGENTE", title: "Agente Consultivo", desc: "Responder consultas internas com parecer objetivo e base normativa vigente.", skills: ["pareceres", "normas", "governança"] },
    ],
  },
  {
    id: "receita",
    name: "RECEITA",
    sub: "prospecção · diagnóstico · proposta",
    color: "teal",
    icon: "trend",
    desc: "Pipeline comercial da prospecção ao fechamento.",
    focoDashboard: "Pipeline comercial, oportunidades e propostas.",
    tools: ["Leads", "Etapas de negociação", "Propostas", "Parcerias"],
    children: [
      { id: "prospeccao", label: "PROSPECÇÃO", icon: "search", type: "AGENTE", title: "Agente de Prospecção", desc: "Mapear contas-alvo, qualificar leads e agendar as primeiras conversas.", skills: ["icp", "qualificação", "agenda"] },
      { id: "diagnostico", label: "DIAGNÓSTICO", icon: "target", type: "AGENTE", title: "Agente de Diagnóstico", desc: "Conduzir a descoberta, levantar dores e dimensionar o problema do cliente.", skills: ["discovery", "dores", "escopo"] },
      { id: "proposta", label: "PROPOSTA", icon: "pen", type: "AGENTE", title: "Agente de Proposta", desc: "Montar a proposta comercial com escopo, preço e condições aprovadas.", skills: ["proposta", "preço", "condições"] },
      { id: "fechamento", label: "FECHAMENTO", icon: "handshake", type: "AGENTE", title: "Agente de Fechamento", desc: "Negociar, contornar objeções e formalizar o contrato com o Jurídico.", skills: ["negociação", "objeções", "contrato"] },
      { id: "parcerias", label: "PARCERIAS", icon: "users", type: "AGENTE", title: "Agente de Parcerias", desc: "Ativar e gerir parceiros de indicação e canais de revenda.", skills: ["canais", "indicação", "revenda"] },
    ],
  },
  {
    id: "growth",
    name: "GROWTH",
    sub: "conteúdo · marca · distribuição",
    color: "teal",
    icon: "rocket",
    desc: "Conteúdo, marca, distribuição e aquisição paga.",
    focoDashboard: "Conteúdo, distribuição, aquisição e resultados.",
    tools: ["Calendário editorial", "Campanhas", "Criativos", "SEO", "Mídia paga"],
    children: [
      { id: "conteudo", label: "CONTEÚDO", icon: "pen", type: "AGENTE", title: "Agente de Conteúdo", desc: "Produzir artigos, roteiros e posts a partir da fila editorial priorizada.", skills: ["editorial", "roteiros", "seo"] },
      { id: "marca", label: "MARCA", icon: "star", type: "AGENTE", title: "Agente de Marca", desc: "Manter identidade, tom de voz e consistência visual em todos os canais.", skills: ["identidade", "tom de voz", "guidelines"] },
      { id: "distribuicao", label: "DISTRIBUIÇÃO", icon: "share", type: "AGENTE", title: "Agente de Distribuição", desc: "Programar e distribuir conteúdo nos canais certos, medindo alcance por peça.", skills: ["calendário", "canais", "alcance"] },
      { id: "seo", label: "SEO", icon: "globe", type: "AGENTE", title: "Agente de SEO", desc: "Pesquisar palavras-chave, otimizar páginas e acompanhar posições semanalmente.", skills: ["keywords", "on-page", "ranking"] },
      { id: "paid", label: "PAID", icon: "ad", type: "AGENTE", title: "Agente de Mídia Paga", desc: "Operar campanhas, criativos e orçamento com ROAS como métrica de decisão.", skills: ["campanhas", "criativos", "roas"] },
    ],
  },
];

export function getArea(areaId: string): Area | undefined {
  return AREAS.find((a) => a.id === areaId);
}

export function getPapel(areaId: string, papelId: string): { area: Area; papel: Papel } | undefined {
  const area = getArea(areaId);
  const papel = area?.children.find((c) => c.id === papelId);
  if (!area || !papel) return undefined;
  return { area, papel };
}

export interface RegistroBusca {
  kind: "ÁREA" | "PAPEL";
  label: string;
  sub: string;
  areaId: string;
  papelId?: string;
}

/** Catálogo achatado pra busca global — 7 áreas + 36 papéis = 43 registros. */
export const CATALOGO_BUSCA: RegistroBusca[] = AREAS.flatMap((area) => [
  { kind: "ÁREA" as const, label: area.name, sub: area.sub, areaId: area.id },
  ...area.children.map((p) => ({
    kind: "PAPEL" as const,
    label: p.title,
    sub: `${area.name} · ${p.type}`,
    areaId: area.id,
    papelId: p.id,
  })),
]);

export const TOTAL_PAPEIS = AREAS.reduce((s, a) => s + a.children.length, 0);
export const TOTAL_MANAGERS = AREAS[0].children.length;
export const TOTAL_AGENTES = TOTAL_PAPEIS - TOTAL_MANAGERS;
