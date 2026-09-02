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

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Respostas de API nunca devem ser guardadas em cache de navegador ou CDN:
      // carregam dado de cliente e faturamento.
      {
        source: "/api/:path*",
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
};

export default nextConfig;
