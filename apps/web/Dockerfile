FROM node:24.21.0-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
COPY . .
RUN node scripts/runtime/toolchain.cjs && pnpm install --frozen-lockfile
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm --filter @homeservicemarketplace/web build

FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
