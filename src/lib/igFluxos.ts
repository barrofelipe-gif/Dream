import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { dentroDaJanela, enviarDm, MARGEM_AGENDADO_MS } from "@/lib/instagram";
import { aplicarNome } from "@/lib/igBoasVindas";
import { cortarBytes, cortarCaracteres } from "@/lib/igTexto";
import { roboPodeFalar, roboPodeFalarConversa } from "@/lib/igEstado";
import { etiquetar } from "@/lib/igTags";
import { notificarEquipe } from "@/lib/igNotificacao";
import { gravarCampos, normalizarValor } from "@/lib/igContatos";
import type { ComentarioEvento } from "@/lib/igAutomacoes";
import {
  aplicarVariaveis,
  avaliarCondicao,
  casaPalavras,
  duracaoMs,
  lerPayload,
  MAX_PASSOS,
  montarPayload,
  noGatilho,
  nomeVariavel,
  proximoNo,
  validarGrafo,
  type DadosAtendente,
  type DadosAtraso,
  type DadosCondicao,
  type DadosEtiqueta,
  type DadosGatilho,
  type DadosIrPara,
  type DadosMensagem,
  type DadosPergunta,
  type Grafo,
  type No,
} from "@/lib/igFluxosModelo";

// Motor dos fluxos visuais (Flow Builder). Regra da Meta: só envia dentro da janela de 24h desde a última
// mensagem da pessoa (exceção: a 1ª mensagem de um fluxo disparado por comentário vai como resposta privada
// ao comentário). Fora da janela, a execução vira CANCELADO.

const GRAPH = `${process.env.IG_GRAPH_BASE ?? "https://graph.instagram.com"}/${process.env.IG_GRAPH_VERSION ?? "v23.0"}`;
const DIA = 24 * 60 * 60 * 1000;
const FINAIS = ["CONCLUIDO", "CANCELADO"];

type Vars = Record<string, unknown>;
type ContaRow = { id: string; igUserId: string; accessToken: string; active: boolean };
type ConversaRow = {
  id: string;
  accountId: string;
  igScopedUserId: string;
  status: string;
  assumidaEm: Date | null;
  updatedAt: Date;
  lastCustomerMessageAt: Date | null;
  nome: string | null;
  tags: string[];
  seguePagina: boolean | null;
  campos: Prisma.JsonValue;
  account: ContaRow;
};

function lerGrafo(v: Prisma.JsonValue): Grafo {
  const r = validarGrafo(v);
  return "grafo" in r ? r.grafo : { nos: [], ligacoes: [] };
}
const objeto = (v: Prisma.JsonValue | null | undefined): Vars => (v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Vars) } : {});
const json = (v: Vars) => v as Prisma.InputJsonObject;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function carregarConversa(conversationId: string): Promise<ConversaRow | null> {
  return prisma.igConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      accountId: true,
      igScopedUserId: true,
      status: true,
      assumidaEm: true,
      updatedAt: true,
      lastCustomerMessageAt: true,
      nome: true,
      tags: true,
      seguePagina: true,
      campos: true,
      account: { select: { id: true, igUserId: true, accessToken: true, active: true } },
    },
  });
}

