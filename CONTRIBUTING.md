# Contributing to AfroChain

AfroChain is being built as a production-minded reference chain with future organization-level repo extraction in mind. Contributions should improve the codebase without creating split debt, hidden coupling, or unsafe protocol behavior.

## Before You Start

- read [README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/README.md)
- read [docs/architecture.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/docs/architecture.md)
- read [docs/operator-runbook.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/docs/operator-runbook.md)
- check [docs/repo-split-plan.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/docs/repo-split-plan.md) before adding new cross-workspace imports

## Local Validation

Run these before opening a pull request:

```bash
npm ci
npm run test:protocol
npm run test:sdk
npm run build --workspace @afrochain/wallet
npm run build --workspace @afrochain/explorer
npm run build --workspace @afrochain/dashboard
npm run check:boundaries
```

If you touch the mobile wallet, also run:

```bash
cd apps/mobile-wallet
npx expo export --platform web
```

## Contribution Rules

- keep protocol changes deterministic
- do not add anonymous privileged node mutations
- prefer package entrypoints over deep workspace imports
- preserve future repo split boundaries
- add tests for protocol and SDK behavior changes
- document new env vars, routes, or operator workflows
- do not commit `dist`, `node_modules`, or local data directories

## Pull Request Shape

Good AfroChain pull requests usually include:

- one clear change theme
- protocol or product rationale
- validation notes
- operator or migration notes when relevant

## Security-Sensitive Areas

Use extra care when changing:

- transaction validation
- staking and rewards
- governance parameter application
- snapshot import/export
- peer networking and relay auth
- wallet keystore or signing flows

If a change could affect consensus, balances, persistence integrity, or remote mutation surfaces, call that out clearly in the PR.

