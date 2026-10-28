import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { abrirConta } from "@/lib/social/contas";
import { FB_GRAPH } from "@/lib/social/facebook";
import { comLinksEscritos, dentroDaJanela } from "@/lib/instagram";
import { responder, type Mensagem } from "@/lib/igBot";
import { aplicarNome } from "@/lib/igBoasVindas";
import type { Loja } from "@/lib/avaliacoesLeitura";

/**
 * Messenger: mensagens da Página do Facebook (BFF e Moranga) no painel.
 * - Recebe pelo webhook "page" (/api/webhooks/facebook) e puxa o histórico pela Conversations API.
 * - Responde pela Send API com o token da Página (SocialConta rede "facebook").
 * Regras da Meta: resposta livre até 24h depois da última mensagem do cliente; de 24h a 7 dias só uma pessoa da equipe
 * (etiqueta HUMAN_AGENT, que exige aprovação da Meta); depois disso não dá para responder. Para receber mensagens de
 * clientes (quem não tem papel no app) a Meta exige o Acesso Avançado a pages_messaging (App Review).
 */

export const ESCOPOS_MESSENGER = ["pages_messaging", "pages_manage_metadata", "pages_read_engagement"];
const CAMPOS_WEBHOOK = ["messages", "messaging_postbacks", "message_echoes"];
const LIMITE_MS = 15_000;
const SETE_DIAS = 7 * 24 * 60 * 60 * 1000;

type ErroGraph = { message?: string; code?: number; error_subcode?: number };

export class ErroMessenger extends Error {
  constructor(
    message: string,
    public code?: number,
    public subcode?: number,
  ) {
    super(message);
  }
}

/** Frase clara para o erro da Graph API (o que a equipe precisa fazer). */
function traduzir(erro: ErroGraph | undefined, status: number): string {
  const msg = erro?.message ?? `erro ${status}`;
  const c = erro?.code;
  if (c === 190) return "O acesso da Página venceu ou foi revogado: reconecte o Facebook.";
  if (c === 10 && erro?.error_subcode === 2018278) return "Passou do prazo de resposta do Messenger (24h; com a permissão Human Agent, 7 dias).";
  if (c === 10 || c === 200 || c === 230 || /permission|pages_messaging/i.test(msg))
    return `Falta permissão do Messenger (pages_messaging). Reconecte o Facebook marcando todas as permissões; para clientes, a Meta exige o App Review. (${msg})`;
  if (c === 551) return "Esta pessoa não está disponível no Messenger agora (bloqueou a Página ou desativou o Messenger).";
  if (c === 4 || c === 17 || c === 32 || c === 613) return "O Facebook limitou as chamadas por alguns minutos. Tente de novo daqui a pouco.";
  return msg;
}

