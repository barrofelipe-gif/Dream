import "server-only";

/** Valida e limpa os campos de uma automação vindos do painel. Devolve os dados ou a mensagem de erro. */
export function lerAutomacao(body: unknown): { dados: Record<string, string | boolean> } | { erro: string } {
  if (!body || typeof body !== "object") return { erro: "Dados inválidos" };
  const b = body as Record<string, unknown>;
  const t = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  const nome = t(b.nome, 80);
  const dmTexto = t(b.dmTexto, 1000);
  if (!nome) return { erro: "Dê um nome para a automação" };
  if (!dmTexto) return { erro: "Escreva a mensagem que será enviada no direct" };

  const dmBotaoUrl = t(b.dmBotaoUrl, 400);
  if (dmBotaoUrl && !/^https:\/\//i.test(dmBotaoUrl)) return { erro: "O link do botão precisa começar com https://" };
  const exigirSeguir = !!b.exigirSeguir;

  return {
    dados: {
      nome,
      ativo: !!b.ativo,
      midiaId: t(b.midiaId, 60),
      midiaLegenda: t(b.midiaLegenda, 200),
      midiaThumb: t(b.midiaThumb, 600),
      palavras: t(b.palavras, 300),
      modoPalavra: b.modoPalavra === "exata" ? "exata" : "contem",
      respostasPublicas: t(b.respostasPublicas, 1500),
      dmTexto,
      dmBotaoTitulo: t(b.dmBotaoTitulo, 20),
      dmBotaoUrl,
      exigirSeguir,
      seguirTexto: exigirSeguir ? t(b.seguirTexto, 600) : "",
      seguirBotao: t(b.seguirBotao, 20) || "Já segui",
    },
  };
}
