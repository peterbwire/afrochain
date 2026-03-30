# AfroChain Operator Runbook

This runbook covers how to run, inspect, recover, and demo AfroChain nodes in the current reference implementation.

## Operating Model

AfroChain currently supports two practical node roles:

- observer or public node
  A node that exposes the API, tracks chain state, and may force block production in local demos.
- validator-oriented node
  A node pinned to a validator address that only produces blocks when selected by PoS proposer logic.

Both roles can:

- serve the full HTTP API
- persist state to JSON snapshots
- persist snapshot and sync history to SQLite
- register peers and synchronize from them

## Prerequisites

- Node.js and npm installed
- project dependencies installed with `npm install`
- writable local filesystem for `data/`
- optional Android or iOS tooling if you also want to point the mobile shell at your node

## Common Commands

From the repo root:

```bash
npm run dev:node
npm run dev:validator
npm run snapshot:export
npm run cli -- help
```

## Public or Observer Node

Start a standard node with:

```bash
npm run dev:node
```

Default behavior:

- listens on `PORT` or `4100`
- restores from disk if snapshots or SQLite state exist
- auto-produces blocks every 15 seconds
- syncs with peers every 12 seconds
- persists to both JSON snapshot and SQLite by default

This mode is ideal for:

- local development
- explorer backends
- wallet demos
- catch-up or monitoring nodes

## Validator Node

Start a validator-oriented node with:

```bash
npm run dev:validator
```

Default behavior:

- listens on `PORT` or `4200`
- uses `AFC_VALIDATOR_ADDRESS` or defaults to `afc_validator_nairobi`
- auto-produces when selected as proposer
- syncs more frequently by default than the observer node
- persists validator-specific snapshot and database files

This mode is best for:

- validator demos
- proposer selection testing
- multi-node peer sync testing

## Environment Variables

These variables are used by the startup scripts in `packages/protocol/src/bin`.

### Shared node variables

- `PORT`
  API bind port. Defaults to `4100` for public node and `4200` for validator node.
- `AFC_CHAIN_ID`
  Chain identifier. Defaults to `afrochain-1`.
- `AFC_NETWORK`
  Network label. Defaults to `devnet`.
- `AFC_NODE_LABEL`
  Human-readable node label exposed in network metadata.
- `AFC_REGION`
  Region label exposed by the node. Defaults to `Pan-Africa`.
- `AFC_PUBLIC_URL`
  Public base URL for peer registration and discovery.
- `AFC_PEERS`
  Comma-separated peer URLs.
- `AFC_SNAPSHOT_PATH`
  Snapshot file path.
- `AFC_DB_PATH`
  SQLite database path.
- `AFC_AUTOBLOCK_MS`
  Auto-production interval in milliseconds.
- `AFC_SYNC_MS`
  Sync loop interval in milliseconds.
- `AFC_SYNC_MEMPOOL_LIMIT`
  Number of remote mempool transactions to inspect during each sync.

### Validator-specific variable

- `AFC_VALIDATOR_ADDRESS`
  Local validator identity. Required for deterministic validator operation. Defaults to `afc_validator_nairobi` in `dev:validator`.

### Snapshot export variable

- `AFC_EXPORT_PATH`
  Export target used by `npm run snapshot:export`.

## Default Data Locations

Unless overridden:

- public node snapshot: `data/node-snapshot.json`
- public node database: `data/node-state.sqlite`
- validator snapshot: `data/<validator>-snapshot.json`
- validator database: `data/<validator>-state.sqlite`
- export snapshot: `data/exported-snapshot.json`

## Restore and Persistence Behavior

At startup, the node tries to restore from disk by comparing:

- explicit in-memory snapshot, if provided
- JSON snapshot file
- latest SQLite snapshot

The freshest snapshot wins by:

1. highest block height
2. newest export time if heights are equal

Persistence modes visible through `/chain`:

- `memory`
- `snapshot`
- `hybrid`

`hybrid` means JSON snapshots plus SQLite snapshot and sync history.

## Health and Status Checks

These endpoints matter most in operations:

- `GET /health`
  Quick health plus chain overview.
- `GET /chain`
  Chain tip, fee parameters, persistence mode, total staked, and token metadata.
- `GET /network`
  Node metadata, peers, last persist time, last sync summary, mempool stats, and database status.
- `GET /finality`
  Finalized height, finalized tip hash, finality depth, and tip height.
- `GET /database`
  SQLite enablement, path, latest snapshot, and latest sync record.
- `GET /mempool`
  Pending transaction list and per-type counts.
- `GET /treasury`
  Treasury balances, pending grants, vesting releases, and proposal summary.
- `GET /validators`
  Validator standings and reward balances.
- `GET /activity`
  Recent chain and treasury activity.

## Recommended Operator Checks

For a healthy devnet node, verify:

- the process is reachable on `/health`
- `height` increases over time if auto-blocking is enabled
- `persistenceMode` matches your intent
- `latestSnapshot` exists in `/database` when SQLite is enabled
- `peerCount` is non-zero when running in a multi-node setup
- `lastSyncSummary.status` is not repeatedly `failed`
- mempool size is not growing indefinitely
- treasury vesting escrow and pending grants look reasonable after governance tests

