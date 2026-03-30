# AfroChain Architecture

AfroChain is a reference Proof-of-Stake Layer 1 built around three practical goals:

- low transaction costs
- mobile-first usability
- financial inclusion and cross-border payment flows in African markets

The current implementation is a monorepo, but the architecture is already being maintained with future organization-level extraction in mind.

## System Shape

AfroChain is made of four layers today:

1. protocol runtime
2. public HTTP API
3. SDK and CLI tooling
4. product surfaces such as wallet, explorer, dashboard, and mobile shell

The protocol is the center of gravity. Everything else builds on its exported APIs and public node routes.

## Protocol Runtime

The runtime lives in `packages/protocol/src/node.js`. It owns:

- chain state
- block creation and block acceptance
- mempool admission
- staking and validator accounting
- governance proposals and voting
- treasury execution and vesting release processing
- native contract deployment and execution
- fee estimation and simulation
- persistence
- peer synchronization
- query helpers used by the HTTP API

The node is intentionally state-machine oriented. It keeps most protocol behavior in one readable execution path rather than splitting it across many service layers.

## Design Principles

### Deterministic execution

The same committed chain history should always produce the same state.

### Honest prototyping

The implementation does not pretend to be production-hardened where it is not. Peer sync, native contracts, and persistence are real and useful, but still reference-grade.

### Split-ready boundaries

Even though development stays in one repo for now, apps and packages are being kept extractable for a future organization.

### Mobile-first economics

Fees, relayer subsidies, cross-border corridor metrics, and treasury priorities all reflect the intended focus on small payments and inclusion-heavy use cases.

## Chain State

The default state is created in `packages/protocol/src/genesis.js`.

### Native token

- token: `AfroCoin`
- symbol: `AFC`
- decimals: `6`
- total supply: `2,100,000,000 AFC`

### Treasury and ecosystem accounts

Genesis seeds several named accounts:

- `afc_treasury`
  Core treasury and reward funding source.
- `afc_community_grants`
  Community grants treasury and faucet source.
- `afc_settlement_hub`
  Cross-border settlement liquidity pool.
- `afc_innovation_fund`
  Innovation and inclusion reserve.
- `afc_mobile_relayer_pool`
  Mobile subsidy pool funded partly by fee routing.
- `afc_treasury_vesting_escrow`
  Holding account for treasury grants that vest over time.

### Bootstrap validators

Genesis also creates four validators:

- Nairobi Core
- Lagos Relay
- Kigali Trust
- Cape Town Edge

Each starts with:

- liquid balance
- self-stake
- validator metadata
- commission rate
- endpoint and region

### Mutable protocol parameters

These are governance-controlled today:

- `baseFee`
- `blockReward`
- `contractGasPrice`
- `contractDeploymentBond`
- `defaultContractGasLimit`
- `finalityDepth`
- `governanceVotingWindow`
- `maxTransactionsPerBlock`
- `minValidatorStake`
- `proposalDeposit`
- `quorumRate`
- `targetBlockTimeMs`
- `unbondingPeriodBlocks`

## Accounts and Addresses

Addresses are prefixed with `afc_`. The protocol derives them from the public key hash. Wallets are signed with ECDSA P-256 keys and verified by the node before admission or execution.

An account view includes:

- `address`
- `balance`
- `label`
- `nonce`
- `pendingWithdrawals`
- `rewards`
- `stakingPower`

## Transaction Lifecycle

### Step 1: client construction

A wallet, SDK, or CLI builds a transaction with:

- `sender`
- `publicKey`
- `nonce`
- `fee`
- `type`
- `payload`
- `timestamp`

The transaction is then signed and assigned a transaction ID.

### Step 2: mempool admission

The node validates:

- sender and address shape
- signature validity
- nonce ordering
- fee sufficiency
- payload requirements for the chosen transaction type
- gas limit constraints for contract actions

Accepted transactions are stored in the mempool with `receivedAt` and source metadata.

### Step 3: block production

When a block is produced:

- the proposer is selected by stake weight
- up to `maxTransactionsPerBlock` transactions are pulled from the mempool
- valid transactions are executed in order
- rejected transactions are returned in the block production summary

### Step 4: post-block maintenance

After transaction execution, the node processes:

- matured undelegation withdrawals
- governance proposal finalization
- treasury vesting releases
- reward distribution

### Step 5: commit and persist

The block is hashed, appended to chain, written to persistence, and optionally broadcast to peers.

## Proof of Stake and Finality

### Validator selection

AfroChain selects proposers from active validators using weighted selection:

- only `active` validators participate
- weight is `totalStake`
- seed is derived from previous block hash and next height

### Finality

Finality is currently depth-based rather than separate BFT voting.

- a block is considered finalized once it is at least `finalityDepth` blocks behind the tip
- the node exposes `finalizedHeight`, `finalizedTipHash`, and `remainingToFinality`

This is simple, explicit, and good for devnet tooling, though it is not yet a separate production-grade finality gadget.

## Staking and Rewards

Staking rules are implemented in `packages/protocol/src/staking.js`.

Supported actions:

- `register_validator`
- `delegate`
- `undelegate`
- `claim_rewards`

