# AfroChain Repo Split Plan

AfroChain will continue development in this monorepo for now, but the codebase should be maintained as if a future organization split is certain.

## Immediate Strategy

- keep active development here
- treat each workspace as a future repository boundary
- avoid new cross-workspace relative imports
- prefer package entrypoints such as `@afrochain/sdk` over source-path imports
- prefer clean local workspace versions over path-based `file:` dependencies
- keep protocol internals inside `packages/protocol` until the core, consensus, governance, and VM contracts are stable enough to separate

This matters because premature splitting would force unstable interfaces across repositories. The current strategy keeps implementation velocity high while making extraction cheaper later.

## Current Future-Repo Mapping

- `packages/protocol` -> `afrochain-protocol` now, then later `afrochain-core`, `afrochain-consensus`, `afrochain-vm`, `afrochain-governance`
- `contracts/afrocoin` -> `afrocoin-token`
- `packages/sdk` and `packages/cli` -> `afrochain-sdk`
- `apps/wallet` and `apps/mobile-wallet` -> `afrochain-wallet`
- `apps/explorer` -> `afrochain-explorer`
- `apps/dashboard` -> `afrochain-dashboard`
- `docs` and `README.md` -> `afrochain-docs`
- future ACP documents -> `afrochain-improvement-proposals`

The machine-readable version of this map lives in `repo-map.json`.

## Why We Are Not Splitting `packages/protocol` Yet

Today, `packages/protocol` still combines:

- state machine logic
- consensus and staking
- governance execution
- native contract runtime
- persistence and sync
- the node API

Those boundaries are real conceptually, but still coupled enough that a hard split now would create churn. The current rule is:

- split extractable product and tooling boundaries first
- split protocol internals only after their interfaces stop moving so quickly

## Boundary Rules

- apps may depend on published package entrypoints, not other workspaces' source trees
- `packages/cli` may depend on `@afrochain/sdk`, not on app code or protocol internals by relative path
- `packages/protocol` must never import from `apps/`
- new shared logic should move into a package boundary before multiple apps depend on it
- docs and governance process documents should stay extractable without requiring protocol code

In practice that means:

- prefer `@afrochain/sdk` over `../../packages/sdk/src/...`
- prefer public API use over app-to-app code sharing
- move shared non-UI logic into a package before multiple apps depend on it
- keep repo-specific READMEs explicit about ownership and runtime expectations

## Extraction Order

### Phase 1

- `afrochain-docs`
- `afrochain-improvement-proposals`
- `afrocoin-token`
- `afrochain-sdk`
- `afrochain-wallet`
- `afrochain-explorer`
- `afrochain-dashboard`

### Phase 2

- `afrochain-core`
- `afrochain-consensus`
- `afrochain-vm`
- `afrochain-governance`

## What "Extractable" Means

A workspace is considered extractable when:

- it has a clear README with scope and setup
- it does not import sibling workspaces by relative path
- it depends on stable package entrypoints only
- it can be preview-exported from the repo map tooling
- its purpose is understandable without reading unrelated code

That standard is already being applied to:

- docs
- ACPs
- token contract
- SDK and CLI
- wallet and mobile wallet
- explorer
- dashboard

## Guardrail Tooling

Run the workspace boundary check regularly:

```bash
npm run check:boundaries
npm run check:split
npm run split:list
npm run split:show -- --repo afrochain-sdk
npm run split:export -- --repo afrochain-sdk --out .split-preview/afrochain-sdk --force
```

This check blocks:

- deep `@afrochain/*` imports such as `@afrochain/sdk/src/...`
- relative imports that escape a workspace root
- relative imports that reach into another workspace
- path-based local package dependencies that are harder to extract later

The split tooling also lets us preview future repositories locally before creating them in the organization.

## Split-Readiness Workflow

Before or during major changes, run:

```bash
npm run check:boundaries
npm run check:split
```

When you want to preview a future repo:

```bash
npm run split:list
npm run split:show -- --repo afrochain-sdk
npm run split:export -- --repo afrochain-sdk --out .split-preview/afrochain-sdk --force
```

This keeps repo extraction as an operational habit rather than a one-time cleanup project later.

## What We Should Keep Doing While Staying in One Repo

- add package-level READMEs as boundaries mature
- keep app configuration local to each app
- document environment variables near the package or app that uses them
- centralize developer-facing shared logic in packages rather than apps
- resist quick cross-workspace imports that save time now but create split debt later
- update `repo-map.json` whenever a new boundary becomes real

## Extract-First Candidates

If the organization split starts tomorrow, the safest first targets remain:

1. `afrochain-docs`
2. `afrochain-improvement-proposals`
3. `afrocoin-token`
4. `afrochain-sdk`
5. `afrochain-wallet`
6. `afrochain-explorer`
7. `afrochain-dashboard`

Those boundaries are the least likely to destabilize protocol internals during extraction.

## What This Does Not Do Yet

- it does not fully separate protocol concerns into standalone packages
- it does not create the ACP repository yet
- it does not publish packages independently
- it does not yet version protocol, SDK, wallet, and explorer release trains separately

Those are the next layers after the interfaces stabilize.
