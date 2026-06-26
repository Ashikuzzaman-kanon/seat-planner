/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a minimal self-contained server (.next/standalone) for small,
  // production-ready Docker images.
  output: "standalone",
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
