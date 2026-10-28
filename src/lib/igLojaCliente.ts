// Empresa escolhida no topo do painel do Instagram, lida no navegador (o servidor lê o mesmo cookie em igLoja.ts).

export type LojaPainel = "bff" | "moranga";
export const COOKIE_LOJA = "ig_loja";
export const NOME_LOJA: Record<LojaPainel, string> = { bff: "BFF Fitness", moranga: "Moranga" };

export function lojaDoNavegador(): LojaPainel {
  if (typeof document === "undefined") return "bff";
  return /(?:^|;\s*)ig_loja=moranga(?:;|$)/.test(document.cookie) ? "moranga" : "bff";
}

/** Troca a empresa e recarrega: todas as seções e números passam a ser só dela. */
export function trocarLoja(loja: LojaPainel) {
  document.cookie = `${COOKIE_LOJA}=${loja}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}
