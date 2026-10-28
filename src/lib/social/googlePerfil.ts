import "server-only";

/**
 * Perfil de pesquisa do Google (Google for Creators) da BFF. O Google não tem API para ele: a página pública
 * profile.google.com/@usuario traz o nome, os seguidores de cada rede (nos rótulos de acessibilidade) e os posts
 * recentes, e é lida aqui na hora. Se o Google mudar a página, a leitura volta vazia e o painel avisa.
 */
export const USUARIO_GOOGLE_BFF = "bfffitness_atacado";
const URL_PERFIL = `https://profile.google.com/@${USUARIO_GOOGLE_BFF}`;
const REDES_ESPERADAS = ["Instagram", "Facebook", "TikTok", "YouTube"] as const;

export type PerfilGoogle = {
  url: string;
  nome: string | null;
  totalSeguidores: string | null;
  redes: { rede: string; conta: string; seguidores: string }[];
  postsRecentes: number;
  temSite: boolean;
  avisos: string[];
  lidoEm: string;
};

const limpar = (s: string) =>
  s
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/[‎‏]/g, "")
    .trim();

export async function lerPerfilGoogle(): Promise<PerfilGoogle> {
  const res = await fetch(URL_PERFIL, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", "Accept-Language": "pt-BR,pt;q=0.9" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`O Google respondeu ${res.status} ao abrir o perfil.`);
  const html = await res.text();

  const titulo = html.match(/<title>([^<]*)<\/title>/)?.[1];
  const nome = titulo ? limpar(titulo.split("|")[0]) || null : null;
  const totalSeguidores = html.match(/seguidores:\s*([\d.,]+\s*(?:mil|mi)?)/i)?.[1]?.trim() ?? null;
  const redes: PerfilGoogle["redes"] = [];
  for (const m of html.matchAll(/aria-label="\s*(Instagram|Facebook|TikTok|YouTube|X)\s+(.+?)\s+([\d.,]+(?:\s*mil|\s*mi)?)\s+seguidores"/g)) {
    if (!redes.some((r) => r.rede === m[1])) redes.push({ rede: m[1], conta: limpar(m[2]), seguidores: m[3].trim() });
  }
  // Posts de cada rede que o perfil mostra (Instagram, Facebook com Reels, TikTok e YouTube com Shorts).
  const postsRecentes = new Set(
    html.match(/(?:instagram\.com\/(?:p|reel)\/|facebook\.com\/(?:reel\/|[^"'\s]+\/(?:posts|videos)\/)|tiktok\.com\/@[^"'\s]+\/video\/|youtube\.com\/(?:shorts\/|watch\?v=)|youtu\.be\/)[A-Za-z0-9_-]+/g) ?? [],
  ).size;
  const temSite = html.includes("bfffitnessatacado.com.br");

  const avisos: string[] = [];
  if (!redes.length) avisos.push("Não consegui ler as redes do perfil (o Google pode ter mudado a página). Confira abrindo o link.");
  if (nome && !/bff/i.test(nome)) avisos.push(`O nome do perfil aparece como “${nome}”, sem “BFF”. Quem busca a marca procura por BFF: troque o nome para “BFF Fitness Atacado”.`);
  for (const r of REDES_ESPERADAS) if (redes.length && !redes.some((x) => x.rede === r)) avisos.push(`${r} não está ligado ao perfil. Conecte em profile.google.com para somar os seguidores e os vídeos.`);
  if (!temSite) avisos.push("O site da BFF não aparece no perfil.");

  return { url: URL_PERFIL, nome, totalSeguidores, redes, postsRecentes, temSite, avisos, lidoEm: new Date().toISOString() };
}
