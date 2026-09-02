import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { MCP_TOOLS, runMcpTool } from "@/lib/mcpTools";

/**
 * Servidor MCP (Model Context Protocol) remoto — Streamable HTTP.
 *
 * Permite conectar assistentes externos (Claude no celular/desktop, ChatGPT)
 * aos dados da BFF: vendas, clientes e pendências. Só leitura.
 *
 * A autenticação é um token secreto no caminho da URL (MCP_TOKEN), porque os
 * clientes de MCP aceitam apenas uma URL na configuração do conector. Quem tem
 * a URL tem acesso de leitura — tratar como senha. Para revogar, basta trocar
 * a variável MCP_TOKEN e reconectar.
 */

function tokenConfere(recebido: string): boolean {
  const esperado = process.env.MCP_TOKEN;
  if (!esperado) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  // comprimentos diferentes já reprovam; timingSafeEqual exige tamanhos iguais
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!tokenConfere(token)) {
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
        serverInfo: { name: "bff-painel", version: "1.0.0" },
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
      try {
        const texto = await runMcpTool(nome, args);
        return resultado(id, { content: [{ type: "text", text: texto }] });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao executar a ferramenta";
        // Erro da ferramenta volta como resultado com isError, não como erro de
        // protocolo — assim o assistente consegue explicar o problema ao usuário.
        return resultado(id, {
          content: [{ type: "text", text: `Erro: ${message}` }],
          isError: true,
        });
      }
    }

    // Métodos opcionais do protocolo: respondemos vazio em vez de erro pra não
    // quebrar clientes que os consultam na conexão.
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
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!tokenConfere(token)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
