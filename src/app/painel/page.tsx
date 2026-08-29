import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { itemInclude, serializeItem } from "@/lib/serialize";
import PainelClient from "./PainelClient";

export default async function PainelPage() {
  const session = await auth();
  const items = await prisma.item.findMany({
    where: { ownerId: session!.user.id },
    include: itemInclude,
    orderBy: [{ due: "asc" }, { createdAt: "desc" }],
  });

  // Outros usuários do sistema, pra poder atribuir uma pendência a alguém
  // além de si mesmo ("Atribuir para" no modal). Time pequeno e de
  // confiança — qualquer um pode ver os nomes dos outros pra delegar.
  const otherUsers = await prisma.user.findMany({
    where: { id: { not: session!.user.id } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <PainelClient
      initialItems={JSON.parse(JSON.stringify(items.map(serializeItem)))}
      userName={session!.user.name ?? session!.user.email ?? "Você"}
      currentUserId={session!.user.id}
      otherUsers={otherUsers}
    />
  );
}
