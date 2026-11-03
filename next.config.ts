import { ORBITA_CSP } from "./src/lib/orbita-hosting";
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

/**
 * Cabeçalhos de segurança aplicados a todas as respostas.
 *
 * O painel lida com dado pessoal de cliente (nome, e-mail, CPF vindos da Tray),
 * então vale fechar o básico: impedir que o site seja embutido em iframe de
 * terceiros (clickjacking), não vazar a URL para sites externos pelo Referer,
 * e não deixar o navegador adivinhar tipo de conteúdo.
 */
const securityHeaders = [
  // Bloqueia o site dentro de iframe de outro domínio (clickjacking)
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Navegador respeita o Content-Type declarado em vez de adivinhar
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Ao sair do site, não envia o caminho da página (que pode conter IDs)
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Só HTTPS por 2 anos, inclusive subdomínios
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Recursos do navegador que o app não usa — microfone fica liberado por
  // causa do ditado por voz.
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

// Nenhuma página deste painel deve ficar em cache no navegador — é tudo
// dado real (financeiro, cliente, pendência) por trás de login, nunca
// conteúdo estático que valha guardar. Sem isso, o navegador (sobretudo no
// celular) pode mostrar uma versão antiga da tela mesmo depois de um deploy
// novo — foi exatamente isso que aconteceu com a seção do Bling em Finanças.
const semCache = { key: "Cache-Control", value: "no-store, max-age=0" };

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/growth/orbita/[...path]": ["./integrations/orbita/assets/**/*"],
  },
  async headers() {
    return [
      // /avaliacoes/... é o sistema de avaliações (repassado pelo proxy): o cache é o que ele mandar, porque o
      // widget e as estrelas das lojas precisam do cache da CDN (sem ele, cada visita na loja vira acesso ao servidor).
      { source: "/((?!avaliacoes(?:/|$)).*)", headers: [...securityHeaders, semCache] },
      { source: "/avaliacoes/:path*", headers: securityHeaders },
      // O painel Telegram é incorporado somente pelo próprio app. Esta regra
      // também precisa existir na configuração da CDN, além da Route Handler.
      { source: "/api/growth/orbita/painel", headers: [
        {key:"X-Frame-Options",value:"SAMEORIGIN"},
        {key:"Content-Security-Policy",value:ORBITA_CSP},
      ] },
      { source: "/api/telegram/painel", headers: [
        {key:"X-Frame-Options",value:"SAMEORIGIN"},
        {key:"Content-Security-Policy",value:"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"},
      ] },
    ];
  },
};

export default withWorkflow(nextConfig);
