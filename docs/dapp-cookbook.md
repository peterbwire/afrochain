# AfroChain dApp Cookbook

This guide shows the main integration flows for applications building on AfroChain today.

All examples assume:

- a local node at `http://localhost:4100`
- the SDK package `@afrochain/sdk`
- AFC values converted to base units when sent to the API

## 1. Connect to a Node

```js
import { AfroChainClient } from '@afrochain/sdk';

const client = new AfroChainClient('http://localhost:4100');
```

You can switch to any compatible node URL later without changing the rest of the app flow.

## 2. Create a Wallet

```js
import { createWallet } from '@afrochain/sdk';

const wallet = await createWallet('AfroChain Demo Wallet');

console.log(wallet.address);
```

The wallet object includes:

- `address`
- `label`
- `createdAt`
- `publicKey`
- `privateKey`

The SDK uses Web Crypto, so browser environments work well. In Node.js, you need a runtime with `globalThis.crypto.subtle`.

## 3. Inspect Chain State Before Acting

Before sending transactions, many apps should load:

```js
const [chain, finality, faucet, validators] = await Promise.all([
  client.getChain(),
  client.getFinality(),
  client.getFaucet(),
  client.getValidators()
]);
```

This is useful for:

- displaying fee parameters
- showing validator choices
- showing faucet availability
- understanding confirmation depth

## 4. Fund a Wallet Through the Faucet

```js
await client.requestFaucet(wallet.address, 500_000_000, {
  label: 'Developer wallet',
  note: 'Hackathon bootstrap',
  region: 'Kenya'
});
```

After funding, refresh the account:

```js
const account = await client.getAccount(wallet.address);
console.log(account.balance);
```

## 5. Estimate a Payment Fee Before Signing

Fee estimation is the safest way to build wallets and dApps because it keeps the UI aligned with current protocol parameters.

```js
const paymentShape = {
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
};

const paymentEstimate = await client.estimateTransactionCost(paymentShape);
console.log(paymentEstimate.minimumFee);
```

## 6. Simulate a Payment

Simulation is ideal when you want to show a preview without mutating chain state.

```js
const preview = await client.signAndSimulate(wallet, {
  type: 'payment',
  fee: paymentEstimate.minimumFee,
  payload: paymentShape.payload
});

console.log(preview.receipt);
console.log(preview.accounts);
```

Useful simulation outputs:

- `receipt`
- `result`
- `accounts`
- `simulatedStateRoot`
- `previewBlockHeight`

## 7. Submit the Payment

```js
const paymentResult = await client.signAndSubmit(wallet, {
  type: 'payment',
  fee: paymentEstimate.minimumFee,
  payload: paymentShape.payload
});

console.log(paymentResult.transaction.id);
```

After the next block, inspect the committed result:

```js
const txList = await client.getTransactions(10);
console.log(txList[0]);
```

## 8. Read Account Activity

The indexed activity feed is often more useful for wallet UIs than raw transaction lists.

```js
const activity = await client.getAccountActivity(wallet.address, 10);
console.log(activity);
```

Activity entries may include:

- payments
- stake actions
- proposal creation
- votes
- contract calls
- treasury vesting releases

## 9. Delegate Stake

```js
const stakeEstimate = await client.estimateTransactionCost({
  sender: wallet.address,
  type: 'stake',
  payload: {
    action: 'delegate',
    validator: 'afc_validator_nairobi',
    amount: 250_000_000
  }
});

await client.signAndSubmit(wallet, {
  type: 'stake',
  fee: stakeEstimate.minimumFee,
  payload: {
    action: 'delegate',
    validator: 'afc_validator_nairobi',
    amount: 250_000_000
  }
});
```

For validator onboarding, use `action: register_validator` and include:

- `amount`
- `name`
- `region`
- `commissionRate`
- `endpoint`

## 10. Create a Protocol Proposal

Only stakers can create proposals.

