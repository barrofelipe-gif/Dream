import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import UsersClient from "./UsersClient";

export default async function UsuariosPage() {
  const session = await auth();
  if (session?.user?.role !== "admin") redirect("/painel");

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      sectorAccess: { select: { sector: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const initialUsers = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    sectors: u.sectorAccess.map((a) => a.sector),
  }));

  return <UsersClient initialUsers={JSON.parse(JSON.stringify(initialUsers))} currentUserId={session.user.id} />;
}
