import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createTransactionId, deriveAddress, serializeTransaction } from '../crypto.js';
import { createApiServer } from '../api.js';
import { AfroChainNode } from '../node.js';
import { createSocketTransport } from '../socket-transport.js';
import { AFC_UNIT } from '../utils.js';

function createTestWallet(label = 'Test Wallet') {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: {
      format: 'der',
      type: 'pkcs8'
    },
    publicKeyEncoding: {
      format: 'der',
      type: 'spki'
    }
  });
  const encodedPublicKey = Buffer.from(publicKey).toString('base64');

  return {
    address: deriveAddress(encodedPublicKey),
    label,
    privateKey,
    publicKey: encodedPublicKey
  };
}

function signTransaction(wallet, config) {
  const transaction = {
    fee: Number(config.fee || 500),
    nonce: Number(config.nonce),
    payload: config.payload || {},
    publicKey: wallet.publicKey,
    sender: wallet.address,
    timestamp: config.timestamp || new Date().toISOString(),
    type: config.type
  };
  const signature = sign(
    'sha256',
    Buffer.from(serializeTransaction(transaction)),
    {
      key: wallet.privateKey,
      format: 'der',
      type: 'pkcs8'
    }
  );

  transaction.signature = signature.toString('base64');
  transaction.id = createTransactionId(transaction);
  return transaction;
}

function estimateFee(node, wallet, config) {
  return node.estimateTransactionCost({
    ...config,
    sender: wallet.address
  }).minimumFee;
}

async function closeApiServer(api) {
  await new Promise((resolve, reject) => {
    api.server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function waitFor(assertion, timeoutMs = 3000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion();
      return;
    } catch (_error) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  await assertion();
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    method: 'POST'
  });
  const payload = await response.json();

  return {
    payload,
    response
  };
}

async function withMockedDateSequence(startTimestampMs, stepMs, callback) {
  const RealDate = globalThis.Date;
  let callCount = 0;

  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length) {
        super(...args);
        return;
      }

      super(startTimestampMs + callCount * stepMs);
      callCount += 1;
    }

    static now() {
      const value = startTimestampMs + callCount * stepMs;
      callCount += 1;
      return value;
    }
  }

  MockDate.parse = RealDate.parse;
  MockDate.UTC = RealDate.UTC;
  globalThis.Date = MockDate;

  try {
    return await callback();
  } finally {
    globalThis.Date = RealDate;
  }
}

test('AfroChain processes a signed cross-border AfroCoin payment', async () => {
  const node = new AfroChainNode();
  const sender = createTestWallet('Sender');
  const recipient = createTestWallet('Recipient');

  node.state.balances[sender.address] = 1_000 * AFC_UNIT;
  node.state.nonces[sender.address] = 0;

  const transaction = signTransaction(sender, {
    nonce: 1,
    payload: {
      amount: 50 * AFC_UNIT,
      destinationCountry: 'Nigeria',
      mobileMoneyProvider: 'M-Pesa',
      originCountry: 'Kenya',
      recipient: recipient.address,
      reference: 'Family support'
    },
    type: 'payment'
  });

  await node.submitTransaction(transaction, { broadcast: false });
  await node.produceBlock({ broadcast: false, force: true });

  assert.equal(node.getAccount(recipient.address).balance, 50 * AFC_UNIT);
  assert.equal(node.state.metrics.crossBorderTransactions, 1);
  assert.equal(node.state.transactions[transaction.id].status, 'confirmed');
});

