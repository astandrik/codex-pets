FROM node:22.22.3-bookworm-slim@sha256:16d364eebf6b62da439dc993d9b80940c78b0ca38438452f011ab9a25c752644 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:22.22.3-bookworm-slim@sha256:16d364eebf6b62da439dc993d9b80940c78b0ca38438452f011ab9a25c752644 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_BASE_PATH=
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH

RUN npm run build

FROM node:24.18.1-bookworm-slim@sha256:a09aabc645e86e81e23dab78e0c0f2eaa233cab4277c7188232181a1a8bd5d39 AS worker-node

FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS generation-worker
COPY --from=worker-node /usr/local/bin/node /usr/local/bin/node
ARG VCS_REF
LABEL org.opencontainers.image.source="https://github.com/astandrik/codex-pets" \
      org.opencontainers.image.revision="$VCS_REF"
WORKDIR /app
ENV NODE_ENV=production
COPY vendor/sprite-gen ./vendor/sprite-gen
COPY scripts/pet-spritegen/requirements.txt ./scripts/pet-spritegen/requirements.txt
RUN pip install --no-cache-dir --only-binary=:all: --require-hashes -r scripts/pet-spritegen/requirements.txt
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/ydb ./ydb
CMD ["node", "scripts/pet-generation-worker.mjs"]

FROM node:22.22.3-bookworm-slim@sha256:16d364eebf6b62da439dc993d9b80940c78b0ca38438452f011ab9a25c752644 AS runner
ARG VCS_REF
LABEL org.opencontainers.image.source="https://github.com/astandrik/codex-pets" \
      org.opencontainers.image.revision="$VCS_REF"
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update \
  -o Acquire::ForceIPv4=true \
  -o Acquire::Retries=3 \
  && apt-get install -y --no-install-recommends fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/ydb ./ydb
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/vitest.config.ts ./vitest.config.ts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next

EXPOSE 3000
CMD ["npm", "run", "start"]
