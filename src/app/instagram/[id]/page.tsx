import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const fmt = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d);

const ORIGEM: Record<string, string> = {
  esclarecer: "pediu detalhes",
  atendente: "chamou atendente",
  saudacao: "conversa",
  faq: "resposta da base",
  pergunta: "resposta da base",
};

export default async function ConversaPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/painel");

  const { id } = await params;
  const conversa = await prisma.igConversation.findUnique({
    where: { id },
    include: { account: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversa) notFound();

  return (
    <div className="min-h-screen bg-[#0c0d10] px-6 py-10 text-zinc-200">
      <div className="mx-auto max-w-2xl">
        <Link href="/instagram" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Conversas
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">
          Cliente …{conversa.igScopedUserId.slice(-6)} · @{conversa.account.username}
        </h1>
        <p className="mb-4 text-xs text-zinc-500">
          Status: {conversa.status} · última mensagem do cliente:{" "}
          {conversa.lastCustomerMessageAt ? fmt(conversa.lastCustomerMessageAt) : "—"}
        </p>
        <div className="space-y-2">
          {conversa.messages.map((m) => {
            const cliente = m.direction === "IN";
            const quem = cliente
              ? "cliente"
              : m.source === "HUMANO"
                ? "equipe"
                : `robô${m.matchedKind ? ` (${ORIGEM[m.matchedKind] ?? m.matchedKind}${m.matchedId ? ` #${m.matchedId}` : ""})` : ""}`;
            return (
              <div key={m.id} className={`flex ${cliente ? "justify-start" : "justify-end"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${cliente ? "bg-white/10 text-zinc-100" : m.source === "HUMANO" ? "bg-sky-600/30 text-sky-50" : "bg-emerald-600/25 text-emerald-50"}`}
                >
                  <div className="whitespace-pre-wrap">{m.text}</div>
                  <div className="mt-1 text-[10px] text-zinc-400">
                    {fmt(m.createdAt)} · {quem}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-xs text-zinc-500">
          Para responder, use o app do Instagram (a caixa da conta). Ao responder por lá, o robô para de atender essa
          conversa por 24 horas.
        </p>
      </div>
    </div>
  );
}
