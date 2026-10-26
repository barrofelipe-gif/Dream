import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import InstagramInbox from "@/components/hub/growth/InstagramInbox";
import InstagramBoasVindas from "@/components/hub/growth/InstagramBoasVindas";
import InstagramAutomacoes from "@/components/hub/growth/InstagramAutomacoes";
import InstagramMenu from "@/components/hub/growth/InstagramMenu";
import SocialPublicador from "@/components/hub/growth/SocialPublicador";

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
  const [contas, recebidas, doRobo, porTipo, humanas] = await Promise.all([
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

      <SocialPublicador />

      <InstagramInbox />

      <InstagramAutomacoes />

      <InstagramBoasVindas />

      <InstagramMenu />

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
