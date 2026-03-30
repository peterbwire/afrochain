# AfroChain Explorer

This app is the public chain explorer for AfroChain. It is a Vite + React application that reads directly from the node API through `@afrochain/sdk`.

This app is the future extraction boundary for the `afrochain-explorer` repository.

## What the Explorer Does Today

The explorer is designed for both public inspection and operator visibility. It currently supports:

- chain overview
- finality overview
- metrics and corridor analytics
- treasury analytics
- network topology
- peer visibility
- mempool visibility
- faucet visibility
- recent activity feed
- recent blocks
- recent transactions
- validator standings
- deployed contract summaries
- governance proposal discovery
- account lookup
- global search across accounts, validators, proposals, transactions, and contracts

## Runtime and Configuration

The explorer connects to:

```text
import.meta.env.VITE_AFROCHAIN_API || http://localhost:4100
```

## Local Development

From the repo root:

```bash
npm run dev:explorer
```

Or from this workspace:

```bash
npm run dev
```

Production build:

```bash
npm run build --workspace @afrochain/explorer
```

## Main Data Sources

The explorer reads:

- `/chain`
- `/finality`
- `/metrics`
- `/treasury`
- `/network`
- `/mempool`
- `/faucet`
- `/activity`
- `/blocks`
- `/transactions`
- `/validators`
- `/contracts`
- `/proposals`
- `/accounts/:address`
- `/search`

That makes it both a user-facing explorer and a very practical operator surface for devnet deployments.

## Explorer Sections

### Chain and finality

Shows current height, tip, finalized height, and related confirmation context.

### Treasury and ecosystem state

Shows treasury balances, grant activity, pending vesting state, and broader treasury health.

### Network visibility

Shows:

- node metadata
- peer list
- last sync state
- persistence status
- mempool stats

### Search

Lets users search by:

- validator name
- address
- region
- proposal title
- contract name
- transaction references surfaced through indexed fields

### Direct account lookup

The explorer can load an account directly by address to show balance and staking context.

## Why the Explorer Is API-Driven

The explorer intentionally avoids importing protocol internals. Everything is built against the public node surface so it can:

- move to its own repo later
- point at remote nodes
- stay aligned with operator reality

## Current Limitations

- it is not yet a historical archival explorer with pagination over large chains
- it relies on the reference node's in-memory and persisted indexed data
- it is optimized for current devnet and prototype analytics rather than massive production indexing

Those tradeoffs are acceptable for a reference chain explorer.