test('AfroChain supports validator onboarding and DAO parameter updates', async () => {
  const node = new AfroChainNode();
  const validator = createTestWallet('Validator');

  node.state.balances[validator.address] = 600_000 * AFC_UNIT;
  node.state.nonces[validator.address] = 0;
  node.state.params.governanceVotingWindow = 1;
  node.state.params.quorumRate = 0;

  const registerValidatorTransaction = signTransaction(validator, {
    nonce: 1,
    payload: {
      action: 'register_validator',
      amount: 300_000 * AFC_UNIT,
      commissionRate: 0.08,
      endpoint: 'https://validator-community.afrochain.local',
      name: 'Community Validator',
      region: 'Ghana'
    },
    type: 'stake'
  });

  await node.submitTransaction(registerValidatorTransaction, { broadcast: false });
  await node.produceBlock({ broadcast: false, force: true });

  const proposalTransaction = signTransaction(validator, {
    nonce: 2,
    payload: {
      changes: [
        {
          parameter: 'baseFee',
          value: 250
        }
      ],
      summary: 'Keep base fees low for remittances and merchant micro-payments.',
      title: 'Lower base fee'
    },
    type: 'proposal'
  });

  await node.submitTransaction(proposalTransaction, { broadcast: false });
  await node.produceBlock({ broadcast: false, force: true });

  const proposalId = Object.keys(node.state.proposals)[0];
  const voteTransaction = signTransaction(validator, {
    nonce: 3,
    payload: {
      choice: 'for',
      proposalId
    },
    type: 'vote'
  });

  await node.submitTransaction(voteTransaction, { broadcast: false });
  await node.produceBlock({ broadcast: false, force: true });
  await node.produceBlock({ broadcast: false, force: true });

  assert.equal(node.state.proposals[proposalId].status, 'passed');
  assert.equal(node.state.params.baseFee, 250);
  assert.equal(node.state.validators[validator.address].active, true);
});

test('AfroChain deploys and executes a savings circle smart contract', async () => {
  const node = new AfroChainNode();
  const owner = createTestWallet('Owner');
  const member = createTestWallet('Member');

  node.state.balances[owner.address] = 2_000 * AFC_UNIT;
  node.state.balances[member.address] = 500 * AFC_UNIT;
  node.state.nonces[owner.address] = 0;
  node.state.nonces[member.address] = 0;

  const deployConfig = {
    payload: {
      args: {
        contributionAmount: 10 * AFC_UNIT,
        members: [owner.address]
      },
      name: 'Diaspora Savings Circle',
      template: 'savings_circle'
    },
    type: 'contract_deploy'
  };
  const deployTransaction = signTransaction(owner, {
    ...deployConfig,
    fee: estimateFee(node, owner, deployConfig),
    nonce: 1
  });

  await node.submitTransaction(deployTransaction, { broadcast: false });
  await node.produceBlock({ broadcast: false, force: true });

  const contractAddress = node.getContracts().find((contract) => contract.name === 'Diaspora Savings Circle').address;

  const joinConfig = {
    payload: {
      args: {},
      contract: contractAddress,
      method: 'join'
    },
    type: 'contract_call'
  };
  const joinTransaction = signTransaction(member, {
    ...joinConfig,
    fee: estimateFee(node, member, joinConfig),
    nonce: 1
  });

  await node.submitTransaction(joinTransaction, { broadcast: false });
  await node.produceBlock({ broadcast: false, force: true });

  const contributeConfig = {
    payload: {
      args: {},
      contract: contractAddress,
      method: 'contribute'
    },
    type: 'contract_call'
  };
  const contributeTransaction = signTransaction(owner, {
    ...contributeConfig,
    fee: estimateFee(node, owner, contributeConfig),
    nonce: 2
  });

  await node.submitTransaction(contributeTransaction, { broadcast: false });
  await node.produceBlock({ broadcast: false, force: true });

  assert.equal(node.getContract(contractAddress).balance, 10 * AFC_UNIT);
  assert.equal(node.readContract(contractAddress).state.members.includes(member.address), true);
  assert.equal(node.getTransaction(deployTransaction.id).receipt.gasUsed > 0, true);
  assert.equal(node.getTransaction(joinTransaction.id).receipt.minimumFee, joinTransaction.fee);
  assert.equal(node.getTransaction(contributeTransaction.id).receipt.gasUsed > 0, true);
});

