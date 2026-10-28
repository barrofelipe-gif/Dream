import "server-only";
import { prisma } from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/crypto";
import type { ContaAberta, Rede } from "@/lib/social/types";

/** Abre uma conta salva (descriptografa os tokens). Nunca devolver isto ao navegador. */
export async function abrirConta(contaId: string): Promise<ContaAberta | null> {
  const c = await prisma.socialConta.findUnique({ where: { id: contaId } });
  if (!c || !c.ativo) return null;
  let extra: Record<string, unknown> = {};
  try {
    extra = JSON.parse(c.extra);
  } catch {
    /* extra inválido: segue vazio */
  }
  return {
    id: c.id,
    rede: c.rede as Rede,
    loja: c.loja,
    externoId: c.externoId,
    nome: c.nome,
    username: c.username,
    accessToken: decrypt(c.accessToken),
    refreshToken: c.refreshToken ? decrypt(c.refreshToken) : null,
    expiraEm: c.expiraEm,
    extra,
  };
}

/** Grava (ou atualiza) uma conta conectada. Os adaptadores chamam isto no callback do OAuth. */
export async function salvarConta(d: {
  rede: Rede;
  loja: string;
  externoId: string;
  nome?: string | null;
  username?: string | null;
  fotoUrl?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiraEm?: Date | null;
  escopos?: string;
  extra?: Record<string, unknown>;
}) {
  const dados = {
    loja: d.loja,
    nome: d.nome ?? null,
    username: d.username ?? null,
    fotoUrl: d.fotoUrl ?? null,
    accessToken: encrypt(d.accessToken),
    refreshToken: d.refreshToken ? encrypt(d.refreshToken) : null,
    expiraEm: d.expiraEm ?? null,
    escopos: d.escopos ?? "",
    extra: JSON.stringify(d.extra ?? {}),
    ativo: true,
  };
  // BFF e Moranga nunca se misturam (mesma trava do Instagram): logado na rede de uma marca e clicou no botão da outra,
  // a conta não troca de loja escondido. O nome/@ decide quando diz a marca; sem marca no nome, conta já ligada não muda.
  const nomeLoja = (l: string) => (l === "bff" ? "BFF" : "Moranga");
  const texto = `${d.nome ?? ""} ${d.username ?? ""}`;
  const marca = /bff/i.test(texto) ? "bff" : /moranga/i.test(texto) ? "moranga" : null;
  if (marca && marca !== d.loja) {
    throw new Error(`${d.nome || d.username || "esta conta"} é da ${nomeLoja(marca)}. Para conectar a ${nomeLoja(d.loja)}, saia dessa conta e entre com a da ${nomeLoja(d.loja)}. Nada foi alterado.`);
  }
  const existente = await prisma.socialConta.findUnique({ where: { rede_externoId: { rede: d.rede, externoId: d.externoId } }, select: { loja: true } });
  if (existente && existente.loja !== d.loja && !marca) {
    throw new Error(`Esta conta já está ligada à ${nomeLoja(existente.loja)}. Para conectar a ${nomeLoja(d.loja)}, entre com outra conta. Nada foi alterado.`);
  }
  // Sem upsert: o create falha se outro callback criou a conta no meio (rede+externoId é único) e o update só vale se a
  // loja não mudou desde a conferência — dois pedidos ao mesmo tempo não trocam a loja escondido.
  const chave = { rede_externoId: { rede: d.rede, externoId: d.externoId } };
  if (!existente) return prisma.socialConta.create({ data: { rede: d.rede, externoId: d.externoId, ...dados } });
  const r = await prisma.socialConta.updateMany({ where: { rede: d.rede, externoId: d.externoId, loja: existente.loja }, data: dados });
  if (r.count === 0) throw new Error("A conta mudou enquanto conectava. Comece de novo.");
  return prisma.socialConta.findUniqueOrThrow({ where: chave });
}
