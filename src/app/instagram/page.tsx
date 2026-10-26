import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { rotulo: string; cor: string }> = {
  BOT: { rotulo: "Robô atendendo", cor: "bg-emerald-500/15 text-emerald-300" },
  NEEDS_HUMAN: { rotulo: "Aguardando atendente", cor: "bg-amber-500/15 text-amber-300" },
  HUMAN: { rotulo: "Atendente respondeu", cor: "bg-sky-500/15 text-sky-300" },
  CLOSED: { rotulo: "Encerrada", cor: "bg-zinc-500/15 text-zinc-300" },
};

const fmt = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d) : "—";

export default async function InstagramPainel({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/painel");

  const { status = "todas" } = await searchParams;
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
  const respostasBase = contagem("faq") + contagem("pergunta");

  // Para cada resposta da equipe, a última pergunta do cliente antes dela (material para a base aprender).
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
    ["Respondidas com a base", respostasBase],
    ["Chamaram atendente", contagem("atendente")],
  ];

  return (
    <div className="min-h-screen bg-[#0c0d10] px-6 py-10 text-zinc-200">
      <div className="mx-auto max-w-5xl space-y-8">
        <div>
          <Link href="/painel" className="text-sm text-zinc-500 hover:text-zinc-300">
            ← Painel
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-white">Instagram — robô de mensagens</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Conversas, contas conectadas e o que a equipe respondeu (material para a base aprender).
          </p>
        </div>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {cartoes.map(([t, n]) => (
            <div key={t} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-2xl font-semibold text-white">{n}</div>
              <div className="mt-1 text-xs text-zinc-400">{t}</div>
            </div>
          ))}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-300">Contas conectadas</h2>
          <div className="space-y-2">
            {contas.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"
              >
                <div>
                  <span className="font-medium text-white">@{c.username}</span>
                  <span className="ml-2 text-zinc-400">loja {c.loja}</span>
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs ${c.active ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-300"}`}
                  >
                    {c.active ? "ativa" : "inativa"}
                  </span>
                </div>
                <a href={`/api/instagram/connect?loja=${c.loja}`} className="text-xs text-zinc-400 hover:text-white">
                  Reconectar
                </a>
              </div>
            ))}
            {!contas.some((c) => c.loja === "moranga") && (
              <a
                href="/api/instagram/connect?loja=moranga"
                className="block rounded-xl border border-dashed border-white/15 px-4 py-3 text-sm text-zinc-300 hover:border-white/30"
              >
                + Conectar a conta da Moranga
              </a>
            )}
            {!contas.some((c) => c.loja === "bff") && (
              <a
                href="/api/instagram/connect?loja=bff"
                className="block rounded-xl border border-dashed border-white/15 px-4 py-3 text-sm text-zinc-300 hover:border-white/30"
              >
                + Conectar a conta da BFF
              </a>
            )}
          </div>
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="mr-2 text-sm font-medium text-zinc-300">Conversas</h2>
            {filtros.map(([v, r]) => (
              <Link
                key={v}
                href={`/instagram?status=${v}`}
                className={`rounded-full px-3 py-1 text-xs ${status === v ? "bg-white text-black" : "bg-white/10 text-zinc-300 hover:bg-white/15"}`}
              >
                {r}
              </Link>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-white/10">
            {conversas.length === 0 && <div className="p-4 text-sm text-zinc-400">Nenhuma conversa ainda.</div>}
            {conversas.map((c) => {
              const s = STATUS[c.status] ?? STATUS.CLOSED;
              const ultima = c.messages[0];
              return (
                <Link
                  key={c.id}
                  href={`/instagram/${c.id}`}
                  className="flex items-start justify-between gap-4 border-b border-white/5 bg-white/[0.02] px-4 py-3 text-sm last:border-0 hover:bg-white/[0.05]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-300">Cliente …{c.igScopedUserId.slice(-6)}</span>
                      <span className="text-xs text-zinc-500">@{c.account.username}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${s.cor}`}>{s.rotulo}</span>
                    </div>
                    <div className="mt-1 truncate text-zinc-400">
                      {ultima
                        ? `${ultima.direction === "IN" ? "Cliente" : ultima.source === "HUMANO" ? "Equipe" : "Robô"}: ${ultima.text}`
                        : "—"}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-zinc-500">{fmt(c.lastCustomerMessageAt)}</div>
                </Link>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-sm font-medium text-zinc-300">Respostas da equipe (para ensinar o robô)</h2>
          <p className="mb-2 text-xs text-zinc-500">
            Quando uma atendente responde pelo Instagram, a pergunta do cliente e a resposta ficam aqui. É a lista para
            virar entrada na base de perguntas do site.
          </p>
          <div className="space-y-2">
            {pares.length === 0 && (
              <div className="rounded-xl border border-white/10 p-4 text-sm text-zinc-400">
                Ainda não há respostas da equipe registradas.
              </div>
            )}
            {pares.map(({ h, pergunta }) => (
              <div key={h.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
                <div className="text-xs text-zinc-500">
                  {fmt(h.createdAt)} · @{h.conversation.account.username}
                </div>
                <div className="mt-1 text-zinc-300">
                  <span className="text-zinc-500">Cliente:</span> {pergunta?.text ?? "—"}
                </div>
                <div className="mt-1 text-zinc-200">
                  <span className="text-zinc-500">Equipe:</span> {h.text}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
