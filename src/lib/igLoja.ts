import { cookies } from "next/headers";
import { COOKIE_LOJA, type LojaPainel } from "@/lib/igLojaCliente";

/**
 * Empresa escolhida no topo do painel do Instagram (BFF ou Moranga). Cada lista e cada número do painel
 * mostram só essa empresa: as duas nunca aparecem juntas. Sem escolha, é a BFF.
 */
export async function lojaDoPainel(): Promise<LojaPainel> {
  return (await cookies()).get(COOKIE_LOJA)?.value === "moranga" ? "moranga" : "bff";
}
