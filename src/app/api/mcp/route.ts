import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { MCP_TOOLS, runMcpTool } from "@/lib/mcpTools";

/**
 * Servidor MCP (Model Context Protocol) remoto — Streamable HTTP.
 *
 * Conecta assistentes externos (Claude no celular/desktop, ChatGPT) aos dados
 * da BFF. Somente leitura: nenhuma ferramenta cria, altera ou apaga nada.
 *
 * SEGURANÇA
 * - O token vai no cabeçalho `Authorization: Bearer <token>`, nunca na URL.
 *   URL entra em log de servidor, histórico de navegador e cabeçalho Referer;
 *   cabeçalho de requisição, não.
 * - Comparação do token em tempo constante, pra não vazar o valor por medida
 *   de tempo de resposta.
 * - Limite de requisições por minuto, pra ninguém baixar a base inteira.
 * - Toda chamada fica registrada em McpAccessLog (sem o token e sem o conteúdo
 *   devolvido), pra dar rastro de auditoria.
 *
 * IMPORTANTE: o 401 aqui NÃO leva o cabeçalho `WWW-Authenticate: Bearer`.
 * Esse cabeçalho é o sinal padrão (RFC 6750 / spec de auth do MCP) de "este
 * servidor exige OAuth" — e clientes como o conector da Claude.ai o detectam
 * automaticamente e passam a exigir um fluxo de login, mesmo com a
 * autenticação configurada como "Nenhum" no cliente. Como aqui a auth é só
 * uma chave fixa por cabeçalho (não OAuth), emitir esse cabeçalho quebra a
 * conexão do conector com um 401 mal interpretado como "quer login".
 *
 * Para revogar o acesso: troque a variável de ambiente MCP_TOKEN e reimplante.
 */

const LIMITE_POR_MINUTO = 60;

function autorizado(req: NextRequest): boolean {
  const esperado = process.env.MCP_TOKEN;
  if (!esperado) return false;

  const header = req.headers.get("authorization") ?? "";
  const recebido = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : header.trim();
  if (!recebido) return false;

  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false; // timingSafeEqual exige tamanhos iguais
  return timingSafeEqual(a, b);
}

function origem(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}

/** Registra a chamada. Nunca derruba a requisição se o log falhar. */
async function registrar(tool: string, ok: boolean, blocked: boolean, ip: string | null) {
  try {
    await prisma.mcpAccessLog.create({ data: { tool, ok, blocked, ip } });
  } catch {
    // auditoria é best-effort — um erro aqui não pode quebrar a consulta
  }
}

async function excedeuLimite(): Promise<boolean> {
  try {
    const umMinutoAtras = new Date(Date.now() - 60_000);
    const chamadas = await prisma.mcpAccessLog.count({
      where: { createdAt: { gte: umMinutoAtras }, blocked: false },
    });
    return chamadas >= LIMITE_POR_MINUTO;
  } catch {
    return false; // banco fora do ar não deve bloquear uso legítimo
  }
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const PROTOCOL_VERSION = "2024-11-05";

function resultado(id: string | number | null | undefined, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function erro(id: string | number | null | undefined, code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

export async function POST(req: NextRequest) {
  const ip = origem(req);

  if (!autorizado(req)) {
    await registrar("nao_autorizado", false, false, ip);
    // Sem WWW-Authenticate: ver nota de segurança no topo do arquivo.
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: JsonRpcRequest;
  try {
    body = await req.json();
  } catch {
    return erro(null, -32700, "JSON inválido");
  }

  const { method, id } = body;

  switch (method) {
    case "initialize":
      return resultado(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "bff-painel", version: "2.0.0" },
      });

    // Notificações não esperam resposta com resultado
    case "notifications/initialized":
    case "notifications/cancelled":
      return new NextResponse(null, { status: 202 });

    case "ping":
      return resultado(id, {});

    case "tools/list":
      return resultado(id, { tools: MCP_TOOLS });

    case "tools/call": {
      const nome = String(body.params?.name ?? "");
      const args = (body.params?.arguments ?? {}) as Record<string, unknown>;

      if (await excedeuLimite()) {
        await registrar(nome, false, true, ip);
        return resultado(id, {
          content: [
            {
              type: "text",
              text: `Limite de ${LIMITE_POR_MINUTO} consultas por minuto atingido. Espere um pouco e tente de novo.`,
            },
          ],
          isError: true,
        });
      }

      try {
        const texto = await runMcpTool(nome, args);
        await registrar(nome, true, false, ip);
        return resultado(id, { content: [{ type: "text", text: texto }] });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao executar a ferramenta";
        await registrar(nome, false, false, ip);
        // Erro da ferramenta volta como resultado com isError, não como erro de
        // protocolo — assim o assistente consegue explicar o problema ao usuário.
        return resultado(id, {
          content: [{ type: "text", text: `Erro: ${message}` }],
          isError: true,
        });
      }
    }

    // Métodos opcionais do protocolo: respondemos vazio em vez de erro pra não
    // quebrar clientes que os consultam ao conectar.
    case "resources/list":
      return resultado(id, { resources: [] });
    case "prompts/list":
      return resultado(id, { prompts: [] });

    default:
      return erro(id, -32601, `Método não suportado: ${method}`);
  }
}

// Alguns clientes abrem um GET (SSE) antes do POST; respondemos que não há
// canal de eventos, o que faz o cliente cair no modo POST simples.
export async function GET(req: NextRequest) {
  if (!autorizado(req)) {
    // Sem WWW-Authenticate: ver nota de segurança no topo do arquivo.
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