### Reward flow

On each committed block:

- part of transaction fees is burned
- part is sent to the mobile relayer subsidy pool
- base reward is paid from treasury
- the combined reward pool is split between proposer and delegators
- proposer commission is applied before the remainder is shared

This design keeps incentives visible and easy to reason about while reinforcing AfroChain's low-fee mobile focus.

## Governance

Governance logic lives in `packages/protocol/src/governance.js`.

### Proposal categories

- `protocol`
- `treasury`
- `informational`

### Proposal requirements

- only stakers can create proposals
- title and summary are required
- proposal deposit is debited at creation time

### Voting

- only stakers can vote
- choices are `for`, `against`, and `abstain`
- voting power equals currently staked amount
- duplicate votes are rejected
- voting must happen inside the proposal window

### Finalization

At finalization time:

- quorum is computed from total active stake and `quorumRate`
- proposals pass when quorum is met and `for` exceeds `against`
- passed protocol changes update mutable parameters
- passed treasury proposals execute grants and vesting schedules
- failed execution marks the proposal as `execution_failed`

## Treasury and Vesting

AfroChain treats treasury operations as first-class protocol behavior rather than an external afterthought.

### Treasury grants

Treasury proposals can create:

- immediate grant disbursements
- vested grants released over future blocks

### Vesting schedules

Each vesting schedule tracks:

- source account
- recipient
- amount
- amount released so far
- cliff blocks
- vesting duration
- start and end height
- last release height
- linked proposal ID

Funds for vested grants move into `treasuryVestingEscrow` at approval time, then stream out as blocks advance.

### Treasury events

The node records treasury events for:

- grant disbursement
- vesting schedule creation
- vesting release

These events feed:

- `/treasury`
- `/activity`
- account activity feeds
- explorer and dashboard displays

## Native Contract Layer

Contract logic lives in `packages/protocol/src/contracts/templates.js`.

This is not yet a generic bytecode VM. Instead, AfroChain uses native templates that are intentionally easier to inspect and extend during the current phase.

### System contracts

- `afc_contract_afrocoin`
  AFC system token contract.
- `afc_contract_governance`
  Governance system contract exposing parameter and proposal views.

### User-deployable templates

- `savings_circle`
  Rotating savings and payout primitive.
- `merchant_escrow`
  Buyer-merchant escrow flow.

### Contract execution model

- deploy and call gas are estimated by template
- fee estimates combine `baseFee` plus `gasUsed * contractGasPrice`
- transactions fail if `gasLimit` is lower than required gas
- receipts include gas usage and minimum fee

### Contract reads

Contracts can expose read behavior through `GET /contracts/:address/read`.

Examples:

- AfroCoin `balanceOf`
- AfroCoin `allowance`
- AfroCoin `stats`
- governance parameter and proposal views
- full contract state when no specialized view is present

## Persistence Model

Persistence is intentionally layered:

### JSON snapshot

- portable
- easy to inspect
- good for backups and imports
- used by save/export/import flows

### SQLite snapshot history

- stores recent snapshots
- stores recent sync runs
- used for richer operator recovery and status visibility

### Freshest snapshot restore

When a node boots from disk, it chooses the freshest available snapshot based on:

1. highest block height
2. newest export timestamp if heights tie

## Peer Sync

Peer sync lives in `packages/protocol/src/peer-sync.js`.

The flow is:

1. fetch `/health` from each peer
2. import discovered peers from `/peers`
3. if the peer is ahead, fetch missing blocks with `/blocks/:height`
4. optionally import remote mempool items from `/mempool`
5. record sync summary locally

This is enough to support devnet follower nodes, validator catch-up, and operational demos.

## API Layer

The HTTP API in `packages/protocol/src/api.js` is the stable interface between the protocol and everything outside it.

It exposes:

- chain status
- metrics and analytics
- staking and validators
- governance and treasury
- contracts and contract templates
- transactions, simulation, and estimation
- blocks, finality, and activity feeds
- peers, snapshots, and manual sync operations

The API is intentionally broad because the wallet, explorer, dashboard, mobile shell, SDK, and CLI all depend on it directly.

## Product Surfaces

### Web wallet

Uses the SDK and node API for:

- wallet generation
- payments
- payment simulation
- staking
- proposal publishing and voting
- treasury grants with vesting
- contract deployment and contract calls

### Explorer

Uses read endpoints for:

- chain inspection
- search
- mempool visibility
- treasury analytics
- finality
- validator visibility
- activity feeds

### Dashboard

Uses analytics-oriented reads for:

- protocol framing
- treasury summaries
- governance summaries
- validator and contract overviews

### Mobile shell

Uses direct API calls for:

- watch-mode account lookup
- faucet onboarding
- corridor visibility
- node persistence visibility

## Current Limitations

AfroChain is credible as a reference chain, but there are still clear limits:

- native contract templates are not yet a general-purpose VM
- peer sync is not yet a full gossip network
- finality is depth-based rather than separate validator attestations
- mobile shell is watch-first and not yet a hardened signing wallet
- persistence focuses on local operator workflows, not large-scale distributed storage

Those limitations are deliberate and documented so contributors can build on the system with realistic expectations.
