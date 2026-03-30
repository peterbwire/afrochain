# AfroChain CLI

`@afrochain/cli` is the command-line interface for AfroChain operators, developers, and governance participants. It is layered on top of `@afrochain/sdk` and the public node API.

This package is part of the future `afrochain-sdk` repository boundary.

## Why the CLI Exists

The CLI gives the repo a scriptable interface for:

- wallet generation
- faucet requests
- payments
- staking and validator actions
- governance proposals
- contract deployment and contract calls
- finality and search queries
- activity inspection
- snapshot save, export, and import
- database status and manual peer sync

It is especially useful for demos, CI-style operator flows, and documentation examples.

## Running the CLI

From the repo root:

```bash
npm run cli -- help
```

The executable exposed by the package itself is:

```text
afrochain-cli
```

Operator-protected commands currently include `faucet`, `network:sync`, `snapshot:save`, `snapshot:export`, and `snapshot:import`.

Those commands can authenticate in either of these ways:

- `--operator-token <token>`
- `AFC_OPERATOR_TOKEN=<token>`

## Wallet File Format

Many commands use a wallet JSON file produced by `wallet:create`. That file contains:

- `address`
- `label`
- `createdAt`
- `publicKey`
- `privateKey`

Amounts passed to high-level amount flags such as `--amount` are usually interpreted in whole AFC and converted to base units internally through `parseUnits()`.

## Command Reference

### `wallet:create`

Create a new wallet file.

```bash
npm run cli -- wallet:create --out wallet.json --label "My Wallet"
```

Flags:

- `--out`
- `--label`

### `faucet`

Request devnet faucet funds.

```bash
npm run cli -- faucet --address afc_... --amount 500 --label "Demo wallet"
```

Flags:

- `--address` required
- `--amount`
- `--label`
- `--note`
- `--api`
- `--operator-token`

### `payment`

Submit or simulate an AFC payment.

```bash
npm run cli -- payment --wallet wallet.json --to afc_settlement_hub --amount 25 --origin Kenya --destination Nigeria --rail M-Pesa --simulate
```

Flags:

- `--wallet` required
- `--to` required
- `--amount`
- `--origin`
- `--destination`
- `--rail`
- `--reference`
- `--fee`
- `--simulate`
- `--api`

### `stake`

Run a staking action.

```bash
npm run cli -- stake --wallet wallet.json --action delegate --validator afc_validator_nairobi --amount 250
```

Supported actions:

- `register_validator`
- `delegate`
- `undelegate`
- `claim_rewards`

Flags:

- `--wallet` required
- `--action` required
- `--validator`
- `--amount`
- `--commission`
- `--endpoint`
- `--name`
- `--region`
- `--fee`
- `--api`

### `proposal:protocol`

Create or simulate a protocol governance proposal.

```bash
npm run cli -- proposal:protocol --wallet wallet.json --title "Lower base fee" --summary "Keep remittances cheap" --parameter baseFee --value 250
```

Flags:

- `--wallet` required
- `--title` required
- `--summary` required
- `--parameter`
- `--value`
- `--changes-file`
- `--fee`
- `--simulate`
- `--api`

You can submit multiple parameter changes through `--changes-file`, which should contain an array of `{ parameter, value }` objects.

### `proposal:treasury`

Create or simulate a treasury governance proposal.

```bash
npm run cli -- proposal:treasury --wallet wallet.json --title "Pilot grant" --summary "Fund local rollout" --grant-recipient afc_settlement_hub --grant-amount 250
```

Flags:

- `--wallet` required
- `--title` required
- `--summary` required
- `--grant-recipient`
- `--grant-amount`
- `--grant-source`
- `--grant-label`
- `--grant-note`
- `--grant-vesting-blocks`
- `--grant-cliff-blocks`
- `--grants-file`
- `--fee`
- `--simulate`
- `--api`

`--grants-file` should contain an array of grant objects. String amounts are converted from AFC into base units.

### `contract:deploy`

Deploy a native contract template.

