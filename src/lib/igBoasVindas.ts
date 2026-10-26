import "server-only";
import { prisma } from "@/lib/prisma";
import type { Loja } from "@/lib/avaliacoesLeitura";

export type BoasVindasConfig = {
  ativo: boolean;
  mensagem: string;
  botao: string;
  pedirSeguir: boolean;
  textoSeguir: string;
  infoTexto: string;
  linkTitulo: string;
  linkUrl: string;
};

export const BOTAO_DUVIDA = "Tenho uma dúvida";
export const PAYLOAD_SIM = "BV_SIM";
export const PAYLOAD_DUVIDA = "BV_DUVIDA";

export const PADRAO: Record<Loja, BoasVindasConfig> = {
  bff: {
    ativo: true,
    mensagem:
      "Oi, {nome}! Que bom ter você por aqui na BFF Fitness Atacado. Posso te mandar agora as informações para comprar no atacado (pedido mínimo, pagamento, prazo e como funciona)?",
    botao: "Sim, manda aí",
    pedirSeguir: true,
    textoSeguir: "Aproveita e segue a gente aqui no Instagram para ficar por dentro dos lançamentos e das promoções.",
    infoTexto: "",
    linkTitulo: "Ver o site",
    linkUrl: "https://www.bfffitnessatacado.com.br",
  },
  moranga: {
    ativo: true,
    mensagem:
      "Oi, {nome}! Que bom ter você por aqui na Moranga Biquínis. Quer que eu te mande as informações de como comprar (pagamento, prazo e como funciona)?",
    botao: "Sim, manda aí",
    pedirSeguir: true,
    textoSeguir: "Aproveita e segue a gente aqui no Instagram para ficar por dentro das novidades e das promoções.",
    infoTexto: "",
    linkTitulo: "Ver o site",
    linkUrl: "https://www.usemoranga.com.br",
  },
};

/** Config da loja: a linha salva no banco, ou o padrão do código se ainda não foi editada. */
export async function carregarConfig(loja: Loja): Promise<BoasVindasConfig> {
  const row = await prisma.igBoasVindas.findUnique({ where: { loja } });
  if (!row) return PADRAO[loja];
  return {
    ativo: row.ativo,
    mensagem: row.mensagem,
    botao: row.botao,
    pedirSeguir: row.pedirSeguir,
    textoSeguir: row.textoSeguir,
    infoTexto: row.infoTexto,
    linkTitulo: row.linkTitulo,
    linkUrl: row.linkUrl,
  };
}

/** Troca {nome} pelo primeiro nome; sem nome, tira o trecho ", {nome}". */
export function aplicarNome(texto: string, nomeCompleto: string | null): string {
  const primeiro = nomeCompleto?.trim().split(/\s+/)[0];
  if (primeiro) return texto.replaceAll("{nome}", primeiro);
  return texto.replace(/,\s*\{nome\}/g, "").replace(/\{nome\}\s*/g, "");
}
