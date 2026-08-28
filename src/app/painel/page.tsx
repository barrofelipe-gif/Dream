import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeItem } from "@/lib/serialize";
import PainelClient from "./PainelClient";

export default async function PainelPage() {
  const session = await auth();
  const items = await prisma.item.findMany({
    where: { ownerId: session!.user.id },
    include: { column: { select: { isDone: true } } },
    orderBy: [{ due: "asc" }, { createdAt: "desc" }],
  });

  return (
    <PainelClient
      initialItems={JSON.parse(JSON.stringify(items.map(serializeItem)))}
      userName={session!.user.name ?? session!.user.email ?? "Você"}
    />
  );
}
