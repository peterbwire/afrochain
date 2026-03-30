# AfroChain Wallet

This app is the main web wallet for AfroChain. It is a Vite + React application that sits on top of `@afrochain/sdk` and the public node API.

This app is part of the future `afrochain-wallet` repository boundary together with the mobile wallet shell.

## What the Wallet Does Today

The current wallet is more than a simple send-and-receive screen. It supports:

- browser wallet generation and local persistence
- AFC payments
- payment simulation before submission
- validator registration and delegation flows
- undelegation and reward claiming flows
- governance proposal creation
- governance voting
- treasury grant proposal creation
- multi-grant treasury proposals
- vesting-aware treasury proposals
- contract template deployment
- contract method execution
- exact fee estimation for contract actions
- account activity visibility
- validator and treasury visibility
- finality visibility

## Runtime and Configuration

The wallet connects to:

```text
import.meta.env.VITE_AFROCHAIN_API || http://localhost:4100
```

That means you can point it at a different node by providing `VITE_AFROCHAIN_API` when running or building the app.

## Local Development

From the repo root:

```bash
npm run dev:wallet
```

Or from this workspace:

```bash
npm run dev
```

Production build:

```bash
npm run build --workspace @afrochain/wallet
```

## Wallet State Model

The app stores the generated wallet locally in browser storage under:

```text
afrochain.reference.wallet
```

That stored value includes:

- address
- label
- public key
- private key
- creation time

This is convenient for local demos, but it is not a production-grade secure wallet storage model.

## Main User Flows

### 1. Bootstrap a wallet

On first load, the app generates a wallet if one is not already stored.

### 2. Fund it

The wallet can request faucet funds from the current node.

### 3. Preview and send payments

Before broadcasting a payment, the app can simulate it and show:

- projected account outcomes
- fee
- preview block height

### 4. Stake or validate

Users can:

- register a validator
- delegate to an existing validator
- undelegate
- claim staking rewards

### 5. Participate in governance

Users can:

- create protocol proposals
- create treasury proposals
- create multi-grant treasury proposals
- add vesting and cliff schedules
- vote for, against, or abstain

### 6. Deploy contracts

Users can deploy:

- `savings_circle`
- `merchant_escrow`

The wallet shows live or sample gas information derived from the node template registry.

### 7. Call contract methods

The wallet currently provides method-specific forms for AfroCoin system contract methods such as:

- `approve`
- `transfer`
- `transferFrom`

This keeps the reference wallet honest and usable without pretending to be a full no-code contract studio.

## Data Loaded by the Wallet

On refresh, the wallet reads:

- account
- account activity
- validators
- proposals
- contracts
- contract templates
- chain overview
- finality
- faucet state
- treasury analytics

This makes the app a useful operator and governance client in addition to being an end-user wallet.

## Why the Wallet Uses Template Metadata

The wallet does not hardcode contract capabilities. Instead, it reads `/contracts/templates` so it can adapt to:

- available methods
- sample deploy gas
- sample method gas

That is important for future extensibility and for keeping the UI aligned with protocol reality.

## Current Limitations

- keys are stored in browser local storage
- there is no hardware wallet support
- there is no secure enclave integration
- it assumes a trusted reference-node environment
- contract forms are template-specific rather than general ABI-driven interfaces

Those are acceptable constraints for the current reference phase.

## Future Split Role

When AfroChain moves into an organization, this app and `apps/mobile-wallet` are expected to move together into `afrochain-wallet`.

To keep that extraction clean:

- depend on `@afrochain/sdk`
- talk to the node through public APIs
- avoid importing protocol internals directly
