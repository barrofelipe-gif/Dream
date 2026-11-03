export const ORBITA_VERSION = "0.15.0";
export const ORBITA_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' https://cdninstagram.com https://*.cdninstagram.com https://fbcdn.net https://*.fbcdn.net; font-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
export const ORBITA_ASSETS: Record<
  string,
  { file: string; type: string; download?: string }
> = {
  "orbita.svg": { file: "orbita.svg", type: "image/svg+xml" },
  "hosted.js": { file: "hosted.js", type: "text/javascript; charset=utf-8" },
  "hosted.css": { file: "hosted.css", type: "text/css; charset=utf-8" },
  "setup.css": { file: "setup.css", type: "text/css; charset=utf-8" },
  "orbita-0.15.0.zip": {
    file: "orbita-0.15.0.zip",
    type: "application/zip",
    download: "orbita-0.15.0.zip",
  },
};
export function orbitaPanel(userScope: string): string {
  if (!/^[a-f0-9]{32}$/.test(userScope)) throw new Error("Invalid user scope");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="orbita-user" content="${userScope}"><title>Órbita · Crescimento do Instagram</title><link rel="stylesheet" href="/api/growth/orbita/hosted.css"><link rel="stylesheet" href="/api/growth/orbita/setup.css"></head><body>
  <div id="connection-mode" class="hosted-mode" role="status">Órbita ${ORBITA_VERSION} · Growth do app BFF</div>
  <section id="setup" class="hosted-setup" aria-labelledby="setup-title">
    <span class="hosted-eyebrow">CRESCIMENTO COM DIREÇÃO</span><h1 id="setup-title">Seu próximo passo começa aqui.</h1>
    <p>Dashboard, engajamento, Stories, horários, origens e planos de melhoria. Escolha como quer testar a Órbita neste navegador.</p>
    <div class="hosted-options"><article><h2>Conectar a extensão</h2><p>Use as contas, os públicos e a fila salvos na extensão deste Chrome ou Edge. A sessão do Instagram é conferida antes da execução. Conectar aqui não inicia nenhuma ação.</p><button id="connect-extension">Conectar extensão neste navegador</button><p id="connection-status" role="status"></p></article>
    <article><h2>Analisar sem extensão</h2><p>Registre ou importe métricas, explore o radar e acompanhe os planos de melhoria. Os dados ficam neste navegador, separados por usuário do app. Este modo não coleta nem segue perfis.</p><button id="manual-mode" class="secondary">Abrir no modo manual</button></article></div>
    <details><summary>Instalar ou atualizar a extensão · versão ${ORBITA_VERSION}</summary><ol><li><a href="/api/growth/orbita/orbita-0.15.0.zip">Baixe a extensão Órbita</a> e descompacte em uma pasta permanente.</li><li>No Chrome, abra <code>chrome://extensions</code>; no Edge, <code>edge://extensions</code>. Ative o modo do desenvolvedor.</li><li>Use “Carregar sem compactação” e selecione a pasta <code>dist</code>. Se já usa a Órbita, exporte seus backups e substitua os arquivos na mesma pasta; depois use “Recarregar”.</li><li>Atualize esta página e clique em “Conectar extensão neste navegador”. Cadastre o @ que você gerencia e confira o login no próprio Instagram em “Conectar sessão”.</li></ol><p>A permissão do app permite a conexão entre este painel e a extensão. A execução continua local e depende deste computador e da sessão correta do Instagram. Não há sincronização automática de Insights da Meta nem garantia de evitar bloqueios. Exporte backups antes de trocar de navegador.</p></details>
  </section><div id="root"></div><script type="module" src="/api/growth/orbita/hosted.js"></script></body></html>`;
}
