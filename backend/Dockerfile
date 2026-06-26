# syntax=docker/dockerfile:1

# 1. Base image: a minimal Linux with Node.js 20 preinstalled.
#    "alpine" is a tiny Linux distro, so the final image stays small.
FROM node:20-alpine

# 2. Default to production behaviour for Node and npm.
ENV NODE_ENV=production

# 3. The working directory INSIDE the container. All following commands
#    run here, and it's created if it doesn't exist.
WORKDIR /app

# 4. Copy ONLY the dependency manifests first. This is a caching trick:
#    if these files don't change, Docker reuses the cached "npm ci" layer
#    on the next build instead of reinstalling everything.
COPY package*.json ./

# 5. Install exactly the locked dependencies, skipping devDependencies
#    (we don't need nodemon in production). Runs at BUILD time.
RUN npm ci --omit=dev

# 6. Now copy the rest of the source code. Changes here don't bust the
#    dependency layer above, so rebuilds stay fast.
COPY . .

# 7. Documentation only: tells readers the app listens on 4000. It does
#    NOT actually publish the port (we do that when we 'docker run').
EXPOSE 4000

# 8. Drop root privileges. The official node image ships a non-root
#    "node" user; running as it limits damage if the app is compromised.
USER node

# 9. The default command run when a CONTAINER starts from this image.
#    (RUN = build time; CMD = run time.) This calls "npm start" ->
#    "node src/server.js".
CMD ["npm", "start"]
