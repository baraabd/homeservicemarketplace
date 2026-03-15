FROM node:20-alpine AS base
WORKDIR /app

FROM base AS builder
COPY . .
RUN corepack enable && corepack prepare pnpm@10 --activate
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @homeservicemarketplace/api build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./package.json
EXPOSE 4000
CMD ["node", "dist/main"]