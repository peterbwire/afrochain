FROM node:22-bookworm-slim AS base

WORKDIR /app

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

ENV NODE_ENV=production
EXPOSE 4200

CMD ["node", "packages/protocol/src/bin/start-validator.js"]

