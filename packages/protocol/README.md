# AfroChain Protocol

`@afrochain/protocol` is the core runtime for AfroChain. It contains the node state machine, Proof-of-Stake block production, staking and delegation rules, governance execution, treasury and vesting logic, native contract templates, persistence helpers, peer sync, and the HTTP API.

This package is the current future boundary for `afrochain-protocol`. Later, it is expected to split into:

- `afrochain-core`
- `afrochain-consensus`
- `afrochain-vm`
- `afrochain-governance`

For now, those concerns stay together so interfaces can stabilize without cross-repo churn.

## What This Package Owns

- genesis state creation
- account balances and nonces
- mempool validation and transaction admission
- block production and block acceptance
- PoS proposer selection
- validator registration, delegation, undelegation, reward claiming, and unbonding
- governance proposal creation, voting, finalization, and treasury execution
- treasury grants and treasury vesting schedules
- native contract deployment and contract calls
- fee estimation, gas estimation, and transaction simulation
- JSON snapshot persistence
- SQLite-backed snapshot and sync history
- peer registration and catch-up sync
- the public HTTP API consumed by apps, SDK, CLI, and peer nodes

## API Auth Model

AfroChain now splits the HTTP surface into three classes:

- public read routes such as health, chain, metrics, account reads, explorer reads, and fee estimation
- operator routes such as faucet funding, block production, peer administration, manual sync, and snapshot import/export
- peer relay routes such as `/sync/transactions`, `/sync/blocks`, and `/sync/peers`

Environment variables used by the runtime entrypoints:

- `AFC_OPERATOR_TOKEN`
  Enables operator routes. If unset, those routes return a disabled response instead of remaining publicly writable.
- `AFC_PEER_TOKEN`
  Enables authenticated HTTP peer relay.
- `AFC_TRANSPORT_SHARED_SECRET`
  Used by the socket transport and also acts as the default `AFC_PEER_TOKEN` fallback when no explicit peer token is provided.

This keeps public reads easy to consume while blocking anonymous mutation of node state and relay traffic.

## Package Exports

`src/index.js` exports the public protocol surface:

- `AfroChainNode`
- `createApiServer`
- `createGenesisState`
- `BOOTSTRAP_VALIDATORS`
- `TOTAL_SUPPLY`
- `SYSTEM_CONTRACTS`
- `listContractTemplates`
- `deriveAddress`
- `serializeTransaction`
- `AfroChainDatabase`
- `createDatabase`
- `syncNodeWithPeers`
- `loadSnapshotFile`
- `saveSnapshotFile`
- `AFC_DECIMALS`
- `AFC_SYMBOL`
- `AFC_UNIT`
- `formatUnits`

These exports are the safest integration points if another workspace needs protocol-aware behavior without reaching deep into implementation files.

## Source Map

### Runtime and API

- `src/node.js`
  Main state machine, transaction execution, block lifecycle, queries, analytics, snapshots, and peer interaction.
- `src/api.js`
  HTTP server exposing chain, treasury, staking, governance, contracts, sync, and operator endpoints.
- `src/index.js`
  Stable package entrypoint.

### State and execution

- `src/genesis.js`
  Default chain parameters, treasury accounts, bootstrap validators, faucet configuration, and system contracts.
- `src/crypto.js`
  Address derivation, transaction serialization, transaction ID generation, and signature verification.
- `src/utils.js`
  Shared utilities for hashing, cloning, weighted selection, corridor keys, and AFC unit helpers.

### Consensus and incentives

- `src/staking.js`
  Validator registration, delegation, undelegation, reward distribution, and proposer selection.
- `src/governance.js`
  Governance proposal validation, treasury grant execution, vesting schedules, voting, and proposal finalization.

### Contracts

- `src/contracts/templates.js`
  Native contract template registry, deploy/call/read behavior, gas estimation, and system contracts.

### Persistence and networking

- `src/persistence.js`
  JSON snapshot read and write helpers.
- `src/database.js`
  SQLite persistence for recent snapshots and sync summaries.
- `src/peer-sync.js`
  Peer discovery, block import, and mempool import logic.

