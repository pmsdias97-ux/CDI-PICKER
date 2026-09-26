/** @type {import('next').NextConfig} */

// Cabeçalhos de segurança (defesa em profundidade). Os 4 primeiros são seguros e
// sempre ativos. A CSP é mais delicada (a app usa estilos inline + scripts inline
// do Next), por isso fica num CSP moderado e SÓ em produção — em dev o Next precisa
// de eval/websockets para o HMR, que uma CSP estrita bloquearia.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

if (process.env.NODE_ENV === "production") {
  securityHeaders.push({
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  });
}

const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // URLs limpos (sem #): estes caminhos servem a SPA (app/page.js) e o cliente lê o pathname.
  // /api, /_next e ficheiros estáticos não são afetados.
  async rewrites() {
    return [
      { source: "/ranking", destination: "/" },
      { source: "/ath", destination: "/" },
      { source: "/criar", destination: "/" },
      { source: "/confirmar", destination: "/" },
      { source: "/admin", destination: "/" },
      { source: "/minhas", destination: "/" },
      { source: "/p/:slug", destination: "/" },
      { source: "/duel/:slugs", destination: "/" },
    ];
  },
};

export default nextConfig;
