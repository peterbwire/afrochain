# AfroChain

AfroChain is a reference implementation of a Proof-of-Stake Layer 1 blockchain designed around low fees, mobile-first usage, African financial inclusion, cross-border payments, smart contracts, validator participation, and treasury-backed ecosystem growth.

This repository is intentionally organized as a monorepo today so the protocol, SDK, apps, token artifacts, and governance surfaces can evolve together. At the same time, the codebase is being maintained with future organization-level repo extraction in mind.

## What AfroChain Includes

- a Layer 1 node implementation with block production, mempool handling, transaction execution, staking, governance, and treasury logic
- AfroCoin (AFC) as the native chain asset
- contract templates for AfroCoin system interactions, savings circles, and merchant escrow
- validator registration, delegation, reward accounting, and unbonding flows
- DAO governance with protocol proposals and treasury grant proposals
- multi-grant treasury proposals with optional vesting schedules and release tracking
- JSON snapshot persistence and SQLite-backed persistence history
- peer discovery and block catch-up synchronization
- a developer SDK for wallets, dApps, and tooling
- a CLI for operators, developers, and governance participants
- a React web wallet
- an Expo mobile wallet with secure keystore flows
- a React block explorer
- a React ecosystem dashboard
- Solidity token artifacts for future EVM-style integrations
- ACP governance-process scaffolding

## Repository Layout

### Core workspaces

- `packages/protocol`
  The chain runtime. This package owns the state machine, block production, staking, governance, treasury behavior, persistence, sync, and HTTP API.
- `packages/sdk`
  Shared developer-facing helpers for wallet creation, signing, unit conversion, and API access.
- `packages/cli`
  Operator and developer CLI layered on top of the SDK and public node APIs.

### User-facing apps

- `apps/wallet`
  Web wallet for payments, staking, governance, treasury proposals, and contract interaction.
- `apps/mobile-wallet`
  Expo-based mobile shell for devnet onboarding, account visibility, and mobile operator workflows.
- `apps/explorer`
  Chain explorer for blocks, transactions, validators, treasury activity, finality, and network state.
- `apps/dashboard`
  Narrative protocol dashboard for ecosystem framing, treasury summaries, governance visibility, and developer onboarding.

### Contracts and governance surfaces

- `contracts/afrocoin`
  Solidity AfroCoin reference artifacts for teams that need EVM-style compatibility alongside AfroChain-native behavior.
- `acps`
  AfroChain Improvement Proposal materials and templates.
- `docs`
  Main documentation set for architecture, operations, API use, and development workflows.

## Architecture Summary

AfroChain is implemented as a deterministic state machine driven by signed transactions.

High-level flow:

1. A client signs a transaction using the SDK or CLI.
2. The node validates the signature, sender, nonce, and fee requirement.
3. The transaction enters the mempool.
4. A selected proposer produces the next block from accepted transactions.
5. The node applies transaction logic, finalizes proposals, processes unbonding, releases vested treasury grants, and distributes rewards.
6. The block is committed, persisted, exposed over the API, and optionally shared with peers.

Key protocol capabilities:

- Proof-of-Stake proposer selection based on validator state
- validator registration and delegation accounting
- governance proposals for protocol changes and treasury actions
- immediate treasury grants and scheduled treasury vesting
- native contract template deployment and invocation
- cost estimation for contract gas and fee requirements
- finality tracking through a configurable finality depth
- snapshot-based and SQLite-backed persistence
- peer topology, sync journaling, and import/export tooling

Detailed architecture notes live in [docs/architecture.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/docs/architecture.md).

## Current Product Surface

### Wallet

The web wallet supports:

- AFC payments across named African remittance corridors
- payment simulation before submission
- validator registration, delegation, and reward-related actions
- protocol proposal creation and voting
- treasury proposal creation with multiple grants
- vesting-aware treasury grant proposals
- contract deployment
- method-specific contract calls with live fee estimation
- account activity and finality visibility

Wallet details live in [apps/wallet/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/apps/wallet/README.md).

### Explorer

The explorer supports:

- block and transaction inspection
- finalized height visibility
- validator and contract discovery
- treasury balances, grant history, and vesting schedules
- mempool and peer visibility
- indexed activity feeds and search