test('AfroChain executes AfroCoin contract methods with method arguments', async () => {
  const node = new AfroChainNode();
  const sender = createTestWallet('AfroCoin Sender');
  const recipient = createTestWallet('AfroCoin Recipient');

  node.state.balances[sender.address] = 600 * AFC_UNIT;
  node.state.nonces[sender.address] = 0;

  const transferConfig = {
    payload: {
      args: {
        amount: 30 * AFC_UNIT,
        destinationCountry: 'Ghana',
        mobileMoneyProvider: 'MTN MoMo',
        originCountry: 'Kenya',
        reference: 'Contract corridor payment',
        to: recipient.address
      },
      contract: 'afc_contract_afrocoin',
      method: 'transfer'
    },
    type: 'contract_call'
  };
  const transferTransaction = signTransaction(sender, {
    ...transferConfig,
    fee: estimateFee(node, sender, transferConfig),
    nonce: 1
  });

  await node.submitTransaction(transferTransaction, { broadcast: false });
  await node.produceBlock({ broadcast: false, force: true });

  const receipt = node.getTransaction(transferTransaction.id).receipt;

  assert.equal(node.getAccount(recipient.address).balance, 30 * AFC_UNIT);
  assert.equal(receipt.gasUsed > 0, true);
  assert.equal(receipt.minimumFee, transferTransaction.fee);
});

test('AfroChain executes multi-grant treasury proposals with vesting and finality progress', async () => {
  const node = new AfroChainNode();
  const validator = createTestWallet('Validator');
  const immediateGrantee = createTestWallet('Immediate Grant Recipient');
  const vestedGrantee = createTestWallet('Vested Grant Recipient');

  node.state.balances[validator.address] = 700_000 * AFC_UNIT;
  node.state.nonces[validator.address] = 0;
  node.state.params.governanceVotingWindow = 1;
  node.state.params.quorumRate = 0;

  const registerValidatorTransaction = signTransaction(validator, {
    nonce: 1,
    payload: {
      action: 'register_validator',
      amount: 350_000 * AFC_UNIT,
      commissionRate: 0.05,
      endpoint: 'https://validator-grants.afrochain.local',
      name: 'Grant Validator',
      region: 'Kenya'
    },
    type: 'stake'
  });

  await node.submitTransaction(registerValidatorTransaction, { broadcast: false });
  await node.produceBlock({ broadcast: false, force: true });

  const immediateGrantAmount = 1_250 * AFC_UNIT;
  const vestedGrantAmount = 2_400 * AFC_UNIT;
  const treasuryProposalTransaction = signTransaction(validator, {
    nonce: 2,
    payload: {
      category: 'treasury',
      grants: [
        {
          amount: immediateGrantAmount,
          label: 'Builder Cooperative',
          note: 'Prototype support for local payment rails.',
          recipient: immediateGrantee.address,
          source: 'afc_community_grants'
        },
        {
          amount: vestedGrantAmount,
          cliffBlocks: 1,
          label: 'Merchant Education Guild',
          note: 'Gradual rollout grant for regional merchant training.',
          recipient: vestedGrantee.address,
          source: 'afc_innovation_fund',
          vestingBlocks: 3
        }
      ],
      summary: 'Fund a local builder cooperative working on merchant acceptance.',
      title: 'Community builder grant'
    },
    type: 'proposal'
  });

  await node.submitTransaction(treasuryProposalTransaction, { broadcast: false });
  await node.produceBlock({ broadcast: false, force: true });

  const proposalId = Object.keys(node.state.proposals)[0];
  const voteTransaction = signTransaction(validator, {
    nonce: 3,
    payload: {
      choice: 'for',
      proposalId
    },
    type: 'vote'
  });

  await node.submitTransaction(voteTransaction, { broadcast: false });
  await node.produceBlock({ broadcast: false, force: true });
  await node.produceBlock({ broadcast: false, force: true });
  await node.produceBlock({ broadcast: false, force: true });
  await node.produceBlock({ broadcast: false, force: true });
  await node.produceBlock({ broadcast: false, force: true });
  await node.produceBlock({ broadcast: false, force: true });

  const proposal = node.state.proposals[proposalId];
  const treasury = node.getTreasuryAnalytics();
  const finality = node.getFinalityOverview();
  const finalizedBlock = node.getBlock(6);
  const vestedActivity = node.getAccountActivity(vestedGrantee.address, 10);
  const vestingReleaseEntries = vestedActivity.filter((entry) => entry.type === 'treasury_vesting_release');

  assert.equal(proposal.status, 'passed');
  assert.equal(proposal.grantDisbursements.length, 1);
  assert.equal(proposal.grantSchedules.length, 1);
  assert.equal(node.getAccount(immediateGrantee.address).balance, immediateGrantAmount);
  assert.equal(node.getAccount(vestedGrantee.address).balance, vestedGrantAmount);
  assert.equal(treasury.pendingTreasuryGrantCount, 0);
  assert.equal(treasury.treasuryGrantCount >= 4, true);
  assert.equal(treasury.treasuryGrantVolume >= immediateGrantAmount + vestedGrantAmount, true);
  assert.equal(treasury.treasuryVestingCount >= 1, true);
  assert.equal(treasury.treasuryVestingReleased, vestedGrantAmount);
  assert.equal(finality.finalizedHeight >= 6, true);
  assert.equal(finalizedBlock.finalized, true);
  assert.equal(node.getTransaction(treasuryProposalTransaction.id).finalized, true);
  assert.equal(vestingReleaseEntries.length, 3);
});

