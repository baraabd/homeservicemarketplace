FROM node:24.21.0-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates openssl python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
USER node
RUN corepack prepare pnpm@10.32.1 --activate