### Operational entrypoints

- `src/bin/start-node.js`
  Start a public or observer node.
- `src/bin/start-validator.js`
  Start a validator-oriented node.
- `src/bin/export-snapshot.js`
  Export a snapshot directly from a persisted node state.

### Tests

- `src/tests/core.test.js`
  End-to-end reference coverage for payments, staking, governance, treasury vesting, contracts, snapshots, persistence, indexing, and sync.

## Execution Model

AfroChain is a deterministic transaction-driven state machine.

At a high level:

1. A client builds and signs a transaction.
2. The node validates signature, sender, nonce, fee, and payload requirements.
3. The transaction enters the mempool.
4. The selected proposer builds the next block.
5. Transactions are executed against state in order.
6. Post-transaction maintenance runs:
   - pending withdrawals mature
   - governance proposals finalize
   - treasury vesting schedules release
   - validator rewards distribute
7. The block is hashed, committed, persisted, and optionally broadcast to peers.

The package is designed to keep that flow readable. Most behavior is implemented in direct JavaScript rather than hidden behind framework abstractions.

## State Model

The protocol state includes:

- `balances`
  AFC balances for wallets, treasury accounts, pools, and contract addresses.
- `nonces`
  The next committed transaction nonce per address.
- `rewardAccounts`
  Unclaimed staking rewards.
- `validators`
  Validator metadata including stake totals, commission, uptime, and endpoint.
- `delegations`
  Per-validator delegation books.
- `pendingWithdrawals`
  Undelegations waiting for the unbonding period to expire.
- `proposals`
  Governance proposals and ballots.
- `pendingTreasuryGrants`
  Active treasury vesting schedules.
- `treasuryEvents`
  Recent treasury disbursement and vesting events.
- `contracts`
  System and user-deployed native contract instances.
- `transactions`
  Committed transactions keyed by transaction ID.
- `metrics`
  Network, corridor, treasury, fee-burn, gas, and contract activity metrics.
- `faucet`
  Developer faucet configuration and request history.
- `addressBook`
  Labels, types, and regions for known addresses.
- `params`
  Mutable protocol parameters changed through governance.

## Transaction Types

The protocol currently understands these signed transaction types:

- `payment`
  Transfers AFC and records corridor metrics.
- `stake`
  Handles `register_validator`, `delegate`, `undelegate`, and `claim_rewards`.
- `proposal`
  Creates protocol or treasury governance proposals.
- `vote`
  Casts a governance vote using stake-weighted voting power.
- `contract_deploy`
  Deploys a native contract template instance.
- `contract_call`
  Invokes a callable method on a deployed contract.

Every transaction carries:

- `sender`
- `publicKey`
- `signature`
- `nonce`
- `fee`
- `type`
- `payload`
- `timestamp`

## Proof of Stake Model

Current proposer selection is stake-weighted.

- active validators are pulled from `state.validators`
- each validator contributes weight equal to `totalStake`
- proposer selection is derived from the previous block hash plus next height
- if a validator node is running with `validatorAddress`, it may only produce the block when selected unless forced in observer mode

This keeps the implementation deterministic and simple enough for a reference chain while still exercising validator economics and proposer rotation.

## Staking Rules

### Registering a validator

`stake` with `action: register_validator`:

- requires self-stake at or above `minValidatorStake`
- debits the registering address
- creates a validator record
- seeds the validator's self-delegation book

### Delegation

`stake` with `action: delegate`:

- moves AFC from the delegator balance into validator stake
- increases `delegatedStake` unless self-delegating
- immediately changes proposer weight

### Undelegation

`stake` with `action: undelegate`:

- removes stake from the validator
- creates a pending withdrawal
- makes funds claimable after `unbondingPeriodBlocks`
- can deactivate a validator if self-stake falls below minimum

### Claiming rewards

`stake` with `action: claim_rewards`:

- transfers the caller's reward account balance back into liquid balance

### Reward distribution

On block production or acceptance:

- base reward is paid from treasury up to `blockReward`
- a portion of fees is burned using `feeBurnRate`
- a portion of fees is routed to the mobile relayer pool using `mobileRelayerRate`
- the remainder plus block reward is distributed to proposer and delegators
- proposer commission is applied before the remaining reward pool is shared by stake

