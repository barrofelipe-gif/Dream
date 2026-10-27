// Detecção simples de intenção em mensagens de DM (pura, sem banco). Tudo é comparado sem acento e em minúsculas,
// então os padrões abaixo não têm acento (e \b funciona).

const sem = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Pedido de atendente: exige um verbo de pedido perto da palavra ("quero falar com a atendente").
// Palavras soltas como "dona", "pessoa", "atendimento" ou "vendedora" NÃO bastam ("sou dona de loja", "o atendimento é ótimo").
const ALVO_HUMANO = "(?:atendente|humano|humana|humanos|alguem|pessoa de verdade|pessoa real|vendedor|vendedora|equipe|gerente|funcionario|funcionaria)";
const PEDIDO_HUMANO: RegExp[] = [
  new RegExp(
    String.raw`\b(?:quero|preciso|precisava|queria|posso|pode|podem|poderia|poderiam|gostaria|chama|chamar|chame|chamem|me passa|passa|passe|me transfere|transfere|falar com|fala com|conversar com|conversa com)\b.{0,25}\b${ALVO_HUMANO}\b`,
  ),
  /\bfal(?:ar|a) com (?:a |o )?(?:gente|equipe|loja|pessoal)\b/,
  /\b(?:falar|conversar|fala|conversa) com (?:o |a )?(?:dono|dona|responsavel)\b/,
  /\bhumanos?\b|\bhumana\b/,
  /\b(?:alguem|ninguem) ai\b|\btem (?:alguem|ninguem)\b/,
  /^\W*(?:atendente|atendimento|vendedor|vendedora)\W*$/,
];

export function pedeHumano(texto: string): boolean {
  const t = sem(texto);
  return PEDIDO_HUMANO.some((r) => r.test(t));
}

// A pessoa se declara cliente ("já comprei", "fiz um pedido"): vira "Comprador" e sai das cobranças em massa.
const ARTIGO = "(?:um |uma |o |a |meu |minha |outro |outra )?";
const AFIRMA =
  String.raw`\b(?:comprei|compramos|adquiri|adquirimos|compravamos|comprava|fiz ${ARTIGO}(?:pedido|compra)|fizemos ${ARTIGO}(?:pedido|compra)|ja sou (?:cliente|revendedora?)|ja fui cliente|ja compro)\b`;
const NEGA =
  String.raw`\b(?:nao|nunca|jamais)\s+(?:\S+\s+)?(?:comprei|compramos|adquiri|adquirimos|fiz ${ARTIGO}(?:pedido|compra)|fizemos ${ARTIGO}(?:pedido|compra))\b`;
// "se já comprei", "caso eu tenha comprado", "não sei se comprei": hipótese, não declaração.
const HIPOTESE = /(?:^|[^a-z])(?:se|caso|sera que|nao sei se|e se)(?:[^a-z]+[a-z]+){0,2}[^a-z]*$/;

/**
 * Vale como comprador quando o ÚLTIMO fato dito é afirmativo: "não comprei antes, mas hoje comprei" é comprador;
 * "não comprei ainda", "nunca comprei aí", "se eu comprar", "vou comprar" não são. Pergunta ("já comprei?") e
 * hipótese ("se já comprei") não contam.
 */
export function declaraCompra(texto: string): boolean {
  const t = sem(texto);
  let ultimaAfirmacao = -1;
  let ultimaNegacao = -1;
  let base = 0;
  // Trabalha por trecho (até . ! ? ; , ou quebra de linha): só o trecho que termina em "?" é pergunta,
  // então "já comprei e quero comprar de novo, tem desconto?" continua sendo comprador.
  for (const trecho of t.match(/[^.!?\n;,]+[.!?\n;,]*/g) ?? []) {
    const ehPergunta = trecho.includes("?");
    for (const m of trecho.matchAll(new RegExp(NEGA, "g"))) ultimaNegacao = Math.max(ultimaNegacao, base + (m.index ?? 0));
    const negados = [...trecho.matchAll(new RegExp(NEGA, "g"))].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
    if (!ehPergunta) {
      for (const m of trecho.matchAll(new RegExp(AFIRMA, "g"))) {
        const ini = m.index ?? 0;
        if (negados.some(([a, b]) => ini >= a && ini < b)) continue; // o "comprei" de "não comprei"
        if (HIPOTESE.test(trecho.slice(0, ini))) continue;
        ultimaAfirmacao = Math.max(ultimaAfirmacao, base + ini);
      }
    }
    base += trecho.length;
  }
  return ultimaAfirmacao > ultimaNegacao;
}
