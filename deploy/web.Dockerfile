FROM node:22-bookworm-slim AS builder

WORKDIR /app

ARG APP_DIR
ARG APP_WORKSPACE
ARG VITE_AFROCHAIN_API=http://localhost:4100

COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/explorer/package.json apps/explorer/package.json
COPY apps/mobile-wallet/package.json apps/mobile-wallet/package.json
COPY apps/wallet/package.json apps/wallet/package.json
COPY contracts/afrocoin/package.json contracts/afrocoin/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/sdk/package.json packages/sdk/package.json

RUN npm ci

COPY . .

ENV VITE_AFROCHAIN_API=${VITE_AFROCHAIN_API}

RUN npm run build --workspace ${APP_WORKSPACE}

FROM nginx:1.27-alpine AS runtime

ARG APP_DIR

COPY deploy/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/${APP_DIR}/dist /usr/share/nginx/html

EXPOSE 80