## Governance and Treasury

Governance is stake-weighted and currently supports:

- protocol parameter changes
- treasury grant proposals
- informational proposals

### Proposal lifecycle

1. A staker submits a `proposal` transaction and pays `proposalDeposit`.
2. The proposal becomes active from the next block until `governanceVotingWindow` expires.
3. Stakers submit `vote` transactions with `for`, `against`, or `abstain`.
4. After expiry, the node finalizes the proposal during block production.
5. If quorum and vote conditions pass:
   - protocol changes are applied
   - treasury grants disburse immediately or create vesting schedules
   - the proposer deposit is returned
6. If rejected or execution fails:
   - the deposit is routed to treasury

### Treasury proposals

Treasury proposals can include:

- one or many grants
- multiple funding sources
- optional notes and labels
- optional vesting duration
- optional vesting cliff

Immediate grants transfer AFC directly to recipients. Vested grants move AFC into `treasuryVestingEscrow` and release over future blocks.

## Native Contract Runtime

AfroChain currently ships a native template system instead of a general bytecode VM. That is a deliberate prototype choice.

Current templates:

- `afrocoin`
  Native AFC token-style system contract with `approve`, `transfer`, and `transferFrom`.
- `governance`
  Read-oriented system contract surfacing parameters and proposals.
- `savings_circle`
  Community savings primitive with `join`, `contribute`, and `payoutNext`.
- `merchant_escrow`
  Buyer-merchant escrow with `fund`, `release`, and `refund`.

Gas behavior:

- each template exposes deploy and method gas estimates
- deploy and call transactions use `contractGasPrice`
- transactions must provide a `gasLimit` high enough for the estimated execution
- receipts report `gasUsed`, `gasLimit`, and `minimumFee`

## Persistence

The protocol supports three persistence modes:

- `memory`
  No snapshot path and no SQLite database configured.
- `snapshot`
  JSON snapshot file only.
- `hybrid`
  JSON snapshot plus SQLite snapshot/sync history.

Snapshots contain:

- full state
- full chain
- mempool contents
- peer list
- node metadata
- validator identity
- last sync summary

When both a JSON snapshot and SQLite snapshot history exist, `AfroChainNode.createFromDisk()` restores from the freshest snapshot by:

1. highest height
2. newest export timestamp when heights match

## Networking and Sync

Peer support is intentionally simple and readable:

- peers are registered by URL with optional label and region
- `POST /peers` adds peers to the local directory
- `syncNodeWithPeers()`:
  - checks peer health
  - imports newly discovered peers
  - fetches missing blocks by height
  - imports new mempool transactions
  - records sync results locally

This is not a production gossip layer yet. It is a reference sync path designed to prove operator workflows and peer-aware recovery.

## Public API Role

The protocol package is the source of the public node API used by:

- `@afrochain/sdk`
- `@afrochain/cli`
- `apps/wallet`
- `apps/explorer`
- `apps/dashboard`
- `apps/mobile-wallet`
- peer node sync flows

For complete endpoint details, see `../../docs/api-reference.md`.

## Running the Package

From the repo root:

```bash
npm run dev:node
npm run dev:validator
npm run snapshot:export
```

Direct protocol test run:

```bash
node packages/protocol/src/tests/core.test.js
```

## Testing Coverage

The current protocol test suite covers:

- signed cross-border AFC payments
- validator onboarding and governance parameter changes
- savings circle deployment and execution
- AfroCoin contract method execution with typed arguments
- multi-grant treasury proposals and vesting releases
- simulation without committed state mutation
- faucet and snapshot round-tripping
- activity indexing, corridors, and search
- SQLite restoration
- peer sync across follower nodes

## Design Tradeoffs

This package intentionally prioritizes:

- readability over maximal abstraction
- deterministic state transitions over architectural cleverness
- rapid iteration inside a monorepo over early multi-repo separation
- practical devnet workflows over production-grade networking

That makes it a strong reference implementation and a good foundation, but not yet a hardened mainnet protocol package.
