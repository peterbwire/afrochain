# AfroChain SDK

`@afrochain/sdk` is the developer-facing JavaScript SDK for AfroChain. It is designed to stay small, application-agnostic, and easy to extract later into the future `afrochain-sdk` repository.

## What the SDK Includes

- API client helpers through `AfroChainClient`
- wallet generation
- unsigned transaction creation
- transaction signing
- AFC unit conversion helpers
- address derivation and encoding helpers

The SDK deliberately does not include UI code, React hooks, or app-specific state management. That keeps it useful across web apps, scripts, CLIs, and future mobile signing layers.

## Package Exports

`src/index.js` exports:

- `AfroChainClient`
- `AFC_DECIMALS`
- `AFC_UNIT`
- `bufferToBase64`
- `deriveAddress`
- `formatUnits`
- `parseUnits`
- `buildSignableTransaction`
- `createUnsignedTransaction`
- `createWallet`
- `signTransaction`

## Runtime Requirements

The SDK depends on Web Crypto for key generation and signing.

That means:

- browsers work well
- modern Node.js runtimes work when `globalThis.crypto.subtle` is available
- environments without Web Crypto will fail when wallet generation or signing is attempted

## Core Helpers

### `createWallet(label?)`

Creates a new ECDSA P-256 wallet and returns:

- `address`
- `label`
- `createdAt`
- `publicKey`
- `privateKey`

Example:

```js
import { createWallet } from '@afrochain/sdk';

const wallet = await createWallet('Treasury multisig operator');
```

### `createUnsignedTransaction(config)`

Builds a normalized unsigned transaction shape with:

- `sender`
- `publicKey`
- `nonce`
- `fee`
- `type`
- `payload`
- `timestamp`

This is useful when you want to inspect or persist an unsigned transaction before signing.

### `signTransaction(unsignedTransaction, privateKey)`

Signs a transaction and returns the signed form with:

- `signature`
- generated transaction `id`

### `buildSignableTransaction(transaction)`

Returns the canonical signable subset of a transaction. This is mainly useful for debugging or custom signing flows.

### Unit helpers

- `formatUnits(baseUnits)`
  Converts base units into AFC.
- `parseUnits(afcValue)`
  Converts AFC into base units.

Example:

```js
import { formatUnits, parseUnits } from '@afrochain/sdk';

const amount = parseUnits('25');
console.log(formatUnits(amount));
```

### Address helpers

- `deriveAddress(publicKey)`
  Creates the `afc_` address from a base64 public key.
- `bufferToBase64(buffer)`
  Utility for encoding key material and signatures.

## `AfroChainClient`

`AfroChainClient` is the main API wrapper.

### Constructor

```js
const client = new AfroChainClient({
  baseUrl: 'http://localhost:4100',
  operatorToken: process.env.AFC_OPERATOR_TOKEN || null
});
```

If omitted, the default base URL is `http://localhost:4100`.

The constructor also accepts a plain base URL string for read-only or unsecured local usage.

### Read methods

- `getHealth()`
- `getChain()`
- `getMetrics()`
- `getNetwork()`
- `getFinality()`
- `getDatabaseStatus()`
- `getTreasury()`
- `getFaucet()`
- `getMempool(limit?)`
- `getActivity(limit?)`
- `getCorridors(limit?)`
- `search(query)`
- `getBlocks(limit?)`
- `getTransactions(limit?)`
- `getAccount(address)`
- `getAccountActivity(address, limit?)`
- `getValidators()`
- `getStaking()`
- `getProposals()`
- `getContracts()`
- `getContractTemplates()`
- `getContractActivity(address, limit?)`
- `getPeers()`

### Operator-protected methods

- `produceBlock()`
- `requestFaucet(address, amount, options?)`
- `addPeer(peer)`
- `probePeers(options?)`
- `restorePeer(url)`
- `saveSnapshot(path?)`
- `importSnapshot(snapshot)`
- `syncNetwork(options?)`
- `gossipNetwork(options?)`
- `exportSnapshot()`

These methods send `x-afrochain-operator-token` automatically when `operatorToken` is configured on the client.

### General write methods

- `submitTransaction(transaction)`
- `simulateTransaction(transaction)`
- `estimateTransactionCost(transaction)`

### Signing conveniences

- `getNextNonce(address)`
- `signAndSubmit(wallet, transactionConfig)`
- `signAndSimulate(wallet, transactionConfig)`

These helpers are what most app code should use unless you need a custom signing pipeline.

## Typical Flow

```js
import { AfroChainClient, createWallet } from '@afrochain/sdk';

const client = new AfroChainClient({
  baseUrl: 'http://localhost:4100',
  operatorToken: process.env.AFC_OPERATOR_TOKEN || null
});
const wallet = await createWallet('Payments app wallet');

await client.requestFaucet(wallet.address, 500_000_000, {
  label: 'Payments app wallet'
});

const estimate = await client.estimateTransactionCost({
  sender: wallet.address,
  type: 'payment',
  payload: {
    recipient: 'afc_settlement_hub',
    amount: 25_000_000,
    originCountry: 'Kenya',
    destinationCountry: 'Nigeria',
    mobileMoneyProvider: 'M-Pesa',
    reference: 'School fees'
  }
});

const result = await client.signAndSubmit(wallet, {
  type: 'payment',
  fee: estimate.minimumFee,
  payload: {
    recipient: 'afc_settlement_hub',
    amount: 25_000_000,
    originCountry: 'Kenya',
    destinationCountry: 'Nigeria',
    mobileMoneyProvider: 'M-Pesa',
    reference: 'School fees'
  }
});
```

## Recommended Usage Patterns

- estimate fees before signing when exact costs matter
- simulate user actions before submit when the UI needs projected balances or contract outputs
- load contract templates dynamically instead of hardcoding method lists or gas assumptions
- use account activity for wallet history rather than reconstructing history manually
- treat private keys as client-only state and never send them to the node

## What the SDK Does Not Do

- it does not manage encrypted key storage
- it does not provide a React state library
- it does not wrap every possible contract read method yet
- it does not hide protocol concepts like fees, nonces, or gas from the integrator

Those omissions are intentional. The SDK aims to stay composable and transparent.

## Future Split Role

This package is one half of the future `afrochain-sdk` repository. The other half is `packages/cli`.

To keep that future split easy:

- avoid importing app code here
- keep the API client generic
- keep wallet and helper functions framework-independent