Explorer details live in [apps/explorer/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/apps/explorer/README.md).

### Mobile Wallet Shell

The mobile shell currently emphasizes:

- watch-mode account access
- developer faucet onboarding
- recent wallet activity
- finality and network health visibility
- corridor summaries for mobile-first operator flows

Mobile wallet details live in [apps/mobile-wallet/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/apps/mobile-wallet/README.md).

### Dashboard

The dashboard currently emphasizes:

- protocol framing
- treasury and governance summaries
- validator and network metrics
- developer onboarding snippets

Dashboard details live in [apps/dashboard/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/apps/dashboard/README.md).

## Running AfroChain Locally

### Prerequisites

- Node.js with npm available in the local environment
- enough local filesystem access to create snapshot and SQLite data files
- optional mobile tooling if you want to run the Expo shell on Android or iOS

### Install dependencies

```bash
npm install
```

If PowerShell blocks `npm`, use `npm.cmd`.

### Start the protocol node

```bash
npm run dev:node
```

This starts the HTTP API and node runtime with local persistence defaults.

### Start a validator-focused node

```bash
npm run dev:validator
```

Important environment variables:

- `AFC_VALIDATOR_ADDRESS`
- `AFC_PEERS`
- `AFC_OPERATOR_TOKEN`
- `AFC_PEER_TOKEN`
- `AFC_AUTOBLOCK_MS`
- `AFC_SYNC_MS`
- `AFC_SYNC_MEMPOOL_LIMIT`
- `AFC_DB_PATH`
- `AFC_SNAPSHOT_PATH`
- `AFC_NODE_LABEL`
- `AFC_REGION`
- `AFC_PUBLIC_URL`
- `AFC_TRANSPORT_SHARED_SECRET`
- `PORT`

Security note:

- privileged HTTP routes such as faucet funding, block production, peer administration, snapshots, and manual sync now require `AFC_OPERATOR_TOKEN`
- peer relay routes such as `/sync/transactions`, `/sync/blocks`, and `/sync/peers` now require `AFC_PEER_TOKEN`
- if `AFC_PEER_TOKEN` is not set, the node falls back to `AFC_TRANSPORT_SHARED_SECRET` when available
- if either token is missing, the corresponding protected route group is disabled instead of remaining anonymously writable

Operational guidance lives in [docs/operator-runbook.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/docs/operator-runbook.md).

### Start the web apps

```bash
npm run dev:wallet
npm run dev:explorer
npm run dev:dashboard
```

Operator-facing web flows can use:

- `VITE_AFROCHAIN_OPERATOR_TOKEN` for the wallet and dashboard

### Start the mobile shell

```bash
npm run dev:mobile-wallet
```

For Android emulators, the local node is typically reachable at `http://10.0.2.2:4100`.

Operator-facing mobile flows can use:

- `EXPO_PUBLIC_AFROCHAIN_OPERATOR_TOKEN`

## CLI Workflows

The CLI is intended to cover common operator and developer flows without requiring the wallet UI.

### Discover the CLI

```bash
npm run cli -- help
```

### Example commands

```bash
npm run cli -- wallet:create --out demo-wallet.json
AFC_OPERATOR_TOKEN=dev-operator-token npm run cli -- faucet --address afc_settlement_hub --amount 500
npm run cli -- payment --wallet demo-wallet.json --to afc_settlement_hub --amount 25 --simulate
npm run cli -- proposal:protocol --wallet demo-wallet.json --title "Lower base fee" --summary "Support mobile users" --parameter baseFee --value 250
npm run cli -- contract:call --wallet demo-wallet.json --contract afc_contract_afrocoin --method transfer --to afc_settlement_hub --amount 25 --simulate
npm run cli -- proposal:treasury --wallet demo-wallet.json --title "Grant" --summary "Pilot rollout" --grant-recipient afc_settlement_hub --grant-amount 250
npm run cli -- contracts:templates
npm run cli -- finality
npm run cli -- database:status
AFC_OPERATOR_TOKEN=dev-operator-token npm run cli -- network:sync
AFC_OPERATOR_TOKEN=dev-operator-token npm run cli -- snapshot:save --path snapshots/devnet.json
AFC_OPERATOR_TOKEN=dev-operator-token npm run cli -- snapshot:export --out snapshots/exported.json
AFC_OPERATOR_TOKEN=dev-operator-token npm run cli -- snapshot:import --file snapshots/devnet.json
```

