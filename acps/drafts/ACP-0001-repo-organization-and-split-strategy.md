# ACP-0001: Repository Organization and Split Strategy

- Status: Draft
- Type: Process
- Created: 2026-03-15
- Author: AfroChain Core Contributors

## Summary

AfroChain should continue active development in the current monorepo while maintaining boundaries that allow gradual extraction into an organization of focused repositories.

## Motivation

The project already spans protocol logic, token contracts, SDK tooling, wallet apps, explorer surfaces, and operational documentation. A future organization split will improve ownership and release cadence, but an immediate hard split would create unnecessary interface churn while protocol boundaries are still settling.

## Specification

AfroChain will adopt the following phased structure:

### Phase 1

- extract `afrochain-docs`
- extract `afrochain-improvement-proposals`
- extract `afrocoin-token`
- extract `afrochain-sdk`
- extract `afrochain-wallet`
- extract `afrochain-explorer`
- extract `afrochain-dashboard`

### Phase 2

- split `packages/protocol` into:
  - `afrochain-core`
  - `afrochain-consensus`
  - `afrochain-vm`
  - `afrochain-governance`

### Monorepo maintenance rules

- prefer package entrypoints over cross-workspace source imports
- avoid relative imports that cross workspace boundaries
- keep docs and ACPs readable without protocol source coupling
- keep token contract artifacts isolated under `contracts/afrocoin`

## Rationale

This approach keeps engineering velocity high now while reducing the cost of future repository extraction.

## Backwards Compatibility

No runtime behavior changes are required. This ACP only affects repository structure and contributor workflow.

## Security Considerations

Clear boundaries reduce accidental coupling and make security review easier once repositories are split.
