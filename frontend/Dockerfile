# syntax=docker/dockerfile:1

# ============ Stage 1: builder ============
# Has all dependencies + the Next.js compiler. Produces the build output,
# then is discarded — none of this ends up in the final image.
FROM node:20-alpine AS builder
WORKDIR /app

# Install ALL deps (including dev) — needed to compile.
COPY package*.json ./
RUN npm ci

# Copy source and build.
COPY . .
# NEXT_PUBLIC_* vars are inlined at build time. "/api" is relative, so the
# reverse proxy decides where the backend actually is — keeps the image
# portable across domains.
ENV NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ============ Stage 2: runner ============
# A clean, tiny image that contains ONLY the compiled standalone server.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy just the build artifacts from the builder stage:
#   - public/        static assets you ship
#   - .next/standalone  the minimal node server + only-needed node_modules
#   - .next/static   compiled JS/CSS chunks
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
USER node

# The standalone build emits its own server.js entrypoint.
CMD ["node", "server.js"]
