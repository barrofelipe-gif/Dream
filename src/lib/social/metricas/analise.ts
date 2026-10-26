/**
 * Análise das métricas (funções puras: recebem linhas do banco e devolvem o resumo que a tela mostra).
 * O melhor horário é calculado com o histórico REAL de postagens da conta, porque a Meta não fornece mais
 * o horário de pico dos seguidores (online_followers saiu da API em 24/09/2024).
 */
import { TIPOS_POST, type TipoPost } from "./types";

export type PostLinha = {
  externoId: string;
  tipo: string;
  legenda: string;
  permalink: string | null;
  miniatura: string | null;
  publicadoEm: Date | string;
  hora: number;
  diaSemana: number;
  alcance: number;
  visualizacoes: number;
  curtidas: number;
  comentarios: number;
  compartilhamentos: number;
  salvamentos: number;
  interacoes: number;
  cliquesLinkBio: number;
  visitasPerfil?: number;
  seguidoresGanhos?: number;
};

export type DiaLinha = {
  data: Date | string;
  alcance: number;
  visualizacoes: number;
  visitasPerfil: number;
  toquesLink: number;
  contasEngajadas: number;
  interacoes: number;
  seguidores: number | null;
};

export const NOMES_DIA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
export const NOMES_DIA_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const NOMES_FORMATO: Record<TipoPost, string> = { foto: "Foto", reel: "Reel", carrossel: "Carrossel", story: "Story" };

/** Amostra mínima (postagens) para uma hora ou dia entrar no "melhor/pior". */
export const AMOSTRA_MINIMA = 3;
/** Abaixo disso o resultado é só um palpite. */
export const AMOSTRA_CONFIAVEL = 20;

const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const media = (xs: number[]) => (xs.length ? soma(xs) / xs.length : 0);
const arred = (n: number, c = 1) => Math.round(n * 10 ** c) / 10 ** c;
const hh = (h: number) => `${String(h).padStart(2, "0")}h`;

export type Balde = { n: number; alcanceMedio: number; interacoesMedia: number; cliquesBioMedio: number; salvamentosMedio: number };
function resumirBalde(ps: PostLinha[]): Balde {
  return {
    n: ps.length,
    alcanceMedio: arred(media(ps.map((p) => p.alcance)), 0),
    interacoesMedia: arred(media(ps.map((p) => p.interacoes)), 1),
    cliquesBioMedio: arred(media(ps.map((p) => p.cliquesLinkBio)), 2),
    salvamentosMedio: arred(media(ps.map((p) => p.salvamentos)), 1),
  };
}

export type ResultadoHorario = {
  /** Postagens usadas (feed + reels; stories ficam de fora porque somem em 24h e distorcem). */
  totalPostagens: number;
  amostraPequena: boolean;
  mapa: Balde[][]; // [diaSemana 0-6][hora 0-23]
  porHora: (Balde & { hora: number })[];
  porDia: (Balde & { diaSemana: number })[];
  melhorHora: (Balde & { hora: number }) | null;
  piorHora: (Balde & { hora: number }) | null;
  melhorDia: (Balde & { diaSemana: number }) | null;
  piorDia: (Balde & { diaSemana: number }) | null;
  melhorCombinacao: (Balde & { diaSemana: number; hora: number }) | null;
  melhorHoraLinkBio: (Balde & { hora: number }) | null;
  frase: string;
  avisos: string[];
};

