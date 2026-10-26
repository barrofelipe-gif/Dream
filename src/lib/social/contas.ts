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
  return prisma.socialConta.upsert({
    where: { rede_externoId: { rede: d.rede, externoId: d.externoId } },
    create: { rede: d.rede, externoId: d.externoId, ...dados },
    update: dados,
  });
}