test('AfroChain simulates transactions without mutating committed state', async () => {
  const node = new AfroChainNode();
  const sender = createTestWallet('Simulation Sender');
  const recipient = createTestWallet('Simulation Recipient');

  node.state.balances[sender.address] = 200 * AFC_UNIT;
  node.state.nonces[sender.address] = 0;

  const transaction = signTransaction(sender, {
    nonce: 1,
    payload: {
      amount: 25 * AFC_UNIT,
      destinationCountry: 'Uganda',
      originCountry: 'Kenya',
      recipient: recipient.address
    },
    type: 'payment'
  });

  const preview = node.simulateTransaction(transaction);

  assert.equal(preview.accounts.find((account) => account.address === recipient.address).balance, 25 * AFC_UNIT);
  assert.equal(node.getAccount(recipient.address).balance, 0);
  assert.equal(node.getTransactions().length, 0);
});

test('AfroChain faucet and snapshot persistence survive a round trip', async () => {
  const sandboxDir = await mkdtemp(join(tmpdir(), 'afrochain-'));
  const snapshotPath = join(sandboxDir, 'snapshot.json');
  const node = await AfroChainNode.createFromDisk({
    snapshotPath
  });
  const recipient = createTestWallet('Faucet Recipient');

  const faucetRequest = await node.requestFaucet(recipient.address, 500 * AFC_UNIT, {
    label: recipient.label,
    note: 'Bootstrap test'
  });
  await node.saveSnapshot();

  const restoredNode = await AfroChainNode.createFromDisk({
    snapshotPath
  });

  assert.equal(faucetRequest.status, 'confirmed');
  assert.equal(faucetRequest.blockHeight, 1);
  assert.equal(restoredNode.getAccount(recipient.address).balance, 500 * AFC_UNIT);
  assert.equal(restoredNode.getFaucetOverview().recentDisbursements[0].note, 'Bootstrap test');

  await rm(sandboxDir, { force: true, recursive: true });
});

test('AfroChain rejects underfunded sequential mempool transactions before block production', async () => {
  const node = new AfroChainNode();
  const sender = createTestWallet('Sequential Sender');
  const recipient = createTestWallet('Sequential Recipient');

  node.state.balances[sender.address] = 120 * AFC_UNIT;
  node.state.nonces[sender.address] = 0;

  const firstPayment = signTransaction(sender, {
    nonce: 1,
    payload: {
      amount: 100 * AFC_UNIT,
      destinationCountry: 'Uganda',
      originCountry: 'Kenya',
      recipient: recipient.address,
      reference: 'First queued payment'
    },
    type: 'payment'
  });
  const secondPayment = signTransaction(sender, {
    nonce: 2,
    payload: {
      amount: 25 * AFC_UNIT,
      destinationCountry: 'Uganda',
      originCountry: 'Kenya',
      recipient: recipient.address,
      reference: 'Second queued payment'
    },
    type: 'payment'
  });

  await node.submitTransaction(firstPayment, { broadcast: false });

  await assert.rejects(
    node.submitTransaction(secondPayment, { broadcast: false }),
    /Insufficient AFC balance/
  );

  assert.equal(node.getMempoolStats().size, 1);
  assert.equal(node.getMempoolStats().rejectionCount, 1);
  assert.equal(node.getMempoolStats().recentRejections[0].txId, secondPayment.id);
});

