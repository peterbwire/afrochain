# AfroChain Docs

This directory is the documentation home for AfroChain. The goal is straightforward: anyone opening the repo should be able to understand what the protocol does, how to run it, how to build against it, and where future repository boundaries are expected to land.

## Who This Documentation Is For

- protocol contributors working inside `packages/protocol`
- wallet, explorer, dashboard, and mobile contributors building on the public API
- validator and node operators running local or shared devnet infrastructure
- application developers integrating through `@afrochain/sdk`
- ecosystem contributors proposing governance or process changes through ACPs

## Start Here

If you are new to the project, read these in order:

1. `../README.md`
   The top-level project overview, quick-start commands, and repo map.
2. `architecture.md`
   The protocol shape, state model, transaction flow, staking rules, governance flow, treasury behavior, contracts, persistence, and sync model.
3. `api-reference.md`
   The HTTP surface used by the SDK, CLI, wallet, explorer, mobile shell, and operator tooling.
4. `operator-runbook.md`
   How to run nodes, validators, snapshots, sync, persistence, and health checks.
5. `dapp-cookbook.md`
   End-to-end examples for wallet generation, payments, governance, treasury, and contract flows.

## Documentation Map

### Core project docs

- `../README.md`
  Main repo overview and quick start.
- `architecture.md`
  Detailed protocol architecture.
- `api-reference.md`
  Public HTTP API reference.
- `operator-runbook.md`
  Operational runbook for nodes and validators.
- `dapp-cookbook.md`
  Integration examples using the SDK and API.
- `deployment.md`
  Container, compose, and CI deployment starting point.
- `repo-split-plan.md`
  How the monorepo is being maintained for future extraction into an organization.

### Package and app docs

- `../packages/protocol/README.md`
  Protocol package guide, exports, source map, state model, and runtime behavior.
- `../packages/sdk/README.md`
  SDK exports, helpers, client surface, and usage patterns.
- `../packages/cli/README.md`
  CLI command reference and operator workflows.
- `../apps/wallet/README.md`
  Web wallet responsibilities, runtime assumptions, and user flows.
- `../apps/explorer/README.md`
  Explorer feature map and API dependencies.
- `../apps/mobile-wallet/README.md`
  Expo mobile shell goals, watch-mode behavior, and current limits.
- `../apps/dashboard/README.md`
  Ecosystem dashboard scope and data sources.
- `../contracts/afrocoin/README.md`
  Solidity AfroCoin contract and how it relates to the native chain asset.
- `../acps/README.md`
  AfroChain Improvement Proposal process and directory structure.

## Source of Truth Guidance

AfroChain has a few documentation layers, and each one serves a different purpose:

- root and `docs/` files explain the system at project level
- package and app READMEs explain a single boundary in detail
- source files remain the final truth for implementation behavior

When these disagree, implementation wins. The docs in this directory are written directly against:

- `packages/protocol/src/node.js`
- `packages/protocol/src/api.js`
- `packages/protocol/src/staking.js`
- `packages/protocol/src/governance.js`
- `packages/protocol/src/contracts/templates.js`
- `packages/protocol/src/genesis.js`
- `packages/protocol/src/database.js`
- `packages/protocol/src/peer-sync.js`
- `packages/sdk/src/*`
- `packages/cli/src/main.js`
- `apps/*/src/App.*`

## Suggested Reading By Role

### Protocol contributor

Read:

1. `architecture.md`
2. `../packages/protocol/README.md`
3. `operator-runbook.md`
4. `repo-split-plan.md`

### dApp or wallet developer

Read:

1. `api-reference.md`
2. `dapp-cookbook.md`
3. `../packages/sdk/README.md`
4. `../apps/wallet/README.md`

### Validator or node operator

Read:

1. `operator-runbook.md`
2. `api-reference.md`
3. `../packages/cli/README.md`
4. `../packages/protocol/README.md`

### Governance contributor

Read:

1. `architecture.md`
2. `../acps/README.md`
3. `../acps/TEMPLATE.md`
4. `../acps/drafts/ACP-0001-repo-organization-and-split-strategy.md`

## Current Documentation Philosophy

AfroChain is intentionally honest about being a serious reference implementation rather than a production-hardened mainnet. The documentation reflects that.

That means these docs do not pretend that:

- consensus networking is already production-grade
- the current native contract template system is a full general-purpose VM
- the mobile wallet already solves production-grade mobile custody
- repo extraction has already happened

Instead, the docs aim to be explicit about:

- what exists now
- how it behaves today
- what is stable enough to build on
- which pieces are still prototypes or future split targets

## Keeping Docs Healthy

Whenever you change one of these surfaces, update its docs in the same pass:

- new node endpoint or transaction behavior
- changed governance parameters or treasury logic
- new contract template or contract method
- new CLI command or SDK helper
- app feature additions that change supported workflows
- repo-boundary or extraction assumptions

The documentation should stay extraction-friendly too. Package and app READMEs should describe their boundary clearly enough that each could become its own repository without having to rediscover its purpose later.
