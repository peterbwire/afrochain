# AfroChain Dashboard

This app is the ecosystem and operator dashboard for AfroChain. It is a Vite + React application that presents protocol state in a more narrative and product-facing format than the explorer.

This app is the future extraction boundary for the `afrochain-dashboard` repository.

## What the Dashboard Does Today

The dashboard focuses on the big-picture view of the network:

- chain overview
- metrics summary
- treasury summary
- validator summary
- governance summary
- contract summary
- faucet visibility
- network topology highlights
- developer and ecosystem framing

Where the explorer emphasizes inspection, the dashboard emphasizes interpretation.

## Runtime and Configuration

The dashboard connects to:

```text
import.meta.env.VITE_AFROCHAIN_API || http://localhost:4100
```

## Local Development

From the repo root:

```bash
npm run dev:dashboard
```

Or from this workspace:

```bash
npm run dev
```

Production build:

```bash
npm run build --workspace @afrochain/dashboard
```

## Data Sources

The dashboard reads:

- `/chain`
- `/metrics`
- `/treasury`
- `/network`
- `/faucet`
- `/validators`
- `/contracts`
- `/proposals`

This makes it a strong high-level control-room surface for demos, ecosystem presentations, and early operator visibility.

## Dashboard Use Cases

### Ecosystem storytelling

Show the network as:

- low-fee
- mobile-oriented
- treasury-backed
- validator-participatory
- developer-accessible

### Treasury awareness

Summarize:

- treasury balances
- grant activity
- vesting state
- validator concentration

### Governance awareness

Show:

- proposal counts
- proposal states
- network policy movement

### Builder onboarding

Provide a more approachable view of the protocol before someone drops into the explorer or protocol source code.

## Why It Exists Separately From the Explorer

The explorer and dashboard overlap, but they are not the same product:

- explorer is inspection-heavy
- dashboard is narrative and summary-heavy

Keeping them separate makes it easier to evolve one as a public chain explorer and the other as an ecosystem and operator surface.

## Current Limitations

- it is summary-oriented rather than drill-down-oriented
- it relies on the reference node for analytics
- it is not yet a role-aware admin console

Those tradeoffs are intentional for the current phase.