test('AfroChain protects operator routes and rejects relayed system faucet transactions from peers', async () => {
  const operatorToken = 'operator-test-token';
  const peerToken = 'peer-test-token';
  const node = new AfroChainNode({
    operatorToken,
    peerToken
  });
  const recipient = createTestWallet('Protected Faucet Recipient');
  const api = createApiServer(node);
  const binding = await api.listen(0, '127.0.0.1');
  const baseUrl = `http://${binding.host}:${binding.port}`;

  try {
    const unauthenticatedFaucet = await postJson(`${baseUrl}/faucet`, {
      address: recipient.address,
      amount: 50 * AFC_UNIT
    });
    assert.equal(unauthenticatedFaucet.response.status, 401);
    assert.match(unauthenticatedFaucet.payload.error, /operator API token/);

    const authenticatedFaucet = await postJson(
      `${baseUrl}/faucet`,
      {
        address: recipient.address,
        amount: 50 * AFC_UNIT,
        label: recipient.label,
        note: 'Protected faucet request'
      },
      {
        'x-afrochain-operator-token': operatorToken
      }
    );
    assert.equal(authenticatedFaucet.response.status, 201);
    assert.equal(authenticatedFaucet.payload.status, 'confirmed');
    assert.equal(node.getAccount(recipient.address).balance, 50 * AFC_UNIT);

    const relayedFaucet = node.buildFaucetTransaction(recipient.address, 25 * AFC_UNIT, {
      label: recipient.label,
      note: 'Relayed faucet attack'
    });
    const unauthenticatedRelay = await postJson(`${baseUrl}/sync/transactions`, {
      relay: {
        ttl: 1
      },
      transaction: relayedFaucet
    });
    assert.equal(unauthenticatedRelay.response.status, 401);
    assert.match(unauthenticatedRelay.payload.error, /peer API token/);

    const authenticatedRelay = await postJson(
      `${baseUrl}/sync/transactions`,
      {
        relay: {
          ttl: 1
        },
        transaction: relayedFaucet
      },
      {
        'x-afrochain-peer-token': peerToken
      }
    );
    assert.equal(authenticatedRelay.response.status, 400);
    assert.match(authenticatedRelay.payload.error, /trusted node workflows/);
    assert.equal(node.getAccount(recipient.address).balance, 50 * AFC_UNIT);
  } finally {
    await closeApiServer(api);
  }
});

test('AfroChain indexes activity, corridors, and search results', async () => {
  const node = new AfroChainNode();
  const sender = createTestWallet('Market Sender');
  const recipient = createTestWallet('Market Recipient');

  node.state.balances[sender.address] = 800 * AFC_UNIT;
  node.state.nonces[sender.address] = 0;
  node.state.addressBook[sender.address] = {
    label: 'Accra Merchant',
    region: 'Ghana',
    type: 'wallet'
  };

  const payment = signTransaction(sender, {
    nonce: 1,
    payload: {
      amount: 75 * AFC_UNIT,
      destinationCountry: 'Nigeria',
      mobileMoneyProvider: 'MTN MoMo',
      originCountry: 'Ghana',
      recipient: recipient.address,
      reference: 'Cross-border goods'
    },
    type: 'payment'
  });

  await node.submitTransaction(payment, { broadcast: false });
  await node.produceBlock({ broadcast: false, force: true });

  assert.equal(node.getAccountActivity(sender.address, 5).length, 1);
  assert.equal(node.getAccountActivity(recipient.address, 5).length, 1);
  assert.equal(node.getCorridors(1)[0].name, 'Ghana -> Nigeria');
  assert.equal(node.search('accra').results.accounts[0].label, 'Accra Merchant');
});

