import { NextResponse } from "next/server";

/**
 * The public Seat Allocation API, passed on to the backend by this server
 * rather than by the plain /api rewrite — so it can say who is really asking.
 *
 * The backend sees this server's address, not the visitor's. Here, the
 * visitor's address and rough location (which Vercel adds to every request)
 * are passed on in headers of our own, with a secret the backend shares
 * (PUBLIC_EDGE_SECRET). Anything a browser sends in those headers itself is
 * thrown away first, so they cannot be faked from outside.
 */
const backend = process.env.BACKEND_ORIGIN || "http://localhost:4000";

export function middleware(request) {
  const headers = new Headers(request.headers);
  for (const h of ["x-sp-edge", "x-sp-client-ip", "x-sp-country", "x-sp-city"]) headers.delete(h);

  const ip =
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "";
  if (ip) headers.set("x-sp-client-ip", ip);
  const country = request.headers.get("x-vercel-ip-country");
  if (country) headers.set("x-sp-country", country);
  const city = request.headers.get("x-vercel-ip-city");
  if (city) headers.set("x-sp-city", city);
  if (process.env.PUBLIC_EDGE_SECRET) headers.set("x-sp-edge", process.env.PUBLIC_EDGE_SECRET);

  const target = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, backend);
  return NextResponse.rewrite(target, { request: { headers } });
}

export const config = {
  matcher: ["/api/v1/public/:path*", "/api/public/:path*"],
};