```bash
npm run cli -- contract:deploy --wallet wallet.json --template savings_circle --name "Diaspora Circle" --amount 100
```

Flags:

- `--wallet` required
- `--template` required
- `--name`
- `--amount`
- `--counterparty`
- `--fee`
- `--api`

Template behavior:

- `savings_circle`
  Uses `--amount` as contribution amount and seeds the caller as a member.
- `merchant_escrow`
  Uses `--amount` plus `--counterparty` as merchant.

### `contract:call`

Call or simulate a contract method.

```bash
npm run cli -- contract:call --wallet wallet.json --contract afc_contract_afrocoin --method transfer --to afc_settlement_hub --amount 25 --simulate
```

Flags:

- `--wallet` required
- `--contract` required
- `--method` required
- `--gas-limit`
- `--amount`
- `--to`
- `--from`
- `--spender`
- `--origin`
- `--destination`
- `--rail`
- `--reference`
- `--args-json`
- `--args-file`
- `--fee`
- `--simulate`
- `--api`

If `--args-file` or `--args-json` is provided, that payload wins over the built-in argument builder.

### `contracts:templates`

List the current contract templates exposed by the node.

```bash
npm run cli -- contracts:templates
```

### `finality`

Read finality information.

```bash
npm run cli -- finality
```

### `search`

Search accounts, validators, proposals, transactions, and contracts.

```bash
npm run cli -- search --query nairobi
```

### `activity`

Read indexed account activity.

```bash
npm run cli -- activity --address afc_settlement_hub --limit 20
```

### `database:status`

Read node persistence state.

```bash
npm run cli -- database:status
```

### `network:sync`

Trigger manual peer synchronization.

```bash
npm run cli -- network:sync --mempool-limit 25
```

Requires operator auth.

### `snapshot:save`

Ask the node to save its current snapshot to a path.

```bash
npm run cli -- snapshot:save --path snapshots/devnet.json
```

Requires operator auth.

### `snapshot:export`

Export the node snapshot, optionally writing it to disk locally.

```bash
npm run cli -- snapshot:export --out snapshots/exported.json
```

Requires operator auth.

### `snapshot:import`

Import a snapshot file into the node after local validation.

```bash
npm run cli -- snapshot:import --file snapshots/devnet.json
```

Requires operator auth.

The CLI validates that the snapshot includes:

- `chain`
- `state`
- `state.balances`
- `state.nonces`

## Fee Behavior

If you do not pass `--fee`, the CLI asks the node for an estimate first and uses `minimumFee`.

That keeps the CLI aligned with:

- current `baseFee`
- contract gas pricing
- gas limits
- governance parameter changes

## Default API URL

Unless overridden with `--api`, the CLI uses:

```text
http://localhost:4100
```

## Practical Examples

Create a wallet, fund it, pay, and inspect activity:

```bash
npm run cli -- wallet:create --out demo-wallet.json
AFC_OPERATOR_TOKEN=dev-operator-token npm run cli -- faucet --address afc_... --amount 500
npm run cli -- payment --wallet demo-wallet.json --to afc_settlement_hub --amount 25
npm run cli -- activity --address afc_settlement_hub
```

Validator-focused flow:

```bash
npm run cli -- stake --wallet validator.json --action register_validator --amount 300000 --name "Accra Edge" --region Ghana
npm run cli -- stake --wallet validator.json --action delegate --validator afc_validator_nairobi --amount 1000
npm run cli -- finality
```

Governance flow:

```bash
npm run cli -- proposal:protocol --wallet gov.json --title "Lower gas" --summary "Keep fees low" --parameter contractGasPrice --value 4
npm run cli -- proposal:treasury --wallet gov.json --title "Grant" --summary "Pilot rollout" --grant-recipient afc_settlement_hub --grant-amount 250 --grant-vesting-blocks 6
```

## Design Boundary

The CLI should remain:

- API-driven
- SDK-backed
- app-independent

To keep future extraction easy, avoid importing app code or protocol internals directly. The CLI is meant to be a thin, explicit layer over the node API and SDK utilities.