test('AfroChain uses one canonical timestamp for proposal finalization side effects and block metadata', async () => {
  const node = new AfroChainNode();
  const validator = createTestWallet('Timestamp Validator');
  const grantee = createTestWallet('Timestamp Grantee');

  node.state.balances[validator.address] = 700_000 * AFC_UNIT;
  node.state.nonces[validator.address] = 0;
  node.state.params.governanceVotingWindow = 1;
  node.state.params.quorumRate = 0;

  const registerValidatorTransaction = signTransaction(validator, {
    nonce: 1,
    payload: {
      action: 'register_validator',
      amount: 350_000 * AFC_UNIT,
      commissionRate: 0.05,
      endpoint: 'https://validator-timestamp.afrochain.local',
      name: 'Timestamp Validator',
      region: 'Kenya'
    },
    type: 'stake'
  });

  await node.submitTransaction(registerValidatorTransaction, { broadcast: false });
  await node.produceBlock({ broadcast: false, force: true });

  const treasuryProposalTransaction = signTransaction(validator, {
    nonce: 2,
    payload: {
      category: 'treasury',
      grants: [
        {
          amount: 500 * AFC_UNIT,
          label: 'Timestamp Grant',
          note: 'Ensure finalized proposal timestamps stay deterministic.',
          recipient: grantee.address,
          source: 'afc_community_grants'
        }
      ],
      summary: 'Verify canonical timestamps during proposal execution.',
      title: 'Canonical timestamp proposal'
    },
    type: 'proposal'
  });

  await node.submitTransaction(treasuryProposalTransaction, { broadcast: false });
  await node.produceBlock({ broadcast: false, force: true });

  const proposalId = Object.keys(node.state.proposals)[0];
  const voteTransaction = signTransaction(validator, {
    nonce: 3,
    payload: {
      choice: 'for',
      proposalId
    },
    type: 'vote'
  });

  await node.submitTransaction(voteTransaction, { broadcast: false });
  await node.produceBlock({ broadcast: false, force: true });

  await withMockedDateSequence(Date.parse('2026-03-30T12:00:00.000Z'), 1_000, async () => {
    await node.produceBlock({ broadcast: false, force: true });
  });

  const proposal = node.state.proposals[proposalId];
  const finalizationBlock = node.getBlock(4);

  assert.equal(proposal.status, 'passed');
  assert.equal(proposal.grantDisbursements[0].executedAt, finalizationBlock.timestamp);
});

test('AfroChain restores state from SQLite persistence', async () => {
  const sandboxDir = await mkdtemp(join(tmpdir(), 'afrochain-db-'));
  const databasePath = join(sandboxDir, 'state.sqlite');
  const node = await AfroChainNode.createFromDisk({
    databasePath
  });
  const recipient = createTestWallet('SQLite Recipient');

  await node.requestFaucet(recipient.address, 250 * AFC_UNIT, {
    label: recipient.label,
    note: 'SQLite bootstrap'
  });
  await node.saveSnapshot();

  const restoredNode = await AfroChainNode.createFromDisk({
    databasePath
  });

  assert.equal(restoredNode.getAccount(recipient.address).balance, 250 * AFC_UNIT);
  assert.equal(restoredNode.getDatabaseStatus().enabled, true);
  assert.equal(restoredNode.getDatabaseStatus().snapshotCount >= 1, true);

  restoredNode.database?.close();
  node.database?.close();
  await rm(sandboxDir, { force: true, recursive: true });
});

