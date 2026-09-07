import { redirect } from "next/navigation";
import { auth } from "@/auth";
import HubClient from "./HubClient";

/**
 * Hub — camada acima dos dashboards, com as sete áreas. Fica atrás do login
 * (proxy.ts exige sessão pra tudo que não está na lista pública).
 */
export default async function HubPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <HubClient nomeUsuario={session.user.name?.split(" ")[0] ?? "você"} />;
}
