// Dev needs 'unsafe-eval' (webpack/react-refresh) and ws: (HMR socket); prod
// stays strict. Inline script/style are allowed because the app ships a small
// inline theme script and inline brand CSS — a nonce would be stronger but
// isn't worth the breakage risk here. This still blocks EXTERNAL scripts,
// framing (clickjacking), and mixed content.
const isDev = process.env.NODE_ENV !== "production";
const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";
const connectSrc = isDev ? "'self' ws:" : "'self'";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `script-src ${scriptSrc}`,
  `connect-src ${connectSrc}`,
].join("; ");

// Security headers applied to every response. HSTS is ignored by browsers over
// plain HTTP (dev), so it's safe to always send; it only takes effect on the
// HTTPS production site (Render).
const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Server Actions handle file uploads (estimate/schedule xlsx, photos, quotes).
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
