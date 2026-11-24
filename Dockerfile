# syntax=docker/dockerfile:1
# Gier: one container serves the API, the scheduler and the PWA.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile
COPY . .
ARG GIT_SHA=
RUN GIT_SHA=$GIT_SHA pnpm --filter @gier/web build \
 && pnpm --filter @gier/server --prod deploy --legacy /out \
 && cp -r apps/web/dist /out/web

FROM node:22-bookworm-slim
WORKDIR /app
ARG GIT_SHA=
ENV GIER_COMMIT=$GIT_SHA
ENV NODE_ENV=production \
    PORT=8787 \
    DATABASE_FILE=/data/gier.db \
    WEB_DIST=/app/web
COPY --from=build /out /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+(process.env.GIER_BASE_PATH||'')+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/main.ts"]
