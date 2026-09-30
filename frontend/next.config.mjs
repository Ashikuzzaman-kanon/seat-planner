/** @type {import('next').NextConfig} */
const backendOrigin = process.env.BACKEND_ORIGIN || "http://localhost:4000";

const nextConfig = {
  // The API's own health URL, built into the page so the browser can wake a
  // sleeping API directly — see "Waking a sleeping server" in src/lib/api.js.
  env: {
    NEXT_PUBLIC_WAKE_URL: process.env.NEXT_PUBLIC_WAKE_URL || `${backendOrigin}/api/v1/health`,
  },
  reactStrictMode: true,
  // Standalone output is only for our self-hosted Docker image. Vercel builds
  // and serves Next.js its own way, so disable it there (it sets VERCEL=1).
  output: process.env.VERCEL ? undefined : "standalone",
  // Proxy API calls to the backend so the browser only ever talks to one
  // origin (this frontend). Lets you share a single public URL (just port
  // 3000) without CORS or a second tunnel. Override the target with
  // BACKEND_ORIGIN if the backend runs elsewhere.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendOrigin}/api/:path*` }];
  },
};

export default nextConfig;