test('AfroChain synchronizes follower nodes from peers', async () => {
  const sandboxDir = await mkdtemp(join(tmpdir(), 'afrochain-sync-'));
  const leader = await AfroChainNode.createFromDisk({
    databasePath: join(sandboxDir, 'leader.sqlite'),
    snapshotPath: join(sandboxDir, 'leader.json')
  });
  const follower = await AfroChainNode.createFromDisk({
    databasePath: join(sandboxDir, 'follower.sqlite'),
    snapshotPath: join(sandboxDir, 'follower.json')
  });
  const sender = createTestWallet('Leader Sender');
  const recipient = createTestWallet('Follower Recipient');
  const faucetRecipient = createTestWallet('Follower Faucet Recipient');
  const api = createApiServer(leader);
  const binding = await api.listen(0, '127.0.0.1');

  leader.state.balances[sender.address] = 500 * AFC_UNIT;
  leader.state.nonces[sender.address] = 0;
  follower.state.balances[sender.address] = 500 * AFC_UNIT;
  follower.state.nonces[sender.address] = 0;

  const payment = signTransaction(sender, {
    nonce: 1,
    payload: {
      amount: 40 * AFC_UNIT,
      destinationCountry: 'Rwanda',
      originCountry: 'Kenya',
      recipient: recipient.address,
      reference: 'Peer sync settlement'
    },
    type: 'payment'
  });

  await leader.submitTransaction(payment, { broadcast: false });
  await leader.produceBlock({ broadcast: false, force: true });
  await leader.requestFaucet(faucetRecipient.address, 125 * AFC_UNIT, {
    label: faucetRecipient.label,
    note: 'Peer faucet bootstrap'
  });

  follower.addPeer(
    {
      label: 'Leader',
      region: 'Kenya',
      url: `http://${binding.host}:${binding.port}`
    },
    {
      persist: false
    }
  );

  const summary = await follower.syncWithPeers({
    mempoolLimit: 0
  });

  assert.equal(summary.importedBlockCount, 2);
  assert.equal(follower.getTip().height, leader.getTip().height);
  assert.equal(follower.getAccount(recipient.address).balance, 40 * AFC_UNIT);
  assert.equal(follower.getAccount(faucetRecipient.address).balance, 125 * AFC_UNIT);
  assert.equal(follower.getFaucetOverview().recentDisbursements[0].note, 'Peer faucet bootstrap');
  assert.equal(follower.getDatabaseStatus().latestSync.peerCount, 1);

  await closeApiServer(api);
  leader.database?.close();
  follower.database?.close();
  await rm(sandboxDir, { force: true, recursive: true });
});

test('AfroChain gossips transactions across relay peers and scores peer delivery', async () => {
  const peerToken = 'relay-peer-token';
  const origin = new AfroChainNode({
    peerToken
  });
  const relay = new AfroChainNode({
    peerToken
  });
  const leaf = new AfroChainNode({
    peerToken
  });
  const sender = createTestWallet('Gossip Sender');
  const recipient = createTestWallet('Gossip Recipient');
  const relayApi = createApiServer(relay);
  const leafApi = createApiServer(leaf);
  const relayBinding = await relayApi.listen(0, '127.0.0.1');
  const leafBinding = await leafApi.listen(0, '127.0.0.1');
  const relayUrl = `http://${relayBinding.host}:${relayBinding.port}`;
  const leafUrl = `http://${leafBinding.host}:${leafBinding.port}`;

  relay.nodeMetadata.publicUrl = relayUrl;
  leaf.nodeMetadata.publicUrl = leafUrl;

  origin.addPeer({ label: 'Relay', region: 'Kenya', url: relayUrl }, { persist: false });
  relay.addPeer({ label: 'Leaf', region: 'Ghana', url: leafUrl }, { persist: false });

  for (const node of [origin, relay, leaf]) {
    node.state.balances[sender.address] = 500 * AFC_UNIT;
    node.state.nonces[sender.address] = 0;
  }

  const payment = signTransaction(sender, {
    nonce: 1,
    payload: {
      amount: 45 * AFC_UNIT,
      destinationCountry: 'Ghana',
      mobileMoneyProvider: 'MTN MoMo',
      originCountry: 'Kenya',
      recipient: recipient.address,
      reference: 'Relay gossip payment'
    },
    type: 'payment'
  });

  await origin.submitTransaction(payment);

  assert.equal(relay.hasTransaction(payment.id), true);
  assert.equal(leaf.hasTransaction(payment.id), true);
  assert.equal(origin.getPeers().find((peer) => peer.url === relayUrl).score > 0, true);
  assert.equal(relay.getPeers().find((peer) => peer.url === leafUrl).score > 0, true);

  await closeApiServer(relayApi);
  await closeApiServer(leafApi);
});

