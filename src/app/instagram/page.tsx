import { redirect } from "next/navigation";

// O painel do Instagram mora dentro do app: Growth › Instagram (mesmo login).
export default function InstagramRedireciona() {
  redirect("/areas/growth/papeis/instagram");
}
