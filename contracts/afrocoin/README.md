# AfroCoin Solidity Contract

`AfroCoin.sol` is the Solidity reference artifact for AFC. It sits alongside the native AfroChain implementation so teams that need EVM-style integration patterns can work with a familiar contract surface.

This directory is the future extraction boundary for `afrocoin-token`.

## Important Context

On AfroChain itself, AFC is the native asset managed by the protocol state machine.

That means:

- balances, rewards, treasury accounts, and protocol fees are enforced natively in `packages/protocol`
- the chain also exposes a predeployed native AfroCoin system contract template for ERC20-like flows inside the reference runtime
- `AfroCoin.sol` is a parallel Solidity artifact for compatibility-minded tooling, testing, and future EVM-oriented integrations

So this contract is important, but it is not the source of truth for the current native chain runtime.

## Contract Overview

The contract defines:

- `name = AfroCoin`
- `symbol = AFC`
- `decimals = 6`

Core storage:

- `totalSupply`
- `owner`
- `governanceDAO`
- `stakingModule`
- `balanceOf`
- `allowance`
- `minters`

## Constructor

```solidity
constructor(address treasury, uint256 initialSupply)
```

At deployment:

- `owner` is set to `msg.sender`
- `governanceDAO` is initialized to `msg.sender`
- the deployer is added as a minter
- the full initial supply is minted to the provided treasury address

## Token Functions

### `transfer(address to, uint256 value)`

Standard token transfer from caller to recipient.

### `approve(address spender, uint256 value)`

Sets allowance for a spender.

### `transferFrom(address from, address to, uint256 value)`

Uses allowance and transfers on behalf of `from`.

### `transferAcrossCorridor(address to, uint256 value, string originCountry, string destinationCountry, string rail)`

Performs a transfer and emits a corridor-specific event for cross-border analytics.

This is one of the most AfroChain-specific parts of the Solidity contract because it carries:

- origin country
- destination country
- settlement rail

## Administrative Functions

### `mint(address to, uint256 value)`

Restricted to active minters.

### `setMinter(address account, bool enabled)`

Owner-only minter management.

### `setGovernanceDAO(address dao)`

Owner-only governance DAO pointer update.

### `setStakingModule(address module)`

Owner-only staking module pointer update.

### `transferOwnership(address nextOwner)`

Owner-only ownership transfer with zero-address protection.

## Events

The contract emits:

- `Transfer`
- `Approval`
- `CorridorPayment`
- `MinterUpdated`
- `GovernanceDAOUpdated`
- `StakingModuleUpdated`

### Why `CorridorPayment` Matters

`CorridorPayment` is a useful bridge between token semantics and AfroChain's payments narrative.

It captures:

- sender
- recipient
- amount
- origin country
- destination country
- rail

That makes it easier for indexers or partner tooling to attach payment context to token transfers.

## Relationship to the Native AfroChain Contract Template

The native chain template in `packages/protocol/src/contracts/templates.js` exposes similar AFC-style methods:

- `approve`
- `transfer`
- `transferFrom`

It also uses AfroChain-native balances and corridor metrics.

The Solidity contract and the native template are aligned conceptually, but they are not the same execution environment.

## What This Directory Should Hold Over Time

As the project matures, this boundary is the natural place for:

- token contract revisions
- treasury-related Solidity artifacts
- staking reward Solidity artifacts if EVM compatibility expands
- governance bridge contracts
- deployment notes and tokenomics references

## Current Limitations

- this contract is not currently the runtime authority for AfroChain native balances
- there is no full EVM chain or EVM execution layer in the current reference implementation
- emission logic and treasury economics are still primarily governed by the native protocol state, not by this Solidity contract

That limitation is intentional and documented so contributors do not confuse compatibility artifacts with live chain authority.
