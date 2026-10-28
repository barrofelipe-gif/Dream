/**
 * Contrato COMUM de todas as redes do publicador. Cada rede tem um arquivo em
 * `src/lib/social/<rede>.ts` que exporta `adaptador` (RedeAdapter). Quem escreve uma rede
 * mexe SÓ no arquivo dela e nas rotas em `src/app/api/social/<rede>/`.
 */
export type Rede = "instagram" | "facebook" | "tiktok" | "youtube" | "pinterest";
export const REDES: Rede[] = ["instagram", "facebook", "tiktok", "youtube", "pinterest"];

export type Midia = {
  /** URL pública (https) do arquivo. */
  url: string;
  tipo: "imagem" | "video";
  nome?: string;
  /** Opcional: capa do vídeo. */
  capaUrl?: string;
};

/** Conta já com os tokens abertos (descriptografados). Só existe em memória, nunca vai ao navegador. */
export type ContaAberta = {
  id: string;
  rede: Rede;
  loja: string;
  externoId: string;
  nome: string | null;
  username: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiraEm: Date | null;
  extra: Record<string, unknown>;
};

export type EntradaPublicar = {
  conta: ContaAberta;
  /** Texto principal já ajustado para esta rede. */
  legenda: string;
  titulo?: string;
  tipo: "imagem" | "video" | "carrossel" | "texto";
  midias: Midia[];
  /** Ajustes específicos da rede (ex: privacidade do TikTok, categoria do YouTube, board do Pinterest). */
  opcoes: Record<string, unknown>;
};

export type SaidaPublicar = {
  /** Id da publicação criada na rede. */
  externoId: string;
  /** Link público da publicação, se a rede devolver. */
  url?: string;
};

export type Limites = {
  legendaMax: number;
  /** Tipos de postagem que a rede aceita. */
  tipos: ("imagem" | "video" | "carrossel" | "texto")[];
  videoMaxSegundos?: number;
  carrosselMax?: number;
  observacao?: string;
};

export interface RedeAdapter {
  rede: Rede;
  rotulo: string;
  limites: Limites;
  /** false enquanto a rede não estiver implementada ou aprovada: o painel mostra "em breve". */
  disponivel: boolean;
  /** O que falta para esta rede funcionar (aprovações, variáveis de ambiente...). Mostrado ao Felipe. */
  pendencias(): string[];
  /** URL que inicia a conexão da conta (OAuth) para a loja. Ex: /api/social/facebook/conectar?loja=bff */
  urlConectar(loja: string): string;
  /** Erros de validação ANTES de publicar (legenda grande, formato errado...). Vazio = ok. */
  validar(e: Omit<EntradaPublicar, "conta">): string[];
  /** Publica de verdade. Deve lançar Error com mensagem clara em português se falhar. */
  publicar(e: EntradaPublicar): Promise<SaidaPublicar>;
  /**
   * Termina uma publicação que ficou processando na rede (ver PublicacaoPendente). Devolve a publicação
   * pronta, ou null se a rede ainda está processando. Lança Error se a rede desistiu.
   */
  concluir?(conta: ContaAberta, referencia: string): Promise<SaidaPublicar | null>;
  /** Renova o token se estiver perto de vencer. Devolve os novos dados ou null se não precisa. */
  renovar?(conta: ContaAberta): Promise<{ accessToken: string; refreshToken?: string; expiraEm?: Date } | null>;
}

/**
 * A rede aceitou o envio mas ainda está processando (vídeo do Instagram pode levar mais que os 60 s da função).
 * `referencia` é o que o adaptador precisa para terminar depois em `concluir` (ex.: o id do contêiner).
 */
export class PublicacaoPendente extends Error {
  constructor(public referencia: string) {
    super("A rede ainda está processando o vídeo. A publicação termina sozinha em alguns minutos.");
  }
}

/** A rede desistiu de vez (vídeo com erro, contêiner vencido): não adianta tentar de novo em concluir. */
export class FalhaDefinitiva extends Error {}

/** Adaptador "ainda não implementado": o painel mostra a rede como em breve, com as pendências. */
export function adaptadorEmBreve(rede: Rede, rotulo: string, pendencias: string[]): RedeAdapter {
  return {
    rede,
    rotulo,
    disponivel: false,
    limites: { legendaMax: 2000, tipos: ["imagem", "video"] },
    pendencias: () => pendencias,
    urlConectar: (loja) => `/api/social/${rede}/conectar?loja=${loja}`,
    validar: () => [`${rotulo} ainda não está disponível.`],
    publicar: async () => {
      throw new Error(`${rotulo} ainda não está disponível.`);
    },
  };
}