export function analisarHorario(posts: PostLinha[]): ResultadoHorario {
  const base = posts.filter((p) => p.tipo !== "story");
  const mapa: Balde[][] = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => resumirBalde(base.filter((p) => p.diaSemana === d && p.hora === h))));
  const porHora = Array.from({ length: 24 }, (_, hora) => ({ hora, ...resumirBalde(base.filter((p) => p.hora === hora)) }));
  const porDia = Array.from({ length: 7 }, (_, diaSemana) => ({ diaSemana, ...resumirBalde(base.filter((p) => p.diaSemana === diaSemana)) }));

  const elegiveis = <T extends Balde>(xs: T[]) => xs.filter((x) => x.n >= AMOSTRA_MINIMA);
  const melhor = <T extends Balde>(xs: T[]) => [...elegiveis(xs)].sort((a, b) => b.alcanceMedio - a.alcanceMedio || b.interacoesMedia - a.interacoesMedia)[0] ?? null;
  const pior = <T extends Balde>(xs: T[]) => {
    const e = elegiveis(xs);
    return e.length > 1 ? [...e].sort((a, b) => a.alcanceMedio - b.alcanceMedio)[0] : null;
  };
  const melhorHora = melhor(porHora);
  const piorHora = pior(porHora);
  const melhorDia = melhor(porDia);
  const piorDia = pior(porDia);
  const celulas = mapa.flatMap((linha, diaSemana) => linha.map((b, hora) => ({ diaSemana, hora, ...b })));
  const melhorCombinacao = [...celulas.filter((c) => c.n >= 2)].sort((a, b) => b.alcanceMedio - a.alcanceMedio)[0] ?? null;
  const melhorHoraLinkBio = [...elegiveis(porHora).filter((h) => h.cliquesBioMedio > 0)].sort((a, b) => b.cliquesBioMedio - a.cliquesBioMedio)[0] ?? null;

  const avisos: string[] = [];
  const amostraPequena = base.length < AMOSTRA_CONFIAVEL;
  if (base.length === 0) avisos.push("Ainda não há postagens coletadas.");
  else if (amostraPequena) avisos.push(`Amostra pequena: só ${base.length} postagens no histórico. Trate como palpite e refaça a conta quando passar de ${AMOSTRA_CONFIAVEL}.`);
  avisos.push("A Meta não informa mais o horário de pico dos seguidores. Esta resposta vem do desempenho real das suas postagens por hora e dia da semana.");

  let frase: string;
  if (!melhorHora && !melhorDia) {
    frase = base.length
      ? `Ainda não dá para recomendar um horário: nenhuma hora ou dia tem ${AMOSTRA_MINIMA} postagens ou mais no histórico. Poste em horários variados por algumas semanas para o painel aprender.`
      : "Sem postagens coletadas ainda. Clique em Atualizar dados.";
  } else {
    const partes: string[] = [];
    if (melhorDia) partes.push(`o melhor dia é ${NOMES_DIA[melhorDia.diaSemana]} (alcance médio de ${melhorDia.alcanceMedio.toLocaleString("pt-BR")} em ${melhorDia.n} postagens)`);
    if (melhorHora) partes.push(`a melhor hora é ${hh(melhorHora.hora)} (alcance médio de ${melhorHora.alcanceMedio.toLocaleString("pt-BR")} em ${melhorHora.n} postagens)`);
    frase = `Pelo seu histórico, ${partes.join(" e ")}.`;
    const ruins: string[] = [];
    if (piorDia && piorDia.diaSemana !== melhorDia?.diaSemana) ruins.push(`${NOMES_DIA[piorDia.diaSemana]} (${piorDia.alcanceMedio.toLocaleString("pt-BR")}, ${piorDia.n} postagens)`);
    if (piorHora && piorHora.hora !== melhorHora?.hora) ruins.push(`${hh(piorHora.hora)} (${piorHora.alcanceMedio.toLocaleString("pt-BR")}, ${piorHora.n} postagens)`);
    if (ruins.length) frase += ` O pior desempenho aparece em ${ruins.join(" e ")}.`;
    if (melhorCombinacao && melhorCombinacao.n >= 2)
      frase += ` Melhor combinação: ${NOMES_DIA[melhorCombinacao.diaSemana]} às ${hh(melhorCombinacao.hora)} (${melhorCombinacao.n} postagens).`;
  }
  return { totalPostagens: base.length, amostraPequena, mapa, porHora, porDia, melhorHora, piorHora, melhorDia, piorDia, melhorCombinacao, melhorHoraLinkBio, frase, avisos };
}

export type LinhaFormato = {
  tipo: TipoPost;
  rotulo: string;
  n: number;
  alcanceMedio: number;
  visualizacoesMedia: number;
  /** interações / alcance (soma sobre soma, para não distorcer com posts pequenos). */
  taxaEngajamento: number;
  salvamentosMedio: number;
  compartilhamentosMedio: number;
  cliquesBioMedio: number;
};
export type ResultadoFormatos = { ranking: LinhaFormato[]; frase: string; amostraPequena: boolean };

export function analisarFormatos(posts: PostLinha[]): ResultadoFormatos {
  const ranking: LinhaFormato[] = TIPOS_POST.map((tipo) => {
    const ps = posts.filter((p) => p.tipo === tipo);
    const alc = soma(ps.map((p) => p.alcance));
    return {
      tipo,
      rotulo: NOMES_FORMATO[tipo],
      n: ps.length,
      alcanceMedio: arred(media(ps.map((p) => p.alcance)), 0),
      visualizacoesMedia: arred(media(ps.map((p) => p.visualizacoes)), 0),
      taxaEngajamento: alc ? arred((soma(ps.map((p) => p.interacoes)) / alc) * 100, 2) : 0,
      salvamentosMedio: arred(media(ps.map((p) => p.salvamentos)), 1),
      compartilhamentosMedio: arred(media(ps.map((p) => p.compartilhamentos)), 1),
      cliquesBioMedio: arred(media(ps.map((p) => p.cliquesLinkBio)), 2),
    };
  })
    .filter((l) => l.n > 0)
    .sort((a, b) => b.alcanceMedio - a.alcanceMedio);

  const elegiveis = ranking.filter((l) => l.n >= 2);
  let frase = "Sem postagens suficientes para comparar formatos.";
  if (elegiveis.length) {
    const topo = elegiveis[0];
    const eng = [...elegiveis].sort((a, b) => b.taxaEngajamento - a.taxaEngajamento)[0];
    frase = `${topo.rotulo} alcança mais gente (média de ${topo.alcanceMedio.toLocaleString("pt-BR")} por postagem, ${topo.n} postagens).`;
    if (eng.tipo !== topo.tipo) frase += ` ${eng.rotulo} engaja mais em proporção ao alcance (${eng.taxaEngajamento.toLocaleString("pt-BR")}%).`;
    const bio = [...elegiveis].filter((l) => l.cliquesBioMedio > 0).sort((a, b) => b.cliquesBioMedio - a.cliquesBioMedio)[0];
    if (bio) frase += ` Quem mais leva ao link da bio: ${bio.rotulo} (${bio.cliquesBioMedio.toLocaleString("pt-BR")} cliques por postagem).`;
  }
  return { ranking, frase, amostraPequena: posts.length < AMOSTRA_CONFIAVEL };
}

