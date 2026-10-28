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
import InstagramAbas, { type Aba } from "@/components/hub/growth/InstagramAbas";

/**
 * Growth › Instagram: robô de mensagens da BFF e da Moranga. Conversas, contas conectadas
 * e as respostas da equipe (material para a base de perguntas aprender). Só administradores,
 * porque as conversas têm dados de clientes. Mesmo login do app.
 */

/** Atalhos da Visão geral: abrem a seção pelo endereço (#id). */
const ATALHOS: [string, string, string][] = [
  ["conversas", "Responder mensagens", "Caixa de entrada do direct, com filtros e busca."],
  ["comentarios", "Comentário vira direct", "Quem comentar a palavra recebe o link no direct."],
  ["fluxos", "Fluxos de conversa", "Monte o caminho do robô com botões e perguntas."],
  ["contatos", "Contatos e etiquetas", "Encontre clientes, filtre e exporte a lista."],
  ["transmissao", "Mandar para vários", "Uma mensagem para um grupo de contatos."],
  ["metricas", "Métricas", "Como as publicações estão indo."],
];

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
  const [contas, recebidas, doRobo, porTipo, humanas, aguardando, naoLidas] = await Promise.all([
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
  ]);

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

  const cartoes: [string, number][] = [
    ["Mensagens recebidas (7 dias)", recebidas],
    ["Respostas do robô", doRobo],
    ["Respondidas com a base", contagem("faq") + contagem("pergunta")],
    ["Chamaram atendente", contagem("atendente")],
  ];

  const abas: Aba[] = [
    { id: "geral", rotulo: "Visão geral", grupo: "Início", ajuda: "Números da semana, contas ligadas e o que precisa da sua atenção.", conteudo: (
      <div className="space-y-6">
      {(aguardando > 0 || naoLidas > 0) && (
        <a
          href="#conversas"
          className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:border-amber-300"
        >
          <span className="min-w-0 flex-1">
            {aguardando > 0 && (
              <>
                <b>{aguardando}</b> conversa{aguardando === 1 ? "" : "s"} aguardando atendente
              </>
            )}
            {aguardando > 0 && naoLidas > 0 && " · "}
            {naoLidas > 0 && (
              <>
                <b>{naoLidas}</b> conversa{naoLidas === 1 ? "" : "s"} não lida{naoLidas === 1 ? "" : "s"}
              </>
            )}
          </span>
          <span className="shrink-0 font-medium">Abrir conversas →</span>
        </a>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cartoes.map(([t, n]) => (
          <div key={t} className="rounded-xl border border-[#e3e5ea] bg-[#f9fafb] p-3">
            <div className="text-xl font-semibold text-[#1b1f2b]">{n}</div>
            <div className="mt-0.5 text-[11px] text-[#8a8f9c]">{t}</div>
          </div>
        ))}
      </div>

      <section>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#a1a5b0]">Contas conectadas</p>
        <div className="space-y-2">
          {contas.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-xl border border-[#e3e5ea] px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-[#1b1f2b]">@{c.username}</span>
                <span className="ml-2 text-[#8a8f9c]">loja {c.loja}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${c.active ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
                  {c.active ? "ativa" : "inativa"}
                </span>
              </div>
              <a href={`/api/instagram/connect?loja=${c.loja}`} className="text-xs text-[#6366f1] hover:underline">
                Reconectar
              </a>
            </div>
          ))}
          {(["bff", "moranga"] as const)
            .filter((l) => !contas.some((c) => c.loja === l))
            .map((l) => (
              <a
                key={l}
                href={`/api/instagram/connect?loja=${l}`}
                className="block rounded-xl border border-dashed border-[#d5d8e0] px-3 py-2 text-sm text-[#5a5f6d] hover:border-[#6366f1]"
              >
                + Conectar a conta da {l === "bff" ? "BFF" : "Moranga"}
              </a>
            ))}
        </div>
      </section>

      <section>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#a1a5b0]">Atalhos</p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {ATALHOS.map(([id, titulo, texto]) => (
            <a key={id} href={`#${id}`} className="block min-h-[44px] rounded-xl border border-[#e3e5ea] px-3 py-2.5 hover:border-[#6366f1] hover:bg-[#f7f7ff]">
              <span className="block text-sm font-medium text-[#1b1f2b]">{titulo} →</span>
              <span className="block text-xs text-[#8a8f9c]">{texto}</span>
            </a>
          ))}
        </div>
      </section>
      </div>
    ) },
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
