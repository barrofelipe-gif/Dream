import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import InstagramInbox from "@/components/hub/growth/InstagramInbox";
import MessengerInbox from "@/components/hub/growth/MessengerInbox";
import InstagramBoasVindas from "@/components/hub/growth/InstagramBoasVindas";
import InstagramAutomacoes from "@/components/hub/growth/InstagramAutomacoes";
import InstagramMenu from "@/components/hub/growth/InstagramMenu";
import SocialPublicarAba from "@/components/hub/growth/SocialPublicarAba";
import InstagramTransmissoes from "@/components/hub/growth/InstagramTransmissoes";
import InstagramContatos from "@/components/hub/growth/InstagramContatos";
import InstagramSequencias from "@/components/hub/growth/InstagramSequencias";
import InstagramRegras from "@/components/hub/growth/InstagramRegras";
import InstagramRespostasSalvas from "@/components/hub/growth/InstagramRespostasSalvas";
import InstagramFluxos from "@/components/hub/growth/InstagramFluxos";
import SocialMetricas from "@/components/hub/growth/SocialMetricas";
import InstagramResponderComentarios from "@/components/hub/growth/InstagramResponderComentarios";
import InstagramInicio, { type DadosInicio } from "@/components/hub/growth/InstagramInicio";
import InstagramAbas, { type Aba } from "@/components/hub/growth/InstagramAbas";

/**
 * Growth › Instagram: robô de mensagens da BFF e da Moranga. Conversas, contas conectadas
 * e as respostas da equipe (material para a base de perguntas aprender). Só administradores,
 * porque as conversas têm dados de clientes. Mesmo login do app.
 */

const fmt = (d: Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d)
    : "—";

