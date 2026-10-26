/** Atalho sem barra, minúsculo, sem espaço nem acento: "/Frete Grátis" → "frete-gratis". */
export function limparAtalho(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}
