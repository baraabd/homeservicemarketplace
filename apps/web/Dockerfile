FROM node:24.21.0-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
COPY . .
RUN node scripts/runtime/toolchain.cjs && pnpm install --frozen-lockfile
ARG SOURCE_SHA
# K03: every public input that changes the bundle or its document CSP is an
# explicit build input. Declared-but-unpropagated flags previously compiled a
# different product (e.g. a Stripe sandbox release whose CSP blocked Stripe.js).
# The list is owned by scripts/production/security-app/web-build-identity.cjs.
ARG VITE_API_URL
ARG VITE_AUTH_COOKIE_PREFIX=hsm
ARG VITE_PROVIDER_ONBOARDING_V2
ARG VITE_STRIPE_SANDBOX_ENABLED
ARG VITE_DISPUTE_INTAKE_V1=false
ARG VITE_REALTIME_SOCKET_IO=false
ARG VITE_REALTIME_TRANSPORTS=websocket
ARG VITE_CSP_MEDIA_ORIGINS
ARG VITE_CSP_UPLOAD_ORIGINS
# Reviewed fingerprint of the declared public configuration; the build fails
# unless the configuration actually compiled here produces the same value.
ARG WEB_CONFIG_FINGERPRINT
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_AUTH_COOKIE_PREFIX=${VITE_AUTH_COOKIE_PREFIX} \
    VITE_PROVIDER_ONBOARDING_V2=${VITE_PROVIDER_ONBOARDING_V2} \
    VITE_STRIPE_SANDBOX_ENABLED=${VITE_STRIPE_SANDBOX_ENABLED} \
    VITE_DISPUTE_INTAKE_V1=${VITE_DISPUTE_INTAKE_V1} \
    VITE_REALTIME_SOCKET_IO=${VITE_REALTIME_SOCKET_IO} \
    VITE_REALTIME_TRANSPORTS=${VITE_REALTIME_TRANSPORTS} \
    VITE_CSP_MEDIA_ORIGINS=${VITE_CSP_MEDIA_ORIGINS} \
    VITE_CSP_UPLOAD_ORIGINS=${VITE_CSP_UPLOAD_ORIGINS}
RUN node apps/web/scripts/check-image-build.mjs
RUN pnpm --filter @homeservicemarketplace/web build
# Public build identity only, derived from this exact emitted document.
RUN SOURCE_SHA=${SOURCE_SHA} WEB_CONFIG_FINGERPRINT=${WEB_CONFIG_FINGERPRINT} \
    node scripts/production/security-app/web-build-identity.cjs --write-build-info \
      apps/web/dist/index.html apps/web/dist/build-info.json

FROM nginx:alpine
ARG SOURCE_SHA
ARG VITE_API_URL
ARG VITE_PROVIDER_ONBOARDING_V2
ARG VITE_STRIPE_SANDBOX_ENABLED
ARG WEB_CONFIG_FINGERPRINT
LABEL org.opencontainers.image.revision=${SOURCE_SHA} \
      io.hsm.web.api-url=${VITE_API_URL} \
      io.hsm.web.onboarding-v2=${VITE_PROVIDER_ONBOARDING_V2} \
      io.hsm.web.stripe-sandbox=${VITE_STRIPE_SANDBOX_ENABLED} \
      io.hsm.web.config-fingerprint=${WEB_CONFIG_FINGERPRINT}
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/nginx.conf
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