test('AfroChain quarantines unhealthy peers, restores them manually, and keeps healthy peers preferred', async () => {
  const leader = new AfroChainNode();
  const follower = new AfroChainNode();
  const api = createApiServer(leader);
  const binding = await api.listen(0, '127.0.0.1');
  const leaderUrl = `http://${binding.host}:${binding.port}`;
  const failedPeerUrl = 'http://127.0.0.1:9';

  follower.addPeer({ label: 'Healthy Leader', region: 'Kenya', url: leaderUrl }, { persist: false });
  follower.addPeer({ label: 'Offline Peer', region: 'Unknown', url: failedPeerUrl }, { persist: false });

  await follower.probePeers({
    includeQuarantined: true
  });
  await follower.probePeers({
    includeQuarantined: true
  });
  const summary = await follower.probePeers({
    includeQuarantined: true
  });
  const topology = follower.getNetworkTopology();
  const healthyPeer = follower.getPeer(leaderUrl);
  const failedPeer = follower.getPeer(failedPeerUrl);

  assert.equal(summary.healthy, 1);
  assert.equal(healthyPeer.score > failedPeer.score, true);
  assert.equal(failedPeer.status, 'quarantined');
  assert.equal(failedPeer.broadcastEligible, false);
  assert.equal(Boolean(failedPeer.lastError), true);
  assert.equal(topology.peerSummary.quarantinedCount >= 1, true);

  const restoredPeer = follower.restorePeer(failedPeerUrl, {
    persist: false
  });

  assert.equal(restoredPeer.status, 'registered');
  assert.equal(restoredPeer.broadcastEligible, true);

  await closeApiServer(api);
});

test('AfroChain relays signed transactions across authenticated socket peers', async () => {
  const origin = new AfroChainNode({
    label: 'Origin'
  });
  const relay = new AfroChainNode({
    label: 'Relay'
  });
  const leaf = new AfroChainNode({
    label: 'Leaf'
  });
  const sender = createTestWallet('Socket Sender');
  const recipient = createTestWallet('Socket Recipient');
  const sharedSecret = 'afrochain-socket-secret';
  const originTransport = await createSocketTransport(origin, {
    host: '127.0.0.1',
    port: 0,
    sharedSecret
  });
  const relayTransport = await createSocketTransport(relay, {
    host: '127.0.0.1',
    port: 0,
    sharedSecret
  });
  const leafTransport = await createSocketTransport(leaf, {
    host: '127.0.0.1',
    port: 0,
    sharedSecret
  });
  try {
    relay.addPeer({ transport: 'socket', url: leafTransport.publicUrl }, { persist: false });
    origin.addPeer({ transport: 'socket', url: relayTransport.publicUrl }, { persist: false });
    await relayTransport.connectToPeer(leafTransport.publicUrl);
    await originTransport.connectToPeer(relayTransport.publicUrl);

    for (const node of [origin, relay, leaf]) {
      node.state.balances[sender.address] = 500 * AFC_UNIT;
      node.state.nonces[sender.address] = 0;
    }

    const payment = signTransaction(sender, {
      nonce: 1,
      payload: {
        amount: 32 * AFC_UNIT,
        destinationCountry: 'Uganda',
        originCountry: 'Kenya',
        recipient: recipient.address,
        reference: 'Socket relay payment'
      },
      type: 'payment'
    });

    await origin.submitTransaction(payment, {
      ttl: 3
    });

    await waitFor(() => {
      assert.equal(relay.hasTransaction(payment.id), true);
      assert.equal(leaf.hasTransaction(payment.id), true);
    });

    assert.equal(origin.getPeersByTransport('socket').length >= 1, true);
    assert.equal(leaf.getMempoolStats().size, 1);
  } finally {
    await originTransport.stop();
    await relayTransport.stop();
    await leafTransport.stop();
  }
});

test('AfroChain rejects socket peers with the wrong transport secret', async () => {
  const leader = new AfroChainNode({
    label: 'Leader'
  });
  const intruder = new AfroChainNode({
    label: 'Intruder'
  });
  const leaderTransport = await createSocketTransport(leader, {
    host: '127.0.0.1',
    port: 0,
    sharedSecret: 'leader-secret'
  });
  const intruderTransport = await createSocketTransport(intruder, {
    host: '127.0.0.1',
    port: 0,
    sharedSecret: 'wrong-secret'
  });
  try {
    await assert.rejects(
      intruderTransport.connectToPeer(leaderTransport.publicUrl),
      /shared transport secret|closed before handshake completed/
    );
    assert.equal(leader.getPeersByTransport('socket').some((peer) => peer.url === intruderTransport.publicUrl), false);
  } finally {
    await leaderTransport.stop();
    await intruderTransport.stop();
  }
});