async function graph<T>(token: string, caminho: string, init?: { metodo?: "GET" | "POST"; json?: unknown }): Promise<T> {
  const res = await fetch(`${FB_GRAPH}/${caminho}`, {
    method: init?.metodo ?? (init?.json ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${token}`, ...(init?.json ? { "content-type": "application/json" } : {}) },
    body: init?.json ? JSON.stringify(init.json) : undefined,
    signal: AbortSignal.timeout(LIMITE_MS),
    cache: "no-store",
  });
  const texto = await res.text();
  if (!res.ok) {
    let erro: ErroGraph | undefined;
    try {
      erro = (JSON.parse(texto) as { error?: ErroGraph }).error;
    } catch {
      erro = { message: texto.slice(0, 300) };
    }
    throw new ErroMessenger(traduzir(erro, res.status), erro?.code, erro?.error_subcode);
  }
  return JSON.parse(texto) as T;
}

/** Assinatura do webhook "page": HMAC-SHA256 com o segredo do app do Facebook (FB_APP_SECRET; META_APP_SECRET de reserva). */
export function assinaturaFacebookValida(raw: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const recebido = Buffer.from(header.slice("sha256=".length), "hex");
  for (const segredo of [process.env.FB_APP_SECRET, process.env.META_APP_SECRET]) {
    if (!segredo) continue;
    const esperado = crypto.createHmac("sha256", segredo).update(raw).digest();
    if (recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado)) return true;
  }
  return false;
}

/** Páginas do Facebook conectadas no publicador (uma por loja; nunca mistura BFF e Moranga). */
export async function paginasConectadas(loja?: string) {
  return prisma.socialConta.findMany({
    where: { rede: "facebook", ativo: true, ...(loja ? { loja } : {}) },
    select: { id: true, loja: true, externoId: true, nome: true },
    orderBy: { createdAt: "asc" },
  });
}

async function tokenDaPagina(contaId: string) {
  const c = await abrirConta(contaId);
  if (!c || c.rede !== "facebook") throw new ErroMessenger("Página do Facebook não encontrada ou desativada.");
  return c;
}

// ── Diagnóstico ───────────────────────────────────────────────────────────────

export type StatusPagina = {
  contaId: string;
  loja: string;
  nome: string | null;
  paginaId: string;
  escopos: string[] | null;
  faltam: string[];
  assinada: boolean | null;
  leConversas: boolean;
  erroConversas: string | null;
  roboAtivo: boolean;
  passos: string[];
};

/** O que está pronto e o que falta em cada Página (permissões de verdade do token, webhook assinado, leitura das conversas). */
export async function statusPaginas(loja?: string): Promise<StatusPagina[]> {
  const paginas = await paginasConectadas(loja);
  const configs = await prisma.fbPaginaConfig.findMany({ where: { paginaId: { in: paginas.map((p) => p.externoId) } } });
  const appId = process.env.FB_APP_ID;
  const segredo = process.env.FB_APP_SECRET;
  return Promise.all(
    paginas.map(async (p): Promise<StatusPagina> => {
      const s: StatusPagina = {
        contaId: p.id,
        loja: p.loja,
        nome: p.nome,
        paginaId: p.externoId,
        escopos: null,
        faltam: [],
        assinada: null,
        leConversas: false,
        erroConversas: null,
        roboAtivo: configs.find((c) => c.paginaId === p.externoId)?.roboAtivo ?? false,
        passos: [],
      };
      let token = "";
      try {
        token = (await tokenDaPagina(p.id)).accessToken;
      } catch (e) {
        s.erroConversas = (e as Error).message;
        s.passos.push("Reconectar o Facebook no Publicar (a Página não abriu).");
        return s;
      }
      // Permissões realmente concedidas ao token da Página (não as pedidas).
      if (appId && segredo) {
        try {
          const d = await fetch(`${FB_GRAPH}/debug_token?input_token=${encodeURIComponent(token)}`, {
            headers: { Authorization: `Bearer ${appId}|${segredo}` },
            signal: AbortSignal.timeout(LIMITE_MS),
            cache: "no-store",
          });
          const j = (await d.json()) as { data?: { scopes?: string[] } };
          if (j.data?.scopes) s.escopos = j.data.scopes;
        } catch {
          /* sem diagnóstico de permissões: segue */
        }
      }
      if (s.escopos) s.faltam = ESCOPOS_MESSENGER.filter((e) => !s.escopos!.includes(e));
      try {
        const r = await graph<{ data?: { id?: string; subscribed_fields?: string[] }[] }>(token, `${p.externoId}/subscribed_apps`);
        const nosso = r.data?.find((a) => !appId || a.id === appId);
        s.assinada = !!nosso && CAMPOS_WEBHOOK.every((f) => nosso.subscribed_fields?.includes(f));
      } catch {
        s.assinada = null;
      }
      try {
        await graph(token, `${p.externoId}/conversations?platform=messenger&limit=1&fields=id`);
        s.leConversas = true;
      } catch (e) {
        s.erroConversas = (e as Error).message;
      }
      if (s.faltam.length)
        s.passos.push(`Reconectar o Facebook (botão abaixo) e marcar as permissões: ${s.faltam.join(", ")}.`);
      if (!s.assinada && !s.faltam.length) s.passos.push("Clicar em \"Ativar recebimento\" para a Página mandar as mensagens novas ao painel.");
      return s;
    }),
  );
}

/** Liga o webhook da Página no app (mensagens, botões e ecos das respostas feitas pelo Facebook). */
export async function assinarPagina(contaId: string) {
  const c = await tokenDaPagina(contaId);
  await graph(c.accessToken, `${c.externoId}/subscribed_apps?subscribed_fields=${CAMPOS_WEBHOOK.join(",")}`, { metodo: "POST" });
}

export async function definirRobo(contaId: string, ativo: boolean) {
  const c = await prisma.socialConta.findUnique({ where: { id: contaId }, select: { externoId: true, rede: true } });
  if (!c || c.rede !== "facebook") throw new ErroMessenger("Página não encontrada.");
  await prisma.fbPaginaConfig.upsert({ where: { paginaId: c.externoId }, create: { paginaId: c.externoId, roboAtivo: ativo }, update: { roboAtivo: ativo } });
}

// ── Gravação ──────────────────────────────────────────────────────────────────

type Pagina = { id: string; loja: string; externoId: string };

async function conversaDe(p: Pagina, psid: string, nome?: string | null) {
  return prisma.fbConversa.upsert({
    where: { paginaId_psid: { paginaId: p.externoId, psid } },
    create: { contaId: p.id, loja: p.loja, paginaId: p.externoId, psid, nome: nome ?? null },
    update: nome ? { nome } : {},
  });
}

/** Nome e foto da pessoa (User Profile API do Messenger). Falha em silêncio: o nome é só conforto. */
async function buscarPerfil(token: string, psid: string): Promise<{ nome: string | null; foto: string | null }> {
  try {
    const r = await graph<{ first_name?: string; last_name?: string; name?: string; profile_pic?: string }>(
      token,
      `${psid}?fields=first_name,last_name,profile_pic`,
    );
    const nome = r.name || [r.first_name, r.last_name].filter(Boolean).join(" ") || null;
    return { nome, foto: r.profile_pic ?? null };
  } catch {
    return { nome: null, foto: null };
  }
}

/** A janela de 24h só anda para frente (webhook fora de ordem ou sincronização com mensagem antiga não a encolhem). */
async function avancarJanela(conversaId: string, em: Date) {
  await prisma.fbConversa.updateMany({
    where: { id: conversaId, OR: [{ lastCustomerMessageAt: null }, { lastCustomerMessageAt: { lt: em } }] },
    data: { lastCustomerMessageAt: em },
  });
}

// ── Sincronização (Conversations API) ─────────────────────────────────────────

type ConvApi = {
  id: string;
  updated_time?: string;
  participants?: { data?: { id: string; name?: string }[] };
  messages?: { data?: { id: string; message?: string; created_time?: string; from?: { id?: string; name?: string } }[] };
};

/**
 * Puxa as conversas recentes da Página (até 25 por vez, 20 mensagens mais novas de cada — limite da Meta) e grava as
 * que faltam. Não responde nada: só traz o histórico para o painel.
 */
export async function sincronizarPagina(contaId: string, limite = 25): Promise<{ conversas: number; novas: number }> {
  const c = await tokenDaPagina(contaId);
  const campos = "id,updated_time,participants,messages.limit(20){id,message,created_time,from}";
  const r = await graph<{ data?: ConvApi[] }>(c.accessToken, `${c.externoId}/conversations?platform=messenger&limit=${limite}&fields=${encodeURIComponent(campos)}`);
  let novas = 0;
  let conversas = 0;
  for (const cv of r.data ?? []) {
    const pessoa = cv.participants?.data?.find((x) => x.id !== c.externoId);
    if (!pessoa) continue;
    conversas++;
    const conversa = await conversaDe(c, pessoa.id, pessoa.name);
    let ultimaDoCliente: Date | null = null;
    let novaDoCliente = false;
    for (const m of cv.messages?.data ?? []) {
      const em = m.created_time ? new Date(m.created_time) : new Date();
      const doCliente = m.from?.id !== c.externoId;
      if (doCliente && (!ultimaDoCliente || em > ultimaDoCliente)) ultimaDoCliente = em;
      const r2 = await prisma.fbMensagem.createMany({
        data: [
          {
            conversaId: conversa.id,
            direction: doCliente ? "IN" : "OUT",
            source: doCliente ? "CLIENTE" : "HUMANO",
            text: m.message?.trim() || "[mídia]",
            metaMessageId: m.id,
            createdAt: em,
          },
        ],
        skipDuplicates: true,
      });
      novas += r2.count;
      if (r2.count && doCliente) novaDoCliente = true;
    }
    if (ultimaDoCliente) await avancarJanela(conversa.id, ultimaDoCliente);
    if (novaDoCliente) await prisma.fbConversa.update({ where: { id: conversa.id }, data: { naoLida: true } });
  }
  return { conversas, novas };
}

// ── Envio ─────────────────────────────────────────────────────────────────────

/** Janela do Messenger: "livre" (24h), "atendente" (24h–7 dias, só com HUMAN_AGENT) ou "fechada". */
export function janela(lastCustomerMessageAt: Date | null, agora = new Date()): "livre" | "atendente" | "fechada" {
  if (dentroDaJanela(lastCustomerMessageAt, agora)) return "livre";
  if (lastCustomerMessageAt && agora.getTime() - lastCustomerMessageAt.getTime() < SETE_DIAS) return "atendente";
  return "fechada";
}

async function enviarTexto(token: string, paginaId: string, psid: string, texto: string, humanAgent = false): Promise<string | null> {
  const r = await graph<{ message_id?: string }>(token, `${paginaId}/messages`, {
    json: {
      recipient: { id: psid },
      messaging_type: humanAgent ? "MESSAGE_TAG" : "RESPONSE",
      ...(humanAgent ? { tag: "HUMAN_AGENT" } : {}),
      message: { text: texto.slice(0, 2000) },
    },
  });
  return r.message_id ?? null;
}

/** Resposta da atendente pelo painel: envia, grava como equipe e tira o robô da conversa. */
export async function responderComoEquipe(conversaId: string, texto: string) {
  const conversa = await prisma.fbConversa.findUnique({ where: { id: conversaId } });
  if (!conversa) throw new ErroMessenger("Conversa não encontrada.");
  const j = janela(conversa.lastCustomerMessageAt);
  if (j === "fechada") throw new ErroMessenger("Passaram mais de 7 dias desde a última mensagem do cliente: o Messenger não deixa responder.");
  const c = await tokenDaPagina(conversa.contaId);
  if (c.externoId !== conversa.paginaId) throw new ErroMessenger("A conversa não é desta Página.");
  // Assume ANTES de enviar: o robô não responde junto enquanto a Meta processa o envio da atendente.
  await prisma.fbConversa.update({ where: { id: conversaId }, data: { status: "HUMAN", naoLida: false } });
  const mid = await enviarTexto(c.accessToken, conversa.paginaId, conversa.psid, texto, j === "atendente");
  await prisma.fbMensagem.create({ data: { conversaId, direction: "OUT", source: "HUMANO", text: texto, metaMessageId: mid } });
}

// ── Webhook ───────────────────────────────────────────────────────────────────

export type EventoMessenger = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; app_id?: number | string; attachments?: { type?: string }[]; quick_reply?: { payload?: string } };
  postback?: { mid?: string; title?: string; payload?: string };
};
export type PayloadPagina = { object?: string; entry?: { id: string; time?: number; messaging?: EventoMessenger[] }[] };

const HORAS = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

export async function tratarEventoMessenger(paginaId: string, ev: EventoMessenger) {
  const pagina = await prisma.socialConta.findFirst({ where: { rede: "facebook", ativo: true, externoId: paginaId }, select: { id: true, loja: true, externoId: true } });
  if (!pagina) return;

  // Eco: mensagem que SAIU da Página. Se não foi o nosso app, uma pessoa respondeu pelo Facebook/Meta Business Suite.
  if (ev.message?.is_echo) {
    const psid = ev.recipient?.id;
    const mid = ev.message.mid;
    if (!psid || !mid) return;
    if (process.env.FB_APP_ID && String(ev.message.app_id ?? "") === process.env.FB_APP_ID) return; // enviado por nós
    const conversa = await prisma.fbConversa.findUnique({ where: { paginaId_psid: { paginaId, psid } } });
    if (!conversa) return;
    await prisma.fbMensagem.createMany({
      data: [{ conversaId: conversa.id, direction: "OUT", source: "HUMANO", text: ev.message.text?.trim() || "[mídia]", metaMessageId: mid, createdAt: new Date(ev.timestamp ?? Date.now()) }],
      skipDuplicates: true,
    });
    await prisma.fbConversa.update({ where: { id: conversa.id }, data: { status: "HUMAN", naoLida: false } });
    return;
  }

  const psid = ev.sender?.id;
  const mid = ev.message?.mid ?? ev.postback?.mid;
  const texto = ev.message?.text?.trim() || ev.postback?.title?.trim() || (ev.message?.attachments?.length ? "[mídia]" : "");
  if (!psid || !texto || psid === paginaId) return;
  if (mid && (await prisma.fbMensagem.findUnique({ where: { metaMessageId: mid }, select: { id: true } }))) return;

  const c = await abrirConta(pagina.id);
  if (!c) return;
  let conversa = await prisma.fbConversa.findUnique({ where: { paginaId_psid: { paginaId, psid } } });
  if (!conversa || !conversa.nome) {
    const perfil = await buscarPerfil(c.accessToken, psid);
    conversa = await conversaDe(pagina, psid, perfil.nome);
    if (perfil.foto) await prisma.fbConversa.update({ where: { id: conversa.id }, data: { fotoUrl: perfil.foto } });
  }
  const agora = new Date(ev.timestamp ?? Date.now());
  const entrada = await prisma.fbMensagem
    .create({ data: { conversaId: conversa.id, direction: "IN", source: "CLIENTE", text: texto, metaMessageId: mid ?? null, createdAt: agora } })
    .catch(() => null); // mesma mensagem chegando duas vezes ao mesmo tempo: a outra execução cuida
  if (!entrada) return;
  // Encerrada que recebe mensagem nova volta a ficar aberta (para o robô, se ele estiver ligado).
  // Condicional: só reabre se ainda estiver encerrada, sem desfazer uma atendente que assumiu nesse meio tempo.
  await prisma.fbConversa.update({ where: { id: conversa.id }, data: { naoLida: true } });
  await prisma.fbConversa.updateMany({ where: { id: conversa.id, status: "CLOSED" }, data: { status: "BOT" } });
  await avancarJanela(conversa.id, agora);

  if (texto === "[mídia]") return;
  await responderComRobo(conversa.id, entrada.id, c.accessToken).catch((err) => console.error("[messenger] robô", err));
}

/**
 * Robô no Messenger: a mesma base de respostas do Instagram, mais conservador. Só responde se estiver ligado na Página,
 * a conversa estiver com o robô, dentro das 24h e for a última mensagem do cliente. Sem resposta segura, passa para a
 * equipe (uma mensagem de aviso a cada 12h, no máximo).
 */
async function responderComRobo(conversaId: string, entradaId: string, token: string) {
  const conversa = await prisma.fbConversa.findUnique({ where: { id: conversaId } });
  if (!conversa || conversa.status !== "BOT" || janela(conversa.lastCustomerMessageAt) !== "livre") return;
  const cfg = await prisma.fbPaginaConfig.findUnique({ where: { paginaId: conversa.paginaId } });
  if (!cfg?.roboAtivo) return;

  const souAUltima = async () => {
    const ultima = await prisma.fbMensagem.findFirst({ where: { conversaId, direction: "IN" }, orderBy: { createdAt: "desc" }, select: { id: true } });
    const atual = await prisma.fbConversa.findUnique({ where: { id: conversaId }, select: { status: true } });
    return ultima?.id === entradaId && atual?.status === "BOT";
  };
  if (!(await souAUltima())) return;

  const ultimas = await prisma.fbMensagem.findMany({ where: { conversaId }, orderBy: { createdAt: "desc" }, take: 10 });
  const historico: Mensagem[] = ultimas.reverse().map((m) => ({ de: m.direction === "IN" ? "cliente" : "loja", texto: m.text }));
  const recentes = ultimas.filter((m) => m.direction === "IN" && m.createdAt > new Date(Date.now() - 30 * 60_000) && m.text !== "[mídia]").slice(-3);
  const ultimaMensagem = recentes[recentes.length - 1]?.text ?? "";
  const contexto = recentes.map((m) => m.text).join("\n") || ultimaMensagem;
  const loja = conversa.loja as Loja;

  // Roteiro de compra da BFF já mandado nas últimas 12h: não repete (segue a base normal).
  const jaMandouRoteiro = !!(await prisma.fbMensagem.findFirst({
    where: { conversaId, source: "BOT", matchedKind: "roteiro", createdAt: { gt: HORAS(12) } },
    select: { id: true },
  }));
  const r = await responder(loja, contexto, historico, { ultimaMensagem, semRoteiroCompra: jaMandouRoteiro });
  if (!(await souAUltima())) return; // a IA demora: alguém pode ter assumido ou o cliente mandou outra

  let partes: string[] = [];
  let kind = "";
  if (r.tipo === "resposta") {
    // Messenger sem botões aqui: o endereço vai escrito no texto; a "segunda mensagem" do roteiro vai logo em seguida.
    partes = r.partes.map((p) => aplicarNome(p, conversa.nome));
    partes[partes.length - 1] = comLinksEscritos(partes[partes.length - 1], r.links?.length ? r.links : r.link ? [r.link] : undefined);
    if (r.seguinte) partes.push(comLinksEscritos(r.seguinte.texto, r.seguinte.links));
    kind = r.id === 9004 ? "roteiro" : r.kind;
  } else if (r.tipo === "saudacao") {
    const jaSaudou = await prisma.fbMensagem.findFirst({ where: { conversaId, source: "BOT", matchedKind: "saudacao", createdAt: { gt: HORAS(6) } }, select: { id: true } });
    if (jaSaudou) return;
    partes = [r.texto];
    kind = "saudacao";
  } else {
    const jaAvisou = await prisma.fbMensagem.findFirst({ where: { conversaId, matchedKind: "atendente", createdAt: { gt: HORAS(12) } }, select: { id: true } });
    if (jaAvisou) {
      await prisma.fbConversa.updateMany({ where: { id: conversaId, status: "BOT" }, data: { status: "NEEDS_HUMAN", naoLida: true } });
      return;
    }
    partes = ["Vou chamar uma atendente para te ajudar com isso, já já ela te responde por aqui 😊"];
    kind = "atendente";
  }

  // Reserva atômica: só uma execução responde a esta mensagem (webhook repetido ou retomada não duplicam).
  const reserva = await prisma.fbMensagem.updateMany({ where: { id: entradaId, matchedKind: null }, data: { matchedKind: "respondida" } });
  if (reserva.count === 0) return;
  for (let i = 0; i < partes.length; i++) {
    if (i > 0) await new Promise((res) => setTimeout(res, 1200));
    // Antes de cada parte: o cliente mandou outra, alguém assumiu ou desligou o robô? Para aqui.
    if (!(await souAUltima())) return;
    if (!(await prisma.fbPaginaConfig.findUnique({ where: { paginaId: conversa.paginaId } }))?.roboAtivo) return;
    const mid = await enviarTexto(token, conversa.paginaId, conversa.psid, partes[i]);
    await prisma.fbMensagem.create({ data: { conversaId, direction: "OUT", source: "BOT", text: partes[i], metaMessageId: mid, matchedKind: kind } });
  }
  // Sem resposta segura: depois do aviso, a conversa vai para a fila da equipe (o robô fica quieto).
  if (kind === "atendente") {
    await prisma.fbConversa.updateMany({ where: { id: conversaId, status: "BOT" }, data: { status: "NEEDS_HUMAN", naoLida: true } });
  }
}
