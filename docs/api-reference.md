# AfroChain API Reference

The AfroChain node API is the integration surface for:

- `@afrochain/sdk`
- `@afrochain/cli`
- the web wallet
- the mobile wallet shell
- the explorer
- the dashboard
- trusted peer sync flows

The API is JSON-only and currently exposes open CORS headers for local development.

## Conventions

### Base URL

Local default:

```text
http://localhost:4100
```

### Content type

Use:

```text
content-type: application/json
```

### Errors

Errors return status `400` or `404` with:

```json
{
  "error": "Human readable message"
}
```

### Units

- AFC amounts in API payloads are expressed in base units
- AFC uses `6` decimals
- `1 AFC = 1_000_000` base units

## Transaction Envelope

Signed transactions submitted to the API follow this general shape:

```json
{
  "id": "tx_...",
  "sender": "afc_...",
  "publicKey": "base64-spki",
  "signature": "base64-signature",
  "nonce": 1,
  "fee": 500,
  "type": "payment",
  "timestamp": "2026-03-15T12:00:00.000Z",
  "payload": {}
}
```

## Supported Transaction Types

### `payment`

Payload:

```json
{
  "recipient": "afc_...",
  "amount": 25000000,
  "originCountry": "Kenya",
  "destinationCountry": "Nigeria",
  "mobileMoneyProvider": "M-Pesa",
  "reference": "School fees"
}
```

### `stake`

Payload:

```json
{
  "action": "delegate",
  "validator": "afc_validator_nairobi",
  "amount": 250000000
}
```

Supported actions:

- `register_validator`
- `delegate`
- `undelegate`
- `claim_rewards`

### `proposal`

Protocol proposal payload:

```json
{
  "category": "protocol",
  "title": "Lower base fee",
  "summary": "Support mobile remittance users",
  "changes": [
    {
      "parameter": "baseFee",
      "value": 250
    }
  ]
}
```

Treasury proposal payload:

```json
{
  "category": "treasury",
  "title": "Merchant education rollout",
  "summary": "Fund local onboarding",
  "grants": [
    {
      "source": "afc_community_grants",
      "recipient": "afc_settlement_hub",
      "amount": 250000000,
      "label": "Pilot grant",
      "note": "First phase"
    },
    {
      "source": "afc_innovation_fund",
      "recipient": "afc_settlement_hub",
      "amount": 900000000,
      "label": "Regional rollout",
      "vestingBlocks": 6,
      "cliffBlocks": 2
    }
  ]
}
```

### `vote`

Payload:

```json
{
  "proposalId": "prop_...",
  "choice": "for"
}
```

Choices:

- `for`
- `against`
- `abstain`

### `contract_deploy`

Savings circle example:

```json
{
  "template": "savings_circle",
  "name": "Diaspora Circle",
  "args": {
    "contributionAmount": 100000000,
    "members": [
      "afc_member_a",
      "afc_member_b"
    ]
  },
  "gasLimit": 30000
}
```

Merchant escrow example:

```json
{
  "template": "merchant_escrow",
  "name": "Merchant Escrow",
  "args": {
    "amount": 100000000,
    "buyer": "afc_buyer",
    "merchant": "afc_merchant"
  },
  "gasLimit": 30000
}
```

### `contract_call`

AfroCoin transfer example:

```json
{
  "contract": "afc_contract_afrocoin",
  "method": "transfer",
  "gasLimit": 30000,
  "args": {
    "to": "afc_settlement_hub",
    "amount": 25000000,
    "originCountry": "Kenya",
    "destinationCountry": "Ghana",
    "mobileMoneyProvider": "M-Pesa",
    "reference": "Merchant settlement"
  }
}
```

## Health, Chain, and Network

### `GET /health`

Quick operator health view.

Returns:

- `status`
- chain height and tip hash
- active validator count
- fee parameters
- persistence mode
- total staked
- finality summary

### `GET /chain`

Returns the same overview as `/health` without the top-level `status`.

Useful fields:

- `chainId`
- `network`
- `height`
- `tipHash`
- `activeValidatorCount`
- `baseFee`
- `contractGasPrice`
- `defaultContractGasLimit`
- `finalityDepth`
- `finalizedHeight`
- `faucetBalance`
- `mobileRelayerPoolBalance`
- `persistenceMode`
- `token`

### `GET /metrics`

Returns protocol metrics and corridor analytics.

Useful fields:

- `totalBlocks`
- `totalTransactions`
- `crossBorderTransactions`
- `crossBorderVolume`
- `totalContractGasUsed`
- `totalFeesBurned`
- `treasuryGrantCount`
- `treasuryGrantVolume`
- `treasuryVestingCount`
- `treasuryVestingReleased`
- `mobileSubsidies`
- `corridors`
- `finality`
- `totalActiveStake`

### `GET /network`

