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
    mensagem: "Ei, {nome}, tudo bem? O que eu posso te ajudar?",
    botao: "",
    pedirSeguir: true,
    textoSeguir: "Ah, e segue a gente aqui pra ficar por dentro das novidades 😉",
    infoTexto: "",
    linkTitulo: "Ver o site",
    linkUrl: "https://www.bfffitnessatacado.com.br?parceiro=4273",
  },
  moranga: {
    ativo: true,
    mensagem: "Ei, {nome}, tudo bem? O que eu posso te ajudar?",
    botao: "",
    pedirSeguir: true,
    textoSeguir: "Ah, e segue a gente aqui pra ficar por dentro das novidades 😉",
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