export function topPostagens(posts: PostLinha[], n = 10) {
  return [...posts]
    .sort((a, b) => b.alcance - a.alcance || b.interacoes - a.interacoes)
    .slice(0, n)
    .map((p) => ({ ...p, publicadoEm: new Date(p.publicadoEm).toISOString(), taxaEngajamento: p.alcance ? arred((p.interacoes / p.alcance) * 100, 2) : 0 }));
}

const iso = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export function evolucaoDiaria(dias: DiaLinha[]) {
  return [...dias]
    .sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime())
    .map((d) => ({
      data: iso(d.data),
      alcance: d.alcance,
      visualizacoes: d.visualizacoes,
      toquesLink: d.toquesLink,
      visitasPerfil: d.visitasPerfil,
      interacoes: d.interacoes,
    }));
}

export function totaisPeriodo(dias: DiaLinha[]) {
  const ordenados = [...dias].sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());
  const comSeg = ordenados.filter((d) => d.seguidores != null);
  return {
    alcance: soma(dias.map((d) => d.alcance)),
    visualizacoes: soma(dias.map((d) => d.visualizacoes)),
    toquesLink: soma(dias.map((d) => d.toquesLink)),
    visitasPerfil: soma(dias.map((d) => d.visitasPerfil)),
    interacoes: soma(dias.map((d) => d.interacoes)),
    seguidores: comSeg.length ? (comSeg[comSeg.length - 1].seguidores as number) : null,
    diasComDados: dias.length,
  };
}

type ItemDemo = { chave: string; valor: number };
export type GrupoPublico = {
  idade: (ItemDemo & { pct: number })[];
  genero: (ItemDemo & { pct: number })[];
  cidades: (ItemDemo & { pct: number })[];
  paises: (ItemDemo & { pct: number })[];
};
export type ResumoPublico = {
  coletadoEm: string;
  seguidores: GrupoPublico;
  engajados: GrupoPublico;
  alcancados: GrupoPublico;
  avisos: string[];
} | null;

const NOME_GENERO: Record<string, string> = { F: "Mulheres", M: "Homens", U: "Não informado" };
function comPct(lista: ItemDemo[] | undefined, topo = 10, rotular?: (k: string) => string): (ItemDemo & { pct: number })[] {
  const l = lista ?? [];
  const total = soma(l.map((x) => x.valor));
  return l.slice(0, topo).map((x) => ({ chave: rotular ? rotular(x.chave) : x.chave, valor: x.valor, pct: total ? arred((x.valor / total) * 100, 1) : 0 }));
}
function grupo(b: Record<string, ItemDemo[]> | undefined): GrupoPublico {
  return {
    idade: comPct(
      [...(b?.age ?? [])].sort((x, y) => x.chave.localeCompare(y.chave, "pt-BR", { numeric: true })),
      12,
    ),
    genero: comPct(b?.gender, 3, (k) => NOME_GENERO[k] ?? k),
    cidades: comPct(b?.city, 10),
    paises: comPct(b?.country, 8),
  };
}

/** Converte o JSON `bruto` do registro de público mais recente no resumo da tela. */
export function resumirPublico(registro: { bruto: string; coletadoEm: Date | string } | null): ResumoPublico {
  if (!registro) return null;
  let b: Record<string, Record<string, ItemDemo[]> | string[] | undefined> = {};
  try {
    b = JSON.parse(registro.bruto);
  } catch {
    return null;
  }
  return {
    coletadoEm: new Date(registro.coletadoEm).toISOString(),
    seguidores: grupo(b.seguidores as Record<string, ItemDemo[]>),
    engajados: grupo(b.engajados as Record<string, ItemDemo[]>),
    alcancados: grupo(b.alcancados as Record<string, ItemDemo[]>),
    avisos: Array.isArray(b.avisos) ? (b.avisos as string[]) : [],
  };
}

export function analisarTudo(entrada: { posts: PostLinha[]; dias: DiaLinha[]; publico: { bruto: string; coletadoEm: Date | string } | null }) {
  return {
    totais: totaisPeriodo(entrada.dias),
    horario: analisarHorario(entrada.posts),
    formatos: analisarFormatos(entrada.posts),
    top: topPostagens(entrada.posts, 10),
    evolucao: evolucaoDiaria(entrada.dias),
    publico: resumirPublico(entrada.publico),
  };
}
