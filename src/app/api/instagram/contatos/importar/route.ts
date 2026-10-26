import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { etiquetar } from "@/lib/igTags";
import { gravarCampos, lerCsv, normalizarValor, type ValorCampo } from "@/lib/igContatos";

export const maxDuration = 60;
const LIMITE_LINHAS = 5000;

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");

const COL_USUARIO = ["@", "username", "usuario", "user", "instagram", "perfil", "arroba"];
const COL_TAGS = ["etiquetas", "etiqueta", "tags", "tag"];
const COL_REMOVER = ["remover etiquetas", "remover etiqueta", "remover tags", "remover tag"];
// Colunas que a exportação gera mas que a importação nunca grava (vêm do Instagram ou do robô).
const COL_SO_LEITURA = ["nome", "conta", "seguidores", "origem", "status", "primeiro contato", "ultima mensagem em", "ultima mensagem"];

/**
 * Importa um CSV para ATUALIZAR contatos que já existem, casando pelo @ do Instagram.
 * Nunca cria contato novo: a Meta só cria a conversa quando a pessoa escreve para a loja.
 * Corpo JSON: { csv: string, accountId?: string, simular?: boolean } — ou multipart com "arquivo", "accountId", "simular".
 * Colunas: "@" (obrigatória), "Etiquetas" (adiciona; separadas por vírgula ou |), "Remover etiquetas",
 * e uma coluna por campo personalizado com o mesmo nome do campo. Célula vazia não apaga nada.
 */
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;

  let csv = "";
  let accountId: string | undefined;
  let simular = false;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const f = await req.formData();
    const arq = f.get("arquivo") ?? f.get("file");
    csv = arq && typeof arq !== "string" ? await arq.text() : typeof arq === "string" ? arq : "";
    accountId = (f.get("accountId") as string | null) || undefined;
    simular = f.get("simular") === "1" || f.get("simular") === "true";
  } else {
    const b = (await req.json().catch(() => ({}))) as { csv?: unknown; accountId?: unknown; simular?: unknown };
    csv = typeof b.csv === "string" ? b.csv : "";
    accountId = typeof b.accountId === "string" && b.accountId ? b.accountId : undefined;
    simular = b.simular === true;
  }
  if (!csv.trim()) return NextResponse.json({ error: "Arquivo vazio" }, { status: 400 });

  // Tira o ' que a exportação põe na frente de células que começariam com = + - @ (proteção contra fórmula).
  const linhas = lerCsv(csv).map((l) => l.map((c) => (/^'[=+\-@\t\r]/.test(c) ? c.slice(1) : c)));
  if (linhas.length < 2) return NextResponse.json({ error: "O arquivo precisa de um cabeçalho e pelo menos uma linha" }, { status: 400 });
  if (linhas.length - 1 > LIMITE_LINHAS) return NextResponse.json({ error: `No máximo ${LIMITE_LINHAS} linhas por arquivo` }, { status: 400 });

  const cab = linhas[0].map(norm);
  const iUser = cab.findIndex((c) => COL_USUARIO.includes(c));
  if (iUser < 0) return NextResponse.json({ error: 'Falta a coluna "@" (o usuário do Instagram) no cabeçalho' }, { status: 400 });
  const iTags = cab.findIndex((c) => COL_TAGS.includes(c));
  const iRem = cab.findIndex((c) => COL_REMOVER.includes(c));

  const defs = await prisma.igCampo.findMany({ where: accountId ? { accountId } : {} });
  // coluna → nome do campo (o nome exato, comparado sem acento/maiúscula)
  const colunasCampo = new Map<number, string>();
  const ignoradas: string[] = [];
  cab.forEach((c, i) => {
    if (i === iUser || i === iTags || i === iRem || !c) return;
    const def = defs.find((d) => norm(d.nome) === c);
    if (def) colunasCampo.set(i, def.nome);
    else if (!COL_SO_LEITURA.includes(c)) ignoradas.push(linhas[0][i].trim());
  });
  const tipoDe = new Map(defs.map((d) => [`${d.accountId}|${d.nome}`, d.tipo]));

  const corpo = linhas.slice(1);
  const usuarios = [...new Set(corpo.map((l) => (l[iUser] ?? "").trim().replace(/^@/, "").toLowerCase()).filter(Boolean))];
  const contatos = usuarios.length
    ? await prisma.igConversation.findMany({
        where: { username: { in: usuarios }, ...(accountId ? { accountId } : {}) },
        select: { id: true, accountId: true, username: true },
      })
    : [];
  const porUsuario = new Map<string, { id: string; accountId: string }[]>();
  for (const c of contatos) {
    const k = (c.username ?? "").toLowerCase();
    porUsuario.set(k, [...(porUsuario.get(k) ?? []), c]);
  }

  const naoEncontrados: string[] = [];
  const errosValor: { linha: number; erro: string }[] = [];
  const atualizados = new Set<string>();
  let linhasCasadas = 0;
  let semUsuario = 0;

  for (let n = 0; n < corpo.length; n++) {
    const l = corpo[n];
    const numLinha = n + 2; // linha no arquivo (1 = cabeçalho)
    const u = (l[iUser] ?? "").trim().replace(/^@/, "").toLowerCase();
    if (!u) {
      semUsuario++;
      continue;
    }
    const alvos = porUsuario.get(u);
    if (!alvos?.length) {
      naoEncontrados.push(`@${u}`);
      continue;
    }
    linhasCasadas++;
    const separa = (s: string | undefined) =>
      (s ?? "")
        .split(/[,|]/)
        .map((t) => t.trim())
        .filter(Boolean);
    const add = iTags >= 0 ? separa(l[iTags]) : [];
    const rem = iRem >= 0 ? separa(l[iRem]) : [];

    for (const alvo of alvos) {
      const mudancas: Record<string, ValorCampo> = {};
      for (const [i, nome] of colunasCampo) {
        const bruto = (l[i] ?? "").trim();
        if (!bruto) continue; // vazio não apaga
        const tipo = tipoDe.get(`${alvo.accountId}|${nome}`);
        if (!tipo) continue; // o campo não existe na conta deste contato
        const r = normalizarValor(tipo, bruto);
        if (r.ok) mudancas[nome] = r.valor;
        else errosValor.push({ linha: numLinha, erro: `@${u} · ${nome}: ${r.erro}` });
      }
      if (!add.length && !rem.length && !Object.keys(mudancas).length) continue;
      if (!simular) {
        if (add.length || rem.length) await etiquetar(alvo.id, add, rem, { automacoes: false });
        if (Object.keys(mudancas).length) await gravarCampos(alvo.id, mudancas);
      }
      atualizados.add(alvo.id);
    }
  }

  return NextResponse.json({
    ok: true,
    simulado: simular,
    linhas: corpo.length,
    linhasCasadas,
    contatosAtualizados: atualizados.size,
    semUsuario,
    totalNaoEncontrados: naoEncontrados.length,
    naoEncontrados: [...new Set(naoEncontrados)].slice(0, 50),
    errosValor: errosValor.slice(0, 50),
    totalErrosValor: errosValor.length,
    colunasCampo: [...colunasCampo.values()],
    colunaEtiquetas: iTags >= 0,
    colunasIgnoradas: ignoradas,
  });
}