Returns node topology and operator state.

Useful fields:

- `chain`
- `database`
- `lastPersistedAt`
- `lastSyncSummary`
- `mempool`
- `node`
- `peers`

### `GET /finality`

Returns:

- `finalizedHeight`
- `finalizedTipHash`
- `finalityDepth`
- `tipHeight`

### `GET /database`

Returns:

- `enabled`
- `filePath`
- `latestSnapshot`
- `latestSync`
- `snapshotCount`
- `syncRunCount`

### `POST /network/sync`

Triggers manual peer sync.

Body:

```json
{
  "mempoolLimit": 25
}
```

Returns a sync summary including:

- `status`
- `localHeight`
- `finalHeight`
- `importedBlockCount`
- `importedTransactionCount`
- `discoveredPeerCount`
- `mempoolImports`
- `peers`
- `errors`

## Blocks and Transactions

### `GET /blocks`

Query params:

- `limit`

Returns recent blocks in reverse chronological order.

Each block view includes:

- `height`
- `hash`
- `previousHash`
- `proposer`
- `timestamp`
- `stateRoot`
- `transactions`
- `confirmations`
- `finalized`
- `remainingToFinality`

### `GET /blocks/:height`

Returns a block view for the requested height or `null` if it does not exist.

### `GET /transactions`

Query params:

- `limit`

Returns committed transactions ordered by newest block first.

Each transaction view includes:

- committed transaction fields
- `blockHeight`
- `proposer`
- `result`
- `receipt`
- `status`
- `finalized`

### `GET /transactions/:id`

Returns a single committed transaction with finality status.

### `POST /transactions`

Submits a signed transaction into the mempool.

Returns:

```json
{
  "accepted": true,
  "mempoolSize": 3,
  "transaction": {}
}
```

### `POST /transactions/simulate`

Runs a signed transaction against a draft state without mutating committed chain state.

Returns:

- `accepted`
- `previewBlockHeight`
- `receipt`
- `result`
- `simulatedStateRoot`
- `accounts`

`accounts` contains updated views for related participants after the simulated execution.

### `POST /transactions/estimate`

Estimates fee and gas requirements for a transaction shape.

Input may be signed or unsigned as long as it contains enough fields to determine the execution path.

Returns:

- `baseFee`
- `contractGasPrice`
- `defaultContractGasLimit`
- `gasLimit`
- `gasPrice`
- `gasUsed`
- `minimumFee`
- `recommendedFee`
- `transaction`

### `POST /blocks/produce`

Forces immediate block production on the current node.

Returns:

- `block`
- `finalizedProposals`
- `maturedWithdrawals`
- `rejectedTransactions`
- `rewardSummary`
- `treasuryVestingReleases`

This is especially useful for demos and testing.

## Accounts, Validators, and Staking

### `GET /accounts/:address`

Returns:

- `address`
- `balance`
- `label`
- `nonce`
- `pendingWithdrawals`
- `rewards`
- `stakingPower`

### `GET /accounts/:address/activity`

Query params:

- `limit`

Returns filtered activity entries for the given account.

Activity entries can represent:

- payment transactions
- stake transactions
- governance proposal creation
- governance votes
- contract deployment and contract calls
- treasury disbursement events
- treasury vesting schedule creation
- treasury vesting releases

### `GET /validators`

Returns validators sorted by total stake.

Fields include:

- `address`
- `name`
- `region`
- `active`
- `endpoint`
- `commissionRate`
- `selfStake`
- `delegatedStake`
- `totalStake`
- `blocksProduced`
- `lastProposedHeight`
- `rewardBalance`

### `GET /staking`

Returns a staking overview:

- `minValidatorStake`
- `pendingWithdrawals`
- `rewardAccounts`
- `totalActiveStake`
- `validators`

## Governance and Contracts

### `GET /proposals`

Returns all governance proposals ordered by newest ending height first.

Proposal fields may include:

- `id`
- `category`
- `title`
- `summary`
- `status`
- `proposer`
- `deposit`
- `startHeight`
- `endHeight`
- `votes`
- `ballots`
- `grantCount`
- `grantVolume`
- `immediateGrantVolume`
- `vestedGrantVolume`
- `vestingGrantCount`
- `grantDisbursements`
- `grantSchedules`
- `appliedChanges`
- `executionError`
- `quorumNeeded`

### `GET /contracts`

Returns a summarized view of deployed contracts.

Fields include:

- `address`
- `name`
- `owner`
- `template`
- `balance`

For the AfroCoin system contract, the response also includes:

- `allowanceExposure`

### `GET /contracts/templates`

Returns the template registry used for UI and CLI tooling.

Each entry includes:

- `id`
- `label`
- `description`
- `methods`
- `sampleDeployGas`
- `sampleMethodGas`

### `GET /contracts/:address`

Returns the full deployed contract plus current balance, or `null` if missing.

