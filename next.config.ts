import type { NextConfig } from "next";

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
  async headers() {
    return [{ source: "/:path*", headers: [...securityHeaders, semCache] }];
  },
};

export default nextConfig;