CLI details live in [packages/cli/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/packages/cli/README.md).

## SDK Surface

The SDK is intended to stay application-agnostic and extraction-friendly.

Main areas:

- API access with `AfroChainClient`
- wallet generation
- unsigned transaction creation
- signing helpers
- unit conversion helpers
- address derivation utilities

SDK details live in [packages/sdk/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/packages/sdk/README.md).

## Protocol API Overview

Main endpoint groups:

- health, chain, metrics, network, finality, and database inspection
- transaction submission, simulation, and fee estimation
- blocks, transactions, accounts, validators, and staking reads
- governance and contract reads
- treasury, faucet, corridor, activity, and search views
- peers, snapshots, and sync routes

Detailed API documentation lives in [docs/api-reference.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/docs/api-reference.md).

## Persistence and Recovery

AfroChain supports two main persistence surfaces:

- JSON snapshots for direct export, import, and local portability
- SQLite-backed snapshot history and sync metadata for richer operator recovery

The node can restore from local persisted state and continue serving chain, treasury, and validator views without rebuilding from scratch every run.

Snapshot lifecycle:

- `GET /snapshots/export`
- `POST /snapshots/save`
- `POST /snapshots/import`
- CLI wrappers for save, export, and import

## Governance and Treasury Model

AfroChain governance currently supports:

- protocol parameter proposals
- treasury grant proposals
- multi-grant treasury proposals
- treasury vesting schedules with optional cliffs
- proposal voting by stakers
- proposal finalization during block production

Treasury execution can produce:

- immediate grant disbursements
- scheduled vesting records
- vesting release events over subsequent blocks
- indexed treasury events for operators and explorers

## Smart Contract Model

AfroChain currently uses native contract templates instead of a general bytecode VM.

Current templates:

- `afrocoin`
- `savings_circle`
- `merchant_escrow`

Contract interactions include:

- deployment fee estimation
- method fee estimation
- gas limit enforcement
- receipts with gas and minimum-fee data
- contract activity indexing

The Solidity token artifact is documented in [contracts/afrocoin/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/contracts/afrocoin/README.md).

## Tests and Verification

Run the protocol test suite with:

```bash
node packages/protocol/src/tests/core.test.js
```

Current automated coverage includes:

- signed AFC payments
- validator onboarding
- protocol governance updates
- treasury proposals
- multi-grant treasury vesting releases
- contract deployment and execution
- AfroCoin method-argument contract calls
- simulation behavior
- JSON snapshot persistence
- SQLite persistence
- peer synchronization
- indexed activity and search

## Documentation Map

- [docs/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/docs/README.md)
- [docs/architecture.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/docs/architecture.md)
- [docs/api-reference.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/docs/api-reference.md)
- [docs/operator-runbook.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/docs/operator-runbook.md)
- [docs/dapp-cookbook.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/docs/dapp-cookbook.md)
- [docs/repo-split-plan.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/docs/repo-split-plan.md)
- [packages/protocol/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/packages/protocol/README.md)
- [packages/sdk/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/packages/sdk/README.md)
- [packages/cli/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/packages/cli/README.md)
- [apps/wallet/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/apps/wallet/README.md)
- [apps/explorer/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/apps/explorer/README.md)
- [apps/mobile-wallet/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/apps/mobile-wallet/README.md)
- [apps/dashboard/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/apps/dashboard/README.md)
- [contracts/afrocoin/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/contracts/afrocoin/README.md)
- [acps/README.md](/c:/Users/Stee_Vin/Desktop/mp/afrochain/acps/README.md)

## Important Status Note

AfroChain is a serious reference implementation, but it is still a prototype and not a production-hardened mainnet implementation.

That means:

- the chain is readable and extensible by design
- the API and tooling are meant for development and experimentation
- consensus, networking, persistence, and security still have room for hardening
- repo extraction work is intentionally deferred until package boundaries settle further

That honesty is intentional. The project is designed to create a strong foundation for further protocol, product, and infrastructure work without pretending unfinished parts are already final.
