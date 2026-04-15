ARG NODE_VERSION=20-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

FROM node:${NODE_VERSION} AS builder
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /workspace/packages/database/node_modules ./packages/database/node_modules
COPY . .
RUN pnpm --filter @homeservicemarketplace/database build
RUN pnpm --filter @homeservicemarketplace/api build
RUN pnpm --filter @homeservicemarketplace/api deploy --prod /out

FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NODE_OPTIONS="--enable-source-maps"
WORKDIR /app
RUN apk add --no-cache tini \
  && addgroup -S app \
  && adduser -S -G app app
COPY --from=builder --chown=app:app /out ./
COPY --from=builder --chown=app:app /workspace/apps/api/dist ./dist
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
