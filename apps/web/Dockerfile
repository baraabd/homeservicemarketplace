FROM node:24.21.0-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
COPY . .
RUN node scripts/runtime/toolchain.cjs && pnpm install --frozen-lockfile
ARG SOURCE_SHA=unknown
ARG VITE_API_URL
ARG VITE_PROVIDER_ONBOARDING_V2=false
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_PROVIDER_ONBOARDING_V2=${VITE_PROVIDER_ONBOARDING_V2}
RUN node apps/web/scripts/check-image-build.mjs
RUN pnpm --filter @homeservicemarketplace/web build
# Public build identity only, generated alongside this exact static bundle.
RUN SOURCE_SHA=${SOURCE_SHA} node -e "require('node:fs').writeFileSync('apps/web/dist/build-info.json', JSON.stringify({sourceSha:process.env.SOURCE_SHA,apiUrl:process.env.VITE_API_URL,onboardingV2:process.env.VITE_PROVIDER_ONBOARDING_V2 === 'true'}))"

FROM nginx:alpine
ARG SOURCE_SHA=unknown
ARG VITE_API_URL
LABEL org.opencontainers.image.revision=${SOURCE_SHA} \
      io.hsm.web.api-url=${VITE_API_URL}
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/nginx.conf
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