```js
const protocolProposal = {
  type: 'proposal',
  payload: {
    category: 'protocol',
    title: 'Lower base transaction fee',
    summary: 'Support smaller cross-border payments and mobile wallets.',
    changes: [
      {
        parameter: 'baseFee',
        value: 250
      }
    ]
  }
};

const proposalEstimate = await client.estimateTransactionCost({
  sender: wallet.address,
  ...protocolProposal
});

await client.signAndSubmit(wallet, {
  ...protocolProposal,
  fee: proposalEstimate.minimumFee
});
```

## 11. Vote on a Proposal

```js
const proposals = await client.getProposals();
const targetProposal = proposals[0];

await client.signAndSubmit(wallet, {
  type: 'vote',
  fee: 500,
  payload: {
    proposalId: targetProposal.id,
    choice: 'for'
  }
});
```

If your UI wants tighter alignment with fee policy, estimate the vote fee the same way as any other transaction.

## 12. Create a Treasury Proposal With Vesting

```js
const treasuryProposal = {
  type: 'proposal',
  payload: {
    category: 'treasury',
    title: 'Merchant education rollout',
    summary: 'Fund merchant education with one immediate grant and one vested grant.',
    grants: [
      {
        source: 'afc_community_grants',
        recipient: 'afc_settlement_hub',
        amount: 250_000_000,
        label: 'Pilot grant',
        note: 'Initial outreach'
      },
      {
        source: 'afc_innovation_fund',
        recipient: 'afc_settlement_hub',
        amount: 900_000_000,
        label: 'Regional rollout grant',
        vestingBlocks: 6,
        cliffBlocks: 2
      }
    ]
  }
};

const treasuryEstimate = await client.estimateTransactionCost({
  sender: wallet.address,
  ...treasuryProposal
});

await client.signAndSubmit(wallet, {
  ...treasuryProposal,
  fee: treasuryEstimate.minimumFee
});
```

Later, track treasury execution through:

```js
const treasury = await client.getTreasury();
console.log(treasury.pendingTreasuryGrants);
console.log(treasury.recentVestingReleases);
```

## 13. Discover Contract Templates

Build your contract forms from the template registry instead of hardcoding methods or sample gas.

```js
const templates = await client.getContractTemplates();
console.log(templates);
```

Each template includes:

- `id`
- `label`
- `description`
- `methods`
- `sampleDeployGas`
- `sampleMethodGas`

## 14. Deploy a Savings Circle Contract

```js
const deployShape = {
  sender: wallet.address,
  type: 'contract_deploy',
  payload: {
    template: 'savings_circle',
    name: 'Diaspora Circle',
    args: {
      contributionAmount: 100_000_000,
      members: [wallet.address]
    },
    gasLimit: 30_000
  }
};

const deployEstimate = await client.estimateTransactionCost(deployShape);

await client.signAndSubmit(wallet, {
  type: 'contract_deploy',
  fee: deployEstimate.minimumFee,
  payload: deployShape.payload
});
```

After deployment:

```js
const contracts = await client.getContracts();
const latestContract = contracts[0];
console.log(latestContract.address);
```

## 15. Estimate a Contract Call With Real Arguments

```js
const callEstimate = await client.estimateTransactionCost({
  sender: wallet.address,
  type: 'contract_call',
  payload: {
    contract: 'afc_contract_afrocoin',
    method: 'transfer',
    gasLimit: 30_000,
    args: {
      to: 'afc_settlement_hub',
      amount: 25_000_000,
      originCountry: 'Kenya',
      destinationCountry: 'Ghana',
      mobileMoneyProvider: 'M-Pesa',
      reference: 'Merchant settlement'
    }
  }
});
```

## 16. Call AfroCoin Methods

### Approve

