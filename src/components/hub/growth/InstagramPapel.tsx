import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Growth › Instagram: robô de mensagens da BFF e da Moranga. Conversas, contas conectadas
 * e as respostas da equipe (material para a base de perguntas aprender). Só administradores,
 * porque as conversas têm dados de clientes. Mesmo login do app.
 */
const BASE = "/areas/growth/papeis/instagram";

const STATUS: Record<string, { rotulo: string; cor: string }> = {
  BOT: { rotulo: "Robô atendendo", cor: "bg-emerald-50 text-emerald-700" },
  NEEDS_HUMAN: { rotulo: "Aguardando atendente", cor: "bg-amber-50 text-amber-700" },
  HUMAN: { rotulo: "Atendente respondeu", cor: "bg-sky-50 text-sky-700" },
  CLOSED: { rotulo: "Encerrada", cor: "bg-zinc-100 text-zinc-600" },
};

const ORIGEM: Record<string, string> = {
  esclarecer: "pediu detalhes",
  atendente: "chamou atendente",
  saudacao: "conversa",
  faq: "resposta da base",
  pergunta: "resposta da base",
};

const fmt = (d: Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d)
    : "—";

export default async function InstagramPapel({ status = "todas", conversa }: { status?: string; conversa?: string }) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return (
      <div className="mt-5 rounded-xl border border-dashed border-[#e3e5ea] bg-[#f9fafb] p-3 text-xs text-[#8a8f9c]">
        As conversas do Instagram têm dados de clientes e só aparecem para administradores.
      </div>
    );
  }
  if (conversa) return <Conversa id={conversa} />;

  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [contas, conversas, recebidas, doRobo, porTipo, humanas] = await Promise.all([
    prisma.instagramAccount.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.igConversation.findMany({
      where: status === "todas" ? {} : { status },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { account: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    prisma.igMessage.count({ where: { direction: "IN", createdAt: { gt: desde } } }),
    prisma.igMessage.count({ where: { source: "BOT", createdAt: { gt: desde } } }),
    prisma.igMessage.groupBy({ by: ["matchedKind"], where: { source: "BOT", createdAt: { gt: desde } }, _count: true }),
    prisma.igMessage.findMany({
      where: { source: "HUMANO" },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { conversation: { include: { account: true } } },
    }),
  ]);

  const contagem = (k: string) => porTipo.find((p) => p.matchedKind === k)?._count ?? 0;
  const pares = await Promise.all(
    humanas.map(async (h) => ({
      h,
      pergunta: await prisma.igMessage.findFirst({
        where: { conversationId: h.conversationId, direction: "IN", createdAt: { lt: h.createdAt } },
        orderBy: { createdAt: "desc" },
      }),
    })),
  );

  const filtros = [
    ["todas", "Todas"],
    ["NEEDS_HUMAN", "Aguardando atendente"],
    ["BOT", "Robô atendendo"],
    ["HUMAN", "Atendente respondeu"],
  ];
  const cartoes: [string, number][] = [
    ["Mensagens recebidas (7 dias)", recebidas],
    ["Respostas do robô", doRobo],
    ["Respondidas com a base", contagem("faq") + contagem("pergunta")],
    ["Chamaram atendente", contagem("atendente")],
  ];

  return (
    <div className="mt-6 space-y-6 border-t border-[#e3e5ea] pt-6">
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
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="mr-2 text-xs font-medium uppercase tracking-wide text-[#a1a5b0]">Conversas</p>
          {filtros.map(([v, r]) => (
            <Link
              key={v}
              href={`${BASE}?status=${v}`}
              className={`rounded-full px-3 py-1 text-xs ${status === v ? "bg-[#1b1f2b] text-white" : "bg-[#eef0f4] text-[#5a5f6d] hover:bg-[#e3e5ea]"}`}
            >
              {r}
            </Link>
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border border-[#e3e5ea]">
          {conversas.length === 0 && <div className="p-3 text-sm text-[#8a8f9c]">Nenhuma conversa ainda.</div>}
          {conversas.map((c) => {
            const s = STATUS[c.status] ?? STATUS.CLOSED;
            const ultima = c.messages[0];
            return (
              <Link
                key={c.id}
                href={`${BASE}?conversa=${c.id}`}
                className="flex items-start justify-between gap-4 border-b border-[#eef0f4] px-3 py-2.5 text-sm last:border-0 hover:bg-[#f9fafb]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[#1b1f2b]">Cliente …{c.igScopedUserId.slice(-6)}</span>
                    <span className="text-xs text-[#8a8f9c]">@{c.account.username}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${s.cor}`}>{s.rotulo}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[#5a5f6d]">
                    {ultima
                      ? `${ultima.direction === "IN" ? "Cliente" : ultima.source === "HUMANO" ? "Equipe" : "Robô"}: ${ultima.text}`
                      : "—"}
                  </div>
                </div>
                <div className="shrink-0 text-xs text-[#8a8f9c]">{fmt(c.lastCustomerMessageAt)}</div>
              </Link>
            );
          })}
        </div>
      </section>

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
  );
}

async function Conversa({ id }: { id: string }) {
  const c = await prisma.igConversation.findUnique({
    where: { id },
    include: { account: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!c) return <div className="mt-5 text-sm text-[#8a8f9c]">Conversa não encontrada.</div>;

  return (
    <div className="mt-6 border-t border-[#e3e5ea] pt-6">
      <Link href={BASE} className="text-xs font-medium text-[#8a8f9c] hover:text-[#1b1f2b]">
        ← Voltar às conversas
      </Link>
      <p className="mt-2 text-sm font-semibold text-[#1b1f2b]">
        Cliente …{c.igScopedUserId.slice(-6)} · @{c.account.username}
      </p>
      <p className="mb-4 text-xs text-[#8a8f9c]">
        Status: {STATUS[c.status]?.rotulo ?? c.status} · última mensagem do cliente: {fmt(c.lastCustomerMessageAt)}
      </p>
      <div className="space-y-2">
        {c.messages.map((m) => {
          const cliente = m.direction === "IN";
          const quem = cliente
            ? "cliente"
            : m.source === "HUMANO"
              ? "equipe"
              : `robô${m.matchedKind ? ` (${ORIGEM[m.matchedKind] ?? m.matchedKind}${m.matchedId ? ` #${m.matchedId}` : ""})` : ""}`;
          return (
            <div key={m.id} className={`flex ${cliente ? "justify-start" : "justify-end"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${cliente ? "bg-[#eef0f4] text-[#1b1f2b]" : m.source === "HUMANO" ? "bg-sky-100 text-sky-900" : "bg-emerald-100 text-emerald-900"}`}
              >
                <div className="whitespace-pre-wrap">{m.text}</div>
                <div className="mt-1 text-[10px] text-[#8a8f9c]">
                  {fmt(m.createdAt)} · {quem}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-5 text-xs text-[#8a8f9c]">
        Para responder, use o app do Instagram (a caixa da conta). Ao responder por lá, o robô para de atender essa conversa
        por 24 horas.
      </p>
    </div>
  );
}
