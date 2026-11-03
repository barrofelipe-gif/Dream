export const ORBITA_VERSION = "0.16.2";
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
  "orbita-0.15.0.zip": {file:"orbita-0.15.0.zip",type:"application/zip",download:"orbita-0.15.0.zip"},
  "orbita-0.16.2.zip": {file:"orbita-0.16.2.zip",type:"application/zip",download:"orbita-0.16.2.zip"},
  "orbita-0.16.1.zip": {file:"orbita-0.16.1.zip",type:"application/zip",download:"orbita-0.16.1.zip"},
  "orbita-0.16.0.zip": {
    file: "orbita-0.16.0.zip",
    type: "application/zip",
    download: "orbita-0.16.0.zip",
  },
};
export function orbitaPanel(userScope: string): string {
  if (!/^[a-f0-9]{32}$/.test(userScope)) throw new Error("Invalid user scope");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="orbita-user" content="${userScope}"><title>Órbita · Crescimento do Instagram</title><link rel="stylesheet" href="/api/growth/orbita/hosted.css"><link rel="stylesheet" href="/api/growth/orbita/setup.css"></head><body>
  <div class="hosted-mode">
    <a class="hosted-back" href="/areas/growth/papeis/instagram#crescimento">← Voltar ao Growth</a>
    <span id="connection-mode" role="status">Órbita ${ORBITA_VERSION} · Growth do app BFF</span>
    <details class="hosted-install">
      <summary>Instalação e conexão</summary>
      <div id="orbita-installation" class="hosted-install-content">
        <h2>Instalar e conectar a extensão · ${ORBITA_VERSION}</h2>
        <ol>
          <li><a href="/api/growth/orbita/orbita-${ORBITA_VERSION}.zip">Baixar extensão Órbita ${ORBITA_VERSION}</a>. Descompacte o ZIP em uma pasta permanente.</li>
          <li>No Chrome, abra <code>chrome://extensions</code>; no Edge, <code>edge://extensions</code>. Ative o modo do desenvolvedor, escolha <strong>Carregar sem compactação</strong> e selecione a pasta <code>dist</code>.</li>
          <li>Se já usa a Órbita, exporte seus backups, substitua os arquivos na mesma pasta instalada e use <strong>Recarregar</strong> na extensão. Assim você mantém o armazenamento da instalação existente.</li>
          <li>Salve os formulários abertos e <a href="/api/growth/orbita/painel">volte à escolha de conexão</a>. Clique em <strong>Conectar extensão neste navegador</strong>.</li>
          <li>Selecione ou cadastre o @ na extensão. Entre na conta correspondente pelo próprio Instagram e use <strong>Conectar sessão</strong> no painel. Conectar a extensão não inicia a fila nem confirma por si só a sessão do Instagram.</li>
        </ol>
        <div class="hosted-install-note"><strong>Dois espaços de dados.</strong> O modo manual guarda dados por usuário do app neste navegador. A extensão tem seu próprio cadastro local. Escolher outro modo não copia os dados automaticamente. Para levar um cadastro, use <strong>Preferências → Exportar backup JSON</strong> em cada conta e restaure o backup na conta correspondente da extensão.</div>
        <p>Cadastrar um @ cria um espaço; não confirma o login nem libera ações no Instagram. Uma conta executa por vez. A coleta e a fila dependem deste computador e da sessão correta; nenhuma configuração garante ausência de bloqueios. As métricas disponíveis dependem da conta e das permissões da Meta.</p>
      </div>
    </details>
  </div>
  <section id="setup" class="hosted-setup" aria-labelledby="setup-title">
    <span class="hosted-eyebrow">CRESCIMENTO COM DIREÇÃO</span><h1 id="setup-title">Seu próximo passo começa aqui.</h1>
    <p>Dashboard, engajamento, Stories, horários, origens e planos de melhoria. Escolha como quer testar a Órbita neste navegador.</p>
    <div class="hosted-options"><article><h2>Conectar a extensão</h2><p>Use as contas, os públicos e a fila salvos na extensão deste Chrome ou Edge. A sessão do Instagram é conferida antes da execução. Conectar aqui não inicia nenhuma ação.</p><button id="connect-extension">Conectar extensão neste navegador</button><p id="connection-status" role="status"></p></article>
    <article><h2>Analisar sem extensão</h2><p>Registre ou importe métricas, explore o radar e acompanhe os planos de melhoria. Os dados ficam neste navegador, separados por usuário do app. Este modo não coleta nem segue perfis pelo navegador e não verifica a sessão do Instagram.</p><button id="manual-mode" class="secondary">Abrir no modo manual</button></article></div>
    <p class="hosted-setup-hint">Precisa instalar, atualizar ou mudar o modo de acesso? Abra <strong>Instalação e conexão</strong> na faixa superior. O guia continua acessível depois de abrir o dashboard.</p>
  </section><div id="root"></div><script type="module" src="/api/growth/orbita/hosted.js"></script></body></html>`;
}
