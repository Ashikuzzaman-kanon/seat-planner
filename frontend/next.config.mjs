/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output is only for our self-hosted Docker image. Vercel builds
  // and serves Next.js its own way, so disable it there (it sets VERCEL=1).
  output: process.env.VERCEL ? undefined : "standalone",
  // Proxy API calls to the backend so the browser only ever talks to one
  // origin (this frontend). Lets you share a single public URL (just port
  // 3000) without CORS or a second tunnel. Override the target with
  // BACKEND_ORIGIN if the backend runs elsewhere.
  async rewrites() {
    const backend = process.env.BACKEND_ORIGIN || "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
