# syntax=docker/dockerfile:1.7
# 사내 서버 이전용 이미지 (FND-07, PRD-00 7장 이식성) — Next.js standalone 빌드.
# Node 버전은 .nvmrc와 같아야 한다 (ENV-04 — scripts/check-pins.mjs가 대조).
ARG NODE_VERSION=24.7.0

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN corepack prepare --activate && pnpm install --frozen-lockfile
RUN pnpm --filter @ltr/web build

FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
# 컨테이너 포트는 PORT 환경변수로 정한다 (기본 3000 — 개발 서버 3001 고정과 무관)
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
