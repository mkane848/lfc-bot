FROM node:20-bookworm-slim AS build

# python3/make/g++ let better-sqlite3 compile from source when no prebuilt
# binary matches the target platform (amd64 or arm64).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so this layer is cached across source-only changes.
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript to dist/.
COPY . .
RUN npm run build

# Drop devDependencies so the runtime layer stays lean.
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    DATABASE_PATH=/app/data/lfcbot.db

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Drizzle migrations are not part of the tsc output; copy them explicitly.
COPY --from=build --chown=node:node /app/src/db/migrations ./src/db/migrations

# Create the SQLite data directory owned by the non-root user. The named
# volume in docker-compose.yml mounts over this path.
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

VOLUME ["/app/data"]

CMD ["node", "dist/index.js"]