/** Resposta privada a um comentário (abre o direct sem precisar da janela). Botões viram botões do modelo (máx. 3). */
async function respostaPrivada(conta: ContaRow, commentId: string, texto: string, quickReplies?: { title: string; payload: string }[], link?: { title: string; url: string }) {
  const botoes = link
    ? [{ type: "web_url", url: link.url, title: cortarCaracteres(link.title, 20) }]
    : (quickReplies ?? []).slice(0, 3).map((q) => ({ type: "postback", title: cortarCaracteres(q.title, 20), payload: q.payload }));
  const message = botoes.length
    ? { attachment: { type: "template", payload: { template_type: "button", text: cortarCaracteres(texto, 640), buttons: botoes } } }
    : { text: cortarBytes(texto, 1000) };
  const res = await fetch(`${GRAPH}/${conta.igUserId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${decrypt(conta.accessToken)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message }),
  });
  if (!res.ok) throw new Error(`Meta ${res.status} na resposta privada: ${(await res.text()).slice(0, 250)}`);
  const j = (await res.json()) as { message_id?: string };
  return j.message_id ?? "";
}

type Estado = {
  execId: string;
  fluxoId: string;
  grafo: Grafo;
  vars: Vars;
  passos: number;
  conversa: ConversaRow;
  enviouAgora: boolean;
  /** Retomado pelo agendador (não é resposta imediata): usa a folga de segurança na janela de 24h. */
  agendado: boolean;
};

/** Envia uma mensagem do fluxo e grava na conversa como do robô. */
async function enviar(
  e: Estado,
  textoBruto: string,
  extras: { quickReplies?: { title: string; payload: string }[]; link?: { title: string; url: string } } = {},
): Promise<"ok" | "vazio" | "fora_janela" | "bloqueado"> {
  const c = e.conversa;
  const vars = { ...objeto(c.campos), ...e.vars };
  const texto = aplicarVariaveis(aplicarNome(textoBruto, c.nome), vars);
  if (!texto) return "vazio";

  // Atendente assumiu, conversa na fila da equipe ou encerrada no meio do fluxo: o robô não fala por cima.
  if (!(await roboPodeFalar(c.id))) return "bloqueado";

  const naJanela = dentroDaJanela(c.lastCustomerMessageAt, new Date(), e.agendado ? MARGEM_AGENDADO_MS : 0);
  const commentId = typeof e.vars._commentId === "string" ? e.vars._commentId : "";
  const usarPrivada = !naJanela && !!commentId && !e.vars._privadaUsada;
  if (!naJanela && !usarPrivada) return "fora_janela";

  if (e.enviouAgora) await espera(1000); // várias mensagens seguidas: parece digitação, não rajada
  let sentId: string;
  if (usarPrivada) {
    sentId = await respostaPrivada(c.account, commentId, texto, extras.quickReplies, extras.link);
    e.vars._privadaUsada = true;
  } else {
    sentId = await enviarDm({
      igUserId: c.account.igUserId,
      encryptedToken: c.account.accessToken,
      recipientId: c.igScopedUserId,
      text: texto,
      quickReplies: extras.quickReplies,
      link: extras.link,
    });
  }
  e.enviouAgora = true;
  await prisma.igMessage.create({
    data: { conversationId: c.id, direction: "OUT", source: "BOT", text: texto, metaMessageId: sentId || null, matchedKind: "fluxo" },
  });
  return "ok";
}

async function salvar(e: Estado, status: string, noAtual: string, retomarEm: Date | null = null, motivo?: string) {
  const vars = { ...e.vars, _passos: e.passos, ...(motivo ? { _motivo: motivo } : {}) };
  await prisma.igFluxoExec.update({
    where: { id: e.execId },
    data: { fluxoId: e.fluxoId, noAtual, status, retomarEm, variaveis: json(vars) },
  });
}

/** Percorre o grafo a partir de `inicio` até esperar (resposta/tempo) ou terminar. */
async function rodar(e: Estado, inicio: string | null, ultimoNo: string): Promise<void> {
  let noId = inicio;
  let atual = ultimoNo;
  try {
    while (noId) {
      const no = e.grafo.nos.find((n) => n.id === noId) as No | undefined;
      if (!no) break;
      if (e.passos >= MAX_PASSOS) {
        console.warn(`[ig-fluxos] exec ${e.execId}: passou de ${MAX_PASSOS} blocos, parado (laço?)`);
        return salvar(e, "CANCELADO", no.id, null, "laco");
      }
      e.passos++;
      atual = no.id;

      switch (no.tipo) {
        case "gatilho":
          noId = proximoNo(e.grafo, no.id, "proximo");
          break;

        case "mensagem": {
          const d = no.dados as DadosMensagem;
          const quickReplies =
            d.botoesTipo === "rapidos"
              ? d.botoes.map((b, i) => ({ title: b.titulo.trim(), payload: montarPayload(e.fluxoId, no.id, i) })).filter((q) => q.title)
              : [];
          const link = d.botoesTipo === "link" && /^https?:\/\//i.test(d.link.url) ? { title: d.link.titulo || "Abrir", url: d.link.url } : undefined;
          const r = await enviar(e, d.texto, { quickReplies: quickReplies.length ? quickReplies : undefined, link });
          if (r === "fora_janela") return salvar(e, "CANCELADO", no.id, null, "fora_janela");
          if (r === "bloqueado") return salvar(e, "CANCELADO", no.id, null, "equipe_no_comando");
          if (quickReplies.length && r === "ok") return salvar(e, "ESPERANDO_RESPOSTA", no.id, new Date(Date.now() + DIA));
          noId = proximoNo(e.grafo, no.id, "proximo");
          break;
        }

        case "pergunta": {
          const d = no.dados as DadosPergunta;
          const sugestoes = d.sugestoes.map((s, i) => ({ title: s.titulo.trim(), payload: montarPayload(e.fluxoId, no.id, i) })).filter((q) => q.title);
          const r = await enviar(e, d.texto, { quickReplies: sugestoes.length ? sugestoes : undefined });
          if (r === "fora_janela") return salvar(e, "CANCELADO", no.id, null, "fora_janela");
          if (r === "bloqueado") return salvar(e, "CANCELADO", no.id, null, "equipe_no_comando");
          if (r === "vazio") {
            noId = proximoNo(e.grafo, no.id, "proximo");
            break;
          }
          return salvar(e, "ESPERANDO_RESPOSTA", no.id, new Date(Date.now() + DIA));
        }

        case "condicao": {
          const ok = avaliarCondicao(no.dados as DadosCondicao, {
            tags: e.conversa.tags,
            variaveis: { ...objeto(e.conversa.campos), ...e.vars },
            seguePagina: e.conversa.seguePagina,
            ultimoTexto: typeof e.vars._ultimoTexto === "string" ? e.vars._ultimoTexto : "",
          });
          noId = proximoNo(e.grafo, no.id, ok ? "sim" : "nao");
          break;
        }

        case "atraso":
          return salvar(e, "ESPERANDO_TEMPO", no.id, new Date(Date.now() + duracaoMs(no.dados as DadosAtraso)));

        case "etiqueta": {
          const d = no.dados as DadosEtiqueta;
          const lista = d.etiquetas.split(",").map((t) => t.trim()).filter(Boolean);
          if (lista.length) {
            const novas = await etiquetar(e.conversa.id, d.acao === "adicionar" ? lista : [], d.acao === "remover" ? lista : []);
            if (novas) e.conversa.tags = novas;
          }
          noId = proximoNo(e.grafo, no.id, "proximo");
          break;
        }

        case "atendente": {
          const d = no.dados as DadosAtendente;
          if (d.texto.trim()) await enviar(e, d.texto); // fora da janela não manda, mas a equipe é chamada mesmo assim
          await prisma.igConversation.update({ where: { id: e.conversa.id }, data: { status: "NEEDS_HUMAN", naoLida: true } });
          e.conversa.status = "NEEDS_HUMAN";
          await notificarEquipe(e.conversa.id, "Fluxo chamou uma atendente");
          noId = proximoNo(e.grafo, no.id, "proximo");
          break;
        }

        case "irpara": {
          const d = no.dados as DadosIrPara;
          const alvo = d.fluxoId
            ? await prisma.igFluxo.findFirst({ where: { id: d.fluxoId, accountId: e.conversa.accountId }, select: { id: true, grafo: true } })
            : null;
          if (!alvo) {
            noId = null;
            break;
          }
          e.fluxoId = alvo.id;
          e.grafo = lerGrafo(alvo.grafo);
          const g = noGatilho(e.grafo);
          noId = g ? proximoNo(e.grafo, g.id, "proximo") : null;
          if (g) atual = g.id;
          break;
        }

        case "fim":
          noId = null;
          break;
      }
    }
    await salvar(e, "CONCLUIDO", atual);
  } catch (err) {
    console.error(`[ig-fluxos] exec ${e.execId} falhou`, err);
    await salvar(e, "CANCELADO", atual, null, `erro: ${err instanceof Error ? err.message.slice(0, 150) : "desconhecido"}`).catch(() => {});
  }
}

async function estadoDe(execId: string, conversa: ConversaRow, agendado = false): Promise<Estado | null> {
  const exec = await prisma.igFluxoExec.findUnique({ where: { id: execId }, include: { fluxo: { select: { id: true, grafo: true } } } });
  if (!exec) return null;
  const vars = objeto(exec.variaveis);
  return {
    execId: exec.id,
    fluxoId: exec.fluxo.id,
    grafo: lerGrafo(exec.fluxo.grafo),
    vars,
    passos: typeof vars._passos === "number" ? vars._passos : 0,
    conversa,
    enviouAgora: false,
    agendado,
  };
}

/** Pergunta pendente de outro fluxo perde a vez quando um fluxo novo começa (atrasos seguem valendo). */
async function cancelarPerguntasPendentes(conversationId: string) {
  await prisma.igFluxoExec.updateMany({ where: { conversationId, status: "ESPERANDO_RESPOSTA" }, data: { status: "CANCELADO" } });
}

/**
 * Começa o fluxo para a conversa (ignora se o fluxo está ativo: quem chama decide).
 * Devolve false se o fluxo/conversa não existe, a conta está desligada ou o fluxo não tem gatilho.
 */
export async function iniciarFluxo(fluxoId: string, conversationId: string, opts: { variaveis?: Record<string, unknown>; travarMs?: number } = {}): Promise<boolean> {
  const [fluxo, conversa] = await Promise.all([prisma.igFluxo.findUnique({ where: { id: fluxoId } }), carregarConversa(conversationId)]);
  if (!fluxo || !conversa || !conversa.account.active || fluxo.accountId !== conversa.accountId || !(await roboPodeFalarConversa(conversa))) return false;
  const grafo = lerGrafo(fluxo.grafo);
  const g = noGatilho(grafo);
  if (!g) return false;

  await cancelarPerguntasPendentes(conversationId);
  const exec = await prisma.igFluxoExec.create({
    data: { fluxoId, conversationId, noAtual: g.id, status: "ATIVO", variaveis: json({ ...(opts.variaveis ?? {}), _passos: 0 }) },
  });
  // Trava contra corrida (duas etiquetas ao mesmo tempo): se há uma execução mais antiga do mesmo fluxo na janela,
  // esta é a duplicada e se desfaz (o desempate por createdAt e id faz sobreviver exatamente uma).
  if (opts.travarMs) {
    const primeira = await prisma.igFluxoExec.findFirst({
      where: { fluxoId, conversationId, createdAt: { gt: new Date(Date.now() - opts.travarMs) } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (primeira && primeira.id !== exec.id) {
      await prisma.igFluxoExec.update({ where: { id: exec.id }, data: { status: "CANCELADO", variaveis: json({ _passos: 0, _motivo: "duplicado" }) } });
      return false;
    }
  }
  const e = await estadoDe(exec.id, conversa);
  if (!e) return false;
  await rodar(e, g.id, g.id);
  return true;
}

type FluxoCandidato = { id: string; updatedAt: Date; gatilho: DadosGatilho };

async function fluxosAtivos(accountId: string, tipo: DadosGatilho["tipo"]): Promise<FluxoCandidato[]> {
  const lista = await prisma.igFluxo.findMany({
    where: { accountId, ativo: true, gatilho: { path: ["tipo"], equals: tipo } },
    select: { id: true, updatedAt: true, gatilho: true },
    orderBy: { updatedAt: "desc" },
  });
  return lista.map((f) => ({ id: f.id, updatedAt: f.updatedAt, gatilho: objeto(f.gatilho) as unknown as DadosGatilho }));
}

/** O mais específico primeiro: palavra exata, depois o que tem palavras, depois o mais recente. */
function melhor(c: FluxoCandidato[]): FluxoCandidato | undefined {
  const peso = (f: FluxoCandidato) => (f.gatilho.modo === "exata" ? 2 : 0) + ((f.gatilho.palavras ?? "").trim() ? 1 : 0) + (f.gatilho.midiaId ? 4 : 0);
  return [...c].sort((a, b) => peso(b) - peso(a) || b.updatedAt.getTime() - a.updatedAt.getTime())[0];
}

/**
 * Mensagem nova na DM: se um fluxo ativo casar, ele assume a conversa (devolve true).
 * - payload (botão do menu / postback que não é de fluxo): gatilho "postback" com o payload exato;
 * - story: resposta/menção em story (gatilho "story"; sem palavras = qualquer uma);
 * - senão: gatilho "palavra" (precisa ter ao menos uma palavra).
 */
export async function tentarGatilhoPorMensagem(
  conversationId: string,
  texto: string,
  opts: { payload?: string | null; story?: boolean } = {},
): Promise<boolean> {
  const conversa = await prisma.igConversation.findUnique({ where: { id: conversationId }, select: { accountId: true } });
  if (!conversa) return false;
  let alvo: FluxoCandidato | undefined;
  if (opts.payload && !lerPayload(opts.payload)) {
    const p = opts.payload.trim();
    alvo = melhor((await fluxosAtivos(conversa.accountId, "postback")).filter((f) => (f.gatilho.payload ?? "").trim() === p));
  }
  if (!alvo && opts.story) {
    alvo = melhor((await fluxosAtivos(conversa.accountId, "story")).filter((f) => casaPalavras(texto, f.gatilho.palavras ?? "", f.gatilho.modo ?? "contem")));
  }
  if (!alvo && !opts.story) {
    alvo = melhor(
      (await fluxosAtivos(conversa.accountId, "palavra")).filter((f) => (f.gatilho.palavras ?? "").trim() && casaPalavras(texto, f.gatilho.palavras, f.gatilho.modo ?? "contem")),
    );
  }
  if (!alvo) return false;
  return iniciarFluxo(alvo.id, conversationId, { variaveis: { _ultimoTexto: texto, mensagem: texto } });
}

/** Etiqueta aplicada na conversa (pela equipe ou pelo robô): dispara o fluxo ativo com gatilho "etiqueta". */
export async function tentarGatilhoPorEtiqueta(conversationId: string, etiqueta: string): Promise<boolean> {
  const conversa = await prisma.igConversation.findUnique({ where: { id: conversationId }, select: { accountId: true } });
  if (!conversa) return false;
  const alvo = melhor(
    (await fluxosAtivos(conversa.accountId, "etiqueta")).filter((f) => (f.gatilho.etiqueta ?? "").trim().toLowerCase() === etiqueta.trim().toLowerCase()),
  );
  if (!alvo) return false;
  // Trava contra laço: fluxo A põe a etiqueta que dispara B, que põe a que dispara A (ou A tira e põe a própria etiqueta).
  // Cada volta seria uma execução nova (contador de blocos zerado), sem fim. O mesmo fluxo não recomeça na mesma conversa em 1 minuto.
  const recente = await prisma.igFluxoExec.findFirst({
    where: { fluxoId: alvo.id, conversationId, createdAt: { gt: new Date(Date.now() - 60_000) } },
    select: { id: true },
  });
  if (recente) return false;
  return iniciarFluxo(alvo.id, conversationId, { travarMs: 60_000 });
}

/**
 * Comentário numa publicação: se um fluxo ativo com gatilho "comentario" casar, abre a conversa e roda o fluxo.
 * A 1ª mensagem vai como resposta privada ao comentário (permitida pela Meta sem janela); o resto só com janela.
 * Idempotente por comentário (a Meta reenvia webhooks).
 */
export async function tentarGatilhoPorComentario(ev: ComentarioEvento): Promise<boolean> {
  const conta = await prisma.instagramAccount.findUnique({ where: { igUserId: ev.contaId }, select: { id: true, igUserId: true, active: true } });
  if (!conta?.active || ev.userId === conta.igUserId || ev.parentId) return false;
  const alvo = melhor(
    (await fluxosAtivos(conta.id, "comentario")).filter(
      (f) => (!f.gatilho.midiaId || f.gatilho.midiaId === ev.midiaId) && casaPalavras(ev.texto, f.gatilho.palavras ?? "", f.gatilho.modo ?? "contem"),
    ),
  );
  if (!alvo) return false;
  const ja = await prisma.igFluxoExec.findFirst({ where: { variaveis: { path: ["_commentId"], equals: ev.commentId } }, select: { id: true } });
  if (ja) return true;

  const conv = await prisma.igConversation.upsert({
    where: { accountId_igScopedUserId: { accountId: conta.id, igScopedUserId: ev.userId } },
    create: { accountId: conta.id, igScopedUserId: ev.userId, username: ev.username ?? null },
    update: {},
  });
  // Mesma pessoa, mesmo fluxo, nas últimas 24 h: não dispara de novo.
  const recente = await prisma.igFluxoExec.findFirst({
    where: { fluxoId: alvo.id, conversationId: conv.id, createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    select: { id: true },
  });
  if (recente) return true;
  await prisma.igMessage.create({ data: { conversationId: conv.id, direction: "IN", source: "CLIENTE", text: `[Comentou] ${ev.texto}` } });
  return iniciarFluxo(alvo.id, conv.id, { variaveis: { _commentId: ev.commentId, _ultimoTexto: ev.texto, comentario: ev.texto } });
}

/**
 * Resposta da pessoa (texto digitado ou toque em botão de resposta rápida/postback de fluxo).
 * Devolve true se um fluxo consumiu a resposta (o robô normal não deve responder).
 */
export async function continuarComResposta(conversationId: string, texto: string, payload?: string | null): Promise<boolean> {
  const conversa = await carregarConversa(conversationId);
  if (!conversa || !conversa.account.active || !(await roboPodeFalarConversa(conversa))) return false;
  const p = lerPayload(payload);

  let execId: string | null = null;
  let noId: string;
  let indice: number | null = null;

  if (p) {
    // Toque em botão de um fluxo. Vale mesmo se a execução já acabou (botão de mensagem antiga), desde que o fluxo esteja ativo.
    const esperando = await prisma.igFluxoExec.findFirst({
      where: { conversationId, status: "ESPERANDO_RESPOSTA", fluxoId: p.fluxoId, noAtual: p.noId },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (esperando) {
      const claim = await prisma.igFluxoExec.updateMany({ where: { id: esperando.id, status: "ESPERANDO_RESPOSTA" }, data: { status: "ATIVO" } });
      // Outra execução (clique duplo) já pegou esta resposta: consome o evento sem abrir um fluxo novo.
      if (claim.count !== 1) return true;
      execId = esperando.id;
    }
    if (!execId) {
      const fluxo = await prisma.igFluxo.findUnique({ where: { id: p.fluxoId }, select: { ativo: true, accountId: true, grafo: true } });
      if (!fluxo?.ativo || fluxo.accountId !== conversa.accountId) return false;
      if (!lerGrafo(fluxo.grafo).nos.some((n) => n.id === p.noId)) return false;
      await cancelarPerguntasPendentes(conversationId);
      const novo = await prisma.igFluxoExec.create({ data: { fluxoId: p.fluxoId, conversationId, noAtual: p.noId, status: "ATIVO", variaveis: json({ _passos: 0 }) } });
      execId = novo.id;
    }
    noId = p.noId;
    indice = p.indice;
  } else {
    const esperando = await prisma.igFluxoExec.findFirst({
      where: { conversationId, status: "ESPERANDO_RESPOSTA" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, noAtual: true },
    });
    if (!esperando) return false;
    const claim = await prisma.igFluxoExec.updateMany({ where: { id: esperando.id, status: "ESPERANDO_RESPOSTA" }, data: { status: "ATIVO" } });
    if (claim.count !== 1) return false;
    execId = esperando.id;
    noId = esperando.noAtual;
  }

  const e = await estadoDe(execId, conversa);
  if (!e) return false;
  const no = e.grafo.nos.find((n) => n.id === noId);
  if (!no) {
    await salvar(e, "CANCELADO", noId, null, "bloco_removido");
    return false;
  }
  // A pessoa respondeu: não é laço automático, o contador de blocos recomeça.
  e.passos = 0;
  e.vars._ultimoTexto = texto;

  if (no.tipo === "pergunta") {
    const d = no.dados as DadosPergunta;
    const resposta = indice !== null && d.sugestoes[indice]?.titulo ? d.sugestoes[indice].titulo : texto;
    const chave = nomeVariavel(d.variavel) || "resposta";
    e.vars[chave] = resposta;
    if (d.salvarNoContato) {
      // Os campos do contato são chaveados pelo nome do IgCampo ("Cidade"), a variável é normalizada ("cidade"):
      // grava na chave do campo personalizado correspondente (e no tipo dele), senão a aba Contatos nunca mostra o valor.
      const defs = await prisma.igCampo.findMany({ where: { accountId: conversa.accountId }, select: { nome: true, tipo: true } });
      const def = defs.find((c) => nomeVariavel(c.nome) === chave);
      const v = def ? normalizarValor(def.tipo, resposta) : ({ ok: true, valor: resposta } as const);
      if (v.ok && v.valor !== null) {
        const novos = await gravarCampos(conversa.id, { [def?.nome ?? chave]: v.valor });
        if (novos) conversa.campos = novos as Prisma.JsonValue;
      }
    }
    await rodar(e, proximoNo(e.grafo, no.id, "proximo"), no.id);
    return true;
  }

  if (no.tipo === "mensagem") {
    const d = no.dados as DadosMensagem;
    if (indice === null) {
      const t = texto.trim().toLowerCase();
      const i = d.botoes.findIndex((b) => b.titulo.trim().toLowerCase() === t);
      if (i >= 0) indice = i;
    }
    const saida = indice !== null ? `b${indice}` : "proximo";
    const prox = proximoNo(e.grafo, no.id, saida);
    if (!prox) {
      // Nada ligado nessa saída: o fluxo termina e o robô normal cuida da mensagem.
      await salvar(e, "CONCLUIDO", no.id);
      return false;
    }
    if (indice !== null) e.vars.botao = d.botoes[indice]?.titulo ?? texto;
    await rodar(e, prox, no.id);
    return true;
  }

  // Outro tipo de bloco (não deveria estar esperando resposta): segue em frente.
  await rodar(e, proximoNo(e.grafo, no.id, "proximo"), no.id);
  return true;
}

/**
 * Agendador (de 5 em 5 min): continua os atrasos vencidos e encerra perguntas sem resposta há mais de 24h.
 * Devolve quantas execuções foram retomadas.
 */
export async function processarFluxos(limite = 40): Promise<number> {
  const agora = new Date();
  await prisma.igFluxoExec.updateMany({ where: { status: "ESPERANDO_RESPOSTA", retomarEm: { lt: agora } }, data: { status: "CANCELADO" } });
  // Execução que ficou ATIVA por mais de 10 min morreu no meio (limite de 60 s da Vercel): cancela para não contar como em andamento.
  await prisma.igFluxoExec.updateMany({ where: { status: "ATIVO", updatedAt: { lt: new Date(agora.getTime() - 10 * 60 * 1000) } }, data: { status: "CANCELADO" } });

  const vencidas = await prisma.igFluxoExec.findMany({
    where: { status: "ESPERANDO_TEMPO", retomarEm: { lte: agora } },
    orderBy: { retomarEm: "asc" },
    take: limite,
    select: { id: true, conversationId: true, noAtual: true },
  });
  let feitas = 0;
  for (const v of vencidas) {
    const claim = await prisma.igFluxoExec.updateMany({ where: { id: v.id, status: "ESPERANDO_TEMPO" }, data: { status: "ATIVO" } });
    if (claim.count !== 1) continue;
    feitas++;
    const conversa = await carregarConversa(v.conversationId);
    if (!conversa || !conversa.account.active || conversa.status === "CLOSED" || (conversa.status === "HUMAN" && !(await roboPodeFalarConversa(conversa)))) {
      await prisma.igFluxoExec.update({ where: { id: v.id }, data: { status: "CANCELADO" } });
      continue;
    }
    const e = await estadoDe(v.id, conversa, true);
    if (!e) continue;
    if (!dentroDaJanela(conversa.lastCustomerMessageAt, new Date(), MARGEM_AGENDADO_MS)) {
      await salvar(e, "CANCELADO", v.noAtual, null, "fora_janela");
      continue;
    }
    // Aguardando atendente: pausa (tenta de novo em 15 min) em vez de falar por cima; a janela de 24h acaba cancelando.
    if (conversa.status === "NEEDS_HUMAN") {
      await prisma.igFluxoExec.update({ where: { id: v.id }, data: { status: "ESPERANDO_TEMPO", retomarEm: new Date(Date.now() + 15 * 60 * 1000) } });
      continue;
    }
    await rodar(e, proximoNo(e.grafo, v.noAtual, "proximo"), v.noAtual);
  }
  return feitas;
}

/** Usado pela API ao desligar/excluir um fluxo: para quem ainda estava no meio dele. */
export async function cancelarExecucoes(fluxoId: string): Promise<number> {
  const r = await prisma.igFluxoExec.updateMany({ where: { fluxoId, status: { notIn: FINAIS } }, data: { status: "CANCELADO" } });
  return r.count;
}