```js
await client.signAndSubmit(wallet, {
  type: 'contract_call',
  fee: 500,
  payload: {
    contract: 'afc_contract_afrocoin',
    method: 'approve',
    gasLimit: 30_000,
    args: {
      spender: 'afc_settlement_hub',
      amount: 50_000_000
    }
  }
});
```

### Transfer

```js
await client.signAndSubmit(wallet, {
  type: 'contract_call',
  fee: callEstimate.minimumFee,
  payload: {
    contract: 'afc_contract_afrocoin',
    method: 'transfer',
    gasLimit: 30_000,
    args: {
      to: 'afc_settlement_hub',
      amount: 25_000_000,
      originCountry: 'Kenya',
      destinationCountry: 'Ghana',
      mobileMoneyProvider: 'M-Pesa',
      reference: 'Merchant settlement'
    }
  }
});
```

### Transfer from allowance

```js
await client.signAndSubmit(wallet, {
  type: 'contract_call',
  fee: 500,
  payload: {
    contract: 'afc_contract_afrocoin',
    method: 'transferFrom',
    gasLimit: 30_000,
    args: {
      from: wallet.address,
      to: 'afc_settlement_hub',
      amount: 10_000_000,
      originCountry: 'Kenya',
      destinationCountry: 'Nigeria',
      mobileMoneyProvider: 'M-Pesa',
      reference: 'Allowance settlement'
    }
  }
});
```

## 17. Read Contract State

The SDK client does not currently wrap contract reads directly, but they are simple over HTTP.

Example using `fetch`:

```js
const response = await fetch(
  'http://localhost:4100/contracts/afc_contract_afrocoin/read?method=stats'
);
const afrocoinStats = await response.json();
console.log(afrocoinStats);
```

Example with encoded args:

```js
const args = encodeURIComponent(JSON.stringify({ address: wallet.address }));
const response = await fetch(
  `http://localhost:4100/contracts/afc_contract_afrocoin/read?method=balanceOf&args=${args}`
);
const balanceView = await response.json();
console.log(balanceView);
```

## 18. Use Search and Global Activity

Explorer-style search:

```js
const search = await client.search('nairobi');
console.log(search.results.validators);
console.log(search.results.accounts);
```

Global activity:

```js
const feed = await client.getActivity(20);
console.log(feed);
```

Corridor analytics:

```js
const corridors = await client.getCorridors(10);
console.log(corridors);
```

## 19. Use Operator Data in Admin Apps

For admin, explorer, or validator tooling:

```js
const [network, database, mempool] = await Promise.all([
  client.getNetwork(),
  client.getDatabaseStatus(),
  client.getMempool(25)
]);
```

This makes it easy to surface:

- peer topology
- last sync status
- snapshot status
- mempool pressure
- node metadata

## 20. CLI Equivalents

The CLI mirrors the most important SDK flows:

```bash
npm run cli -- wallet:create --out demo-wallet.json
npm run cli -- faucet --address afc_... --amount 500
npm run cli -- payment --wallet demo-wallet.json --to afc_settlement_hub --amount 25 --simulate
npm run cli -- proposal:protocol --wallet demo-wallet.json --title "Lower gas" --summary "Keep costs low" --parameter contractGasPrice --value 4
npm run cli -- contract:call --wallet demo-wallet.json --contract afc_contract_afrocoin --method transfer --to afc_settlement_hub --amount 25 --simulate
npm run cli -- proposal:treasury --wallet demo-wallet.json --title "Grant" --summary "Pilot rollout" --grant-recipient afc_settlement_hub --grant-amount 250
npm run cli -- activity --address afc_settlement_hub
npm run cli -- database:status
```

## 21. Best Practices

- always estimate fees before signing when the user cares about exact cost
- use simulation for payment and contract previews
- prefer the contract template registry over hardcoded gas assumptions
- show finality information in UX for higher-confidence confirmations
- use account activity feeds for wallet history
- use treasury analytics rather than hand-rolling treasury calculations in the frontend
- keep wallet private keys local to the client and never send them to the node