## Bootstrapping a Local Demo

### Single-node flow

1. Start `npm run dev:node`.
2. Create a wallet with:

```bash
npm run cli -- wallet:create --out demo-wallet.json
```

3. Request faucet funds:

```bash
npm run cli -- faucet --address afc_... --amount 500
```

4. Submit a payment or stake action.
5. Wait for the next block or force production through:

```bash
curl -X POST http://localhost:4100/blocks/produce -H "content-type: application/json" -d "{}"
```

### Two-node sync flow

1. Start an observer node on port `4100`.
2. Start a validator node on another port with `AFC_PEERS=http://localhost:4100`.
3. Add reciprocal peers if desired through `POST /peers`.
4. Produce activity on one node.
5. Trigger manual sync:

```bash
npm run cli -- network:sync --api http://localhost:4200
```

6. Check `/network` and `/database` on the follower.

## Snapshot Operations

### Export via script

```bash
npm run snapshot:export
```

### Export via API

- `GET /snapshots/export`

### Save current in-memory state to a specific path

- `POST /snapshots/save`

Body:

```json
{
  "path": "snapshots/devnet.json"
}
```

### Import a snapshot

- `POST /snapshots/import`

Body:

```json
{
  "chain": [],
  "state": {},
  "mempool": [],
  "peers": []
}
```

### CLI wrappers

```bash
npm run cli -- snapshot:save --path snapshots/devnet.json
npm run cli -- snapshot:export --out snapshots/exported.json
npm run cli -- snapshot:import --file snapshots/devnet.json
```

## Manual Sync Operations

Manual sync is useful when:

- a follower node has been offline
- you want an operator-visible sync record
- you want to limit mempool imports

API:

- `POST /network/sync`

Body:

```json
{
  "mempoolLimit": 25
}
```

CLI:

```bash
npm run cli -- network:sync --mempool-limit 25
```

The sync summary records:

- discovered peers
- imported blocks
- imported transactions
- per-peer status
- final height and final tip hash
- errors

## Faucet Operations

The faucet is designed for development and onboarding, not public production distribution.

Read faucet state:

- `GET /faucet`

Request funds:

- `POST /faucet`

Example:

```json
{
  "address": "afc_demo_wallet",
  "amount": 500000000,
  "label": "Demo wallet",
  "note": "Onboarding test",
  "region": "Kenya"
}
```

Important faucet behavior:

- capped by `maxAmount`
- protected by per-address cooldown
- debits `afc_community_grants`
- records recent disbursements
- updates the address book if needed

## Validator Operations

Validator-specific tasks include:

- ensuring the validator address exists and has funds
- self-staking above `minValidatorStake`
- checking proposer rotation with `/validators` and `/chain`
- monitoring reward account growth
- tracking undelegations and pending withdrawals

Useful CLI flows:

```bash
npm run cli -- stake --wallet validator.json --action register_validator --amount 300000 --name "Accra Edge" --region Ghana
npm run cli -- stake --wallet validator.json --action delegate --validator afc_validator_nairobi --amount 1000
npm run cli -- stake --wallet validator.json --action undelegate --validator afc_validator_nairobi --amount 250
npm run cli -- stake --wallet validator.json --action claim_rewards
```

## Explorer and Dashboard Backends

The explorer and dashboard are API clients. If they look stale:

- check `/health`
- check `/chain`
- check `/metrics`
- check `/treasury`
- confirm the expected node URL is configured in `VITE_AFROCHAIN_API`

For the mobile shell, Android emulators typically need:

- `http://10.0.2.2:4100`

## Common Failure Modes

### Node starts but state looks reset

Check:

- `AFC_SNAPSHOT_PATH`
- `AFC_DB_PATH`
- write permissions to `data/`
- whether a fresher snapshot from another source replaced the one you expected

### Validator does not produce blocks

Check:

- `AFC_VALIDATOR_ADDRESS`
- validator is active in `/validators`
- self-stake is above minimum
- current proposer selection does not belong to another validator

### Sync reports repeated failures

Check:

- peer URLs are reachable
- peer nodes expose `/health`
- chain IDs and networks are aligned
- local tip hash and remote chain are compatible

### Faucet requests fail

Check:

- amount is below cap
- cooldown has expired
- faucet treasury still has balance
- address format is valid

### Snapshot import fails

Check:

- JSON has both `chain` and `state`
- `state.balances` and `state.nonces` exist
- imported chain tip is compatible with the expected environment

## Production Reality Check

This runbook is for a serious prototype and reference environment. It is not yet a production mainnet SRE handbook.

In particular:

- peer sync is basic
- there is no hardened admission firewalling
- there is no full validator networking stack
- there is no externalized secrets or key management layer
- there is no separate consensus daemon

That said, the current node is already useful for:

- development
- demos
- wallet and explorer integration
- governance testing
- treasury workflow testing
- validator education
