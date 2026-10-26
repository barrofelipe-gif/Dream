import type { Rede } from "@/lib/social/types";

export type TipoPost = "foto" | "reel" | "carrossel" | "story";
export const TIPOS_POST: TipoPost[] = ["foto", "reel", "carrossel", "story"];

/** Resultado de uma coleta de uma conta. Erros por item não derrubam o resto: vão em `avisos`. */
export type ResultadoColeta = {
  contaId: string;
  rede: Rede;
  dias: number;
  diasGravados: number;
  postsGravados: number;
  publicoGravado: boolean;
  avisos: string[];
  /** Erro fatal (ex: permissão faltando). Quando existe, nada foi coletado. */
  erro?: string;
  /** true quando o erro pede para reconectar a conta. */
  precisaReconectar?: boolean;
};

/** Contrato de cada rede para a coleta de métricas. Para plugar uma rede nova: crie `<rede>.ts` e registre em index.ts. */
export interface ColetorMetricas {
  rede: Rede;
  rotulo: string;
  /** false = "em breve": o painel mostra a rede mas não coleta. */
  disponivel: boolean;
  /** Coleta e grava (upsert) tudo da conta. */
  coletar(contaId: string, opcoes?: { dias?: number }): Promise<ResultadoColeta>;
}

export function coletorEmBreve(rede: Rede, rotulo: string): ColetorMetricas {
  return {
    rede,
    rotulo,
    disponivel: false,
    async coletar(contaId) {
      return { contaId, rede, dias: 0, diasGravados: 0, postsGravados: 0, publicoGravado: false, avisos: [], erro: `Métricas do ${rotulo} ainda não estão disponíveis (em breve).` };
    },
  };
}
