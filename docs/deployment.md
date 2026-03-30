# AfroChain Deployment

This document starts the deployment layer for AfroChain as a public monorepo.

## What Exists Now

- container image definitions for the protocol node and validator
- a reusable web-app container build for wallet, explorer, and dashboard
- a `docker-compose.yml` devnet stack
- a GitHub Actions CI workflow for tests and web bundle checks

## Compose Devnet

From the repo root:

```bash
docker compose up --build
```

Services:

- `afrochain-node`
  Public node API on `http://localhost:4100`
- `afrochain-validator`
  Validator-oriented node on `http://localhost:4200`
- `afrochain-explorer`
  Explorer on `http://localhost:8081`
- `afrochain-dashboard`
  Dashboard on `http://localhost:8082`
- `afrochain-wallet`
  Web wallet on `http://localhost:8083`

## Important Notes

- the compose file uses development secrets and is not production-ready
- operator tokens are intentionally explicit in compose so the stack is easy to boot locally
- those values must be replaced before any shared or remote deployment
- baking an operator token into a static wallet/dashboard build is convenient for local devnet use but not suitable for a public production deployment

## Recommended Next Ops Layer

- secret management for operator and peer tokens
- production reverse proxy and TLS termination
- structured logs and metrics export
- container image publishing
- preview environments for pull requests
- dedicated production deployment manifests after protocol internals stabilize

