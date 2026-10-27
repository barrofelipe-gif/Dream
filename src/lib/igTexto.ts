// Utilitários de texto puros (sem banco, sem "server-only"): usados no servidor e no navegador.

/** Minúsculas, sem acento e com espaços colapsados. */
export const normaliza = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** A palavra (ou expressão) aparece como palavra inteira no texto, sem ligar para acento ou maiúscula. */
export function contemPalavra(texto: string, palavra: string): boolean {
  const t = ` ${normaliza(texto).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const p = normaliza(palavra).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return !!p && t.includes(` ${p} `);
}

/** Corta em `max` caracteres sem partir um par substituto (emoji). */
export function cortarCaracteres(texto: string, max: number): string {
  const pts = Array.from(texto);
  return pts.length <= max ? texto : pts.slice(0, max).join("");
}

/** Corta em `max` BYTES (UTF-8), sem partir um caractere nem um emoji ao meio. A Meta conta o limite do texto em bytes. */
export function cortarBytes(texto: string, max: number): string {
  const enc = new TextEncoder();
  if (enc.encode(texto).length <= max) return texto;
  let total = 0;
  let saida = "";
  for (const ch of texto) {
    const b = enc.encode(ch).length;
    if (total + b > max) break;
    total += b;
    saida += ch;
  }
  return saida;
}