export default async function InstagramPapel() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return (
      <div className="mt-5 rounded-xl border border-dashed border-[#e3e5ea] bg-[#f9fafb] p-3 text-xs text-[#8a8f9c]">
        As conversas do Instagram têm dados de clientes e só aparecem para administradores.
      </div>
    );
  }

  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [contas, recebidas, doRobo, porTipo, humanas, aguardando, naoLidas, totalContatos, novosContatos, topBruto, boasVindas, comentariosAtivos, fluxosAtivos] = await Promise.all([
    prisma.instagramAccount.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.igMessage.count({ where: { direction: "IN", createdAt: { gt: desde } } }),
    prisma.igMessage.count({ where: { source: "BOT", createdAt: { gt: desde } } }),
    prisma.igMessage.groupBy({ by: ["matchedKind"], where: { source: "BOT", createdAt: { gt: desde } }, _count: true }),
    prisma.igMessage.findMany({
      where: { source: "HUMANO" },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { conversation: { include: { account: true } } },
    }),
    // Contadores do menu (como os números do Live Chat do ManyChat): só o que pede ação da equipe.
    prisma.igConversation.count({ where: { status: "NEEDS_HUMAN" } }),
    prisma.igConversation.count({ where: { naoLida: true } }),
    // Página Inicial (como a do ManyChat): contatos, quem mais conversou e o checklist de primeiros passos.
    prisma.igConversation.count(),
    prisma.igConversation.count({ where: { createdAt: { gt: desde } } }),
    prisma.igMessage.groupBy({
      by: ["conversationId"],
      where: { direction: "IN", createdAt: { gt: desde } },
      _count: { _all: true },
      orderBy: { _count: { conversationId: "desc" } },
      take: 10,
    }),
    prisma.igBoasVindas.findMany({ select: { ativo: true, iniciadores: true, menu: true } }),
    prisma.igAutomacao.count({ where: { ativo: true } }),
    prisma.igFluxo.count({ where: { ativo: true } }),
  ]);
  const perfisTop = topBruto.length
    ? await prisma.igConversation.findMany({
        where: { id: { in: topBruto.map((t) => t.conversationId) } },
        select: { id: true, nome: true, username: true, fotoUrl: true },
      })
    : [];
  const top = topBruto
    .map((t) => {
      const p = perfisTop.find((x) => x.id === t.conversationId);
      return p ? { ...p, mensagens: t._count._all } : null;
    })
    .filter((p): p is NonNullable<typeof p> => !!p);

  const contagem = (k: string) => porTipo.find((p) => p.matchedKind === k)?._count ?? 0;
  // Pergunta do cliente que veio antes de cada resposta da equipe: uma consulta só (antes eram 15, e a página demorava ~3 s).
  const entradas = humanas.length
    ? await prisma.igMessage.findMany({
        where: {
          conversationId: { in: [...new Set(humanas.map((h) => h.conversationId))] },
          direction: "IN",
          // Janela: até a resposta mais nova, e no máximo 30 dias antes da mais antiga.
          createdAt: { lt: humanas[0].createdAt, gte: new Date(humanas[humanas.length - 1].createdAt.getTime() - 30 * 86_400_000) },
        },
        orderBy: { createdAt: "desc" },
        select: { conversationId: true, createdAt: true, text: true },
      })
    : [];
  const pares = humanas.map((h) => ({
    h,
    pergunta: entradas.find((e) => e.conversationId === h.conversationId && e.createdAt < h.createdAt) ?? null,
  }));

  const bv = boasVindas;
  const inicio: DadosInicio = {
    nomeLoja: session.user.name?.split(" ")[0] || "equipe",
    contas: contas.map((c) => ({ id: c.id, username: c.username, loja: c.loja, active: c.active })),
    faltaConectar: (["bff", "moranga"] as const).filter((l) => !contas.some((c) => c.loja === l)),
    totalContatos,
    aguardando,
    naoLidas,
    recebidas,
    doRobo,
    novosContatos,
    chamaramAtendente: contagem("atendente"),
    top,
    passos: [
      { id: "boasvindas", titulo: "Mensagem de boas-vindas ligada", feito: bv.some((b) => b.ativo), secao: "boasvindas" },
      { id: "comentarios", titulo: "Comentário vira direct", feito: comentariosAtivos > 0, secao: "comentarios" },
      { id: "menu", titulo: "Perguntas e menu do direct", feito: bv.some((b) => !!b.iniciadores.trim() || !!b.menu.trim()), secao: "menu" },
      { id: "fluxos", titulo: "Um fluxo de conversa ativo", feito: fluxosAtivos > 0, secao: "fluxos" },
    ],
    atualizadoEm: new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date()),
  };

  const abas: Aba[] = [
    { id: "geral", rotulo: "Inicial", grupo: "Início", ajuda: "Resumo da semana, primeiros passos e as contas ligadas.", conteudo: <InstagramInicio d={inicio} /> },
    { id: "conversas", rotulo: "Conversas do Instagram", grupo: "Atendimento", contador: aguardando, ajuda: "Leia e responda o direct. Assuma a conversa para o robô parar e devolva quando terminar.", conteudo: <InstagramInbox /> },
    { id: "messenger", rotulo: "Conversas do Messenger", grupo: "Atendimento", ajuda: "Mensagens da Página do Facebook, com o mesmo jeito de assumir e responder.", conteudo: <MessengerInbox /> },
    { id: "responder-comentarios", rotulo: "Responder comentários", grupo: "Atendimento", ajuda: "Comentários das publicações para responder à mão, um por um.", conteudo: <InstagramResponderComentarios /> },
    { id: "salvas", rotulo: "Respostas salvas", grupo: "Atendimento", ajuda: "Textos prontos: na conversa, digite / e o atalho para usar.", conteudo: <InstagramRespostasSalvas /> },
    { id: "equipe", rotulo: "Respostas da equipe", grupo: "Atendimento", ajuda: "O que a equipe respondeu à mão, para virar resposta do robô.", conteudo: (
      <div className="space-y-6">
      <section>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[#a1a5b0]">Respostas da equipe (para ensinar o robô)</p>
        <p className="mb-2 text-xs text-[#8a8f9c]">
          Quando uma atendente responde pelo Instagram, a pergunta do cliente e a resposta ficam aqui. É a lista para virar
          entrada na base de perguntas do site.
        </p>
        <div className="space-y-2">
          {pares.length === 0 && (
            <div className="rounded-xl border border-[#e3e5ea] p-3 text-sm text-[#8a8f9c]">
              Ainda não há respostas da equipe registradas.
            </div>
          )}
          {pares.map(({ h, pergunta }) => (
            <div key={h.id} className="rounded-xl border border-[#e3e5ea] p-3 text-sm">
              <div className="text-xs text-[#8a8f9c]">
                {fmt(h.createdAt)} · @{h.conversation.account.username}
              </div>
              <div className="mt-1 text-[#5a5f6d]">
                <span className="text-[#a1a5b0]">Cliente:</span> {pergunta?.text ?? "—"}
              </div>
              <div className="mt-1 text-[#1b1f2b]">
                <span className="text-[#a1a5b0]">Equipe:</span> {h.text}
              </div>
            </div>
          ))}
        </div>
      </section>
      </div>
    ) },
    { id: "fluxos", rotulo: "Fluxos de conversa", grupo: "Automações", ajuda: "Monte a conversa do robô em blocos: mensagem, botões e perguntas.", conteudo: <InstagramFluxos /> },
    { id: "comentarios", rotulo: "Comentário vira direct", grupo: "Automações", ajuda: "Quem comentar a palavra escolhida recebe resposta no post e mensagem no direct.", conteudo: <InstagramAutomacoes /> },
    { id: "boasvindas", rotulo: "Boas-vindas", grupo: "Automações", ajuda: "Primeira mensagem para quem escreve para a loja pela primeira vez.", conteudo: <InstagramBoasVindas /> },
    { id: "menu", rotulo: "Menu e perguntas", grupo: "Automações", ajuda: "Botões que aparecem ao abrir o direct e o menu fixo da conversa.", conteudo: <InstagramMenu /> },
    { id: "regras", rotulo: "Regras automáticas", grupo: "Automações", ajuda: "Se acontecer algo (etiqueta, palavra, transferência), o robô faz uma ação.", conteudo: <InstagramRegras /> },
    { id: "contatos", rotulo: "Contatos", grupo: "Clientes", ajuda: "Todo mundo que já escreveu: busque, filtre, etiquete e exporte.", conteudo: <InstagramContatos /> },
    { id: "transmissao", rotulo: "Transmissões", grupo: "Clientes", ajuda: "Uma mensagem para vários contatos de uma vez, dentro das regras do Instagram.", conteudo: <InstagramTransmissoes /> },
    { id: "sequencias", rotulo: "Sequências", grupo: "Clientes", ajuda: "Mensagens que saem sozinhas em etapas, com intervalo entre elas.", conteudo: <InstagramSequencias /> },
    { id: "publicar", rotulo: "Publicar nas redes", grupo: "Redes sociais", ajuda: "Poste foto ou vídeo no Instagram e nas outras redes de uma vez.", conteudo: <SocialPublicarAba /> },
    { id: "metricas", rotulo: "Métricas", grupo: "Redes sociais", ajuda: "Alcance, melhor horário, formatos e público das contas.", conteudo: <SocialMetricas /> },
  ];

  return (
    <div className="mt-3 border-t border-[#e3e5ea] pt-3 sm:mt-6 sm:pt-6">
      <InstagramAbas abas={abas} />
    </div>
  );
}