### `GET /contracts/:address/activity`

Query params:

- `limit`

Returns activity entries where `contractAddress` equals the given contract.

### `GET /contracts/:address/read`

Read-only contract call surface.

Query params:

- `method`
- `args`

`args` should be JSON-encoded in the query string.

Examples:

```text
GET /contracts/afc_contract_afrocoin/read?method=stats
GET /contracts/afc_contract_afrocoin/read?method=balanceOf&args={"address":"afc_validator_nairobi"}
```

Supported read behavior today:

- AfroCoin:
  - `balanceOf`
  - `allowance`
  - `stats`
- governance system contract:
  - parameter and proposal views
- default contract state for templates without a specialized view

## Treasury, Faucet, Activity, and Search

### `GET /treasury`

Returns treasury analytics and treasury-related operator views.

Useful fields:

- `faucet`
- `pendingWithdrawalTotal`
- `pendingTreasuryGrantCount`
- `pendingTreasuryGrantTotal`
- `pendingTreasuryGrants`
- `recentTreasuryProposals`
- `recentTreasuryEvents`
- `recentVestingReleases`
- `proposalSummary`
- `rewardLiabilities`
- `topTreasuryAccounts`
- `treasuryGrantCount`
- `treasuryGrantVolume`
- `treasuryVestingCount`
- `treasuryVestingEscrowBalance`
- `treasuryVestingReleased`
- `treasuryVestingVolume`
- `treasuryShareOfSupply`
- `validatorConcentration`

### `GET /faucet`

Returns:

- `address`
- `cooldownMs`
- `maxAmount`
- `recentDisbursements`
- `remainingBalance`

### `POST /faucet`

Requests faucet funds.

Body:

```json
{
  "address": "afc_demo_wallet",
  "amount": 500000000,
  "label": "Demo wallet",
  "note": "Developer faucet",
  "region": "Kenya"
}
```

Returns:

- `address`
- `amount`
- `remainingBalance`
- `timestamp`

### `GET /mempool`

Query params:

- `limit`

Returns:

- `stats`
- `transactions`

`stats` includes:

- `pendingByType`
- `pendingFees`
- `size`

### `GET /activity`

Query params:

- `limit`

Returns a mixed activity feed across transactions and treasury events.

Activity entry fields include:

- `id`
- `type`
- `summary`
- `sender`
- `participants`
- `amount`
- `fee`
- `gasUsed`
- `corridor`
- `contractAddress`
- `blockHeight`
- `timestamp`
- `status`
- `finalized`
- `txId`

### `GET /corridors`

Query params:

- `limit`

Returns corridor rankings with:

- `name`
- `transactions`
- `volume`
- `mobileMoneyVolume`
- `shareOfCrossBorderVolume`

### `GET /search`

Query params:

- `q`

Returns grouped results:

- `accounts`
- `contracts`
- `proposals`
- `transactions`
- `validators`

Search matches across address, label, name, template, region, proposal title, proposal summary, and transaction fields.

## Peers and Snapshots

### `GET /peers`

Returns the peer directory.

Each peer entry includes:

- `url`
- `label`
- `region`
- `status`
- `addedAt`
- `lastSeenAt`

### `POST /peers`

Registers a peer.

Body:

```json
{
  "url": "http://localhost:4200",
  "label": "Lagos validator",
  "region": "Nigeria"
}
```

Returns:

- `added`
- `peers`

### `GET /snapshots/export`

Returns the full current snapshot object.

### `POST /snapshots/save`

Saves a snapshot to disk.

Body:

```json
{
  "path": "snapshots/devnet.json"
}
```

Returns:

```json
{
  "savedTo": "snapshots/devnet.json"
}
```

### `POST /snapshots/import`

Imports a snapshot object directly into the node.

Returns:

- `height`
- `hash`
- `importedAt`

## Peer Sync Routes

These routes are used for trusted node-to-node coordination in the current prototype.

### `POST /sync/transactions`

Submits a transaction into the mempool without rebroadcasting it as a normal client transaction.

### `POST /sync/blocks`

Attempts to accept a remote block into the local chain.

The node verifies:

- height extends the local chain
- previous hash matches the local tip
- proposer matches PoS selection
- block hash is valid
- resulting state root matches local execution

## Notes for Integrators

- Use `/transactions/estimate` before signing when you want an exact fee.
- Use `/transactions/simulate` when building wallets that show projected balances.
- Use `/finality` and the `finalized` flag on blocks and transactions when UI needs stronger confirmation semantics.
- Use `/contracts/templates` to drive forms dynamically instead of hardcoding gas assumptions.
- Use `/treasury` rather than manually deriving treasury state from individual accounts when building governance or operator dashboards.
- Use `/network` and `/database` for operator-facing tooling instead of stitching together multiple ad hoc queries.
