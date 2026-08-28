import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { VoiceDraft } from "@/lib/types";

const client = new Anthropic(); // lê ANTHROPIC_API_KEY do ambiente

export const VoiceDraftSchema = z.object({
  title: z.string().describe("Título curto e direto da pendência, no imperativo (ex: 'Responder fornecedor sobre pagamento')"),
  category: z
    .enum(["processos", "bff", "emails", "viagens"])
    .describe("Categoria mais provável a partir do que foi falado"),
  bffSub: z
    .enum(["financeiro", "fornecedor", "produto", "outro"])
    .nullable()
    .describe("Só preencher se category for 'bff'; senão null"),
  detail: z
    .string()
    .nullable()
    .describe("Detalhes adicionais mencionados que não cabem no título, sem repetir o título; null se não houver nada além do título"),
  company: z.string().nullable().describe("Nome de empresa/fornecedor/cliente mencionado, se houver"),
  processNumber: z.string().nullable().describe("Número de processo mencionado, se houver"),
  due: z
    .string()
    .nullable()
    .describe("Data no formato YYYY-MM-DD se um prazo foi mencionado (resolva datas relativas como 'sexta-feira' ou 'amanhã' usando a data de hoje informada); null se nenhum prazo foi mencionado"),
  priority: z.enum(["alta", "media", "baixa"]).describe("Alta se soar urgente/crítico, baixa se soar tranquilo, média por padrão"),
});

/**
 * Transforma o texto ditado (transcrito pelo navegador) numa pendência
 * estruturada — corrige erros óbvios de transcrição e distribui o que foi
 * falado nos campos certos (categoria, prazo, prioridade etc.).
 */
export async function parseVoiceDraft(transcript: string): Promise<VoiceDraft> {
  const today = new Date().toISOString().slice(0, 10);

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 2000,
    system:
      "Você organiza pendências de trabalho ditadas por voz em português do Brasil. " +
      "O texto vem de reconhecimento de voz do navegador e pode ter erros de transcrição " +
      "(palavras trocadas, sem pontuação) — corrija o que for razoavelmente óbvio. " +
      `A data de hoje é ${today}.`,
    messages: [{ role: "user", content: transcript }],
    output_config: { format: zodOutputFormat(VoiceDraftSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Não consegui organizar esse áudio em uma pendência.");
  }
  return response.parsed_output;
}
