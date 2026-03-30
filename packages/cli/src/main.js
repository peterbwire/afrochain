#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { AfroChainClient, createWallet, parseUnits } from '@afrochain/sdk';

const WHOLE_NUMBER_PARAMETERS = new Set([
  'baseFee',
  'contractGasPrice',
  'defaultContractGasLimit',
  'finalityDepth',
  'governanceVotingWindow',
  'maxTransactionsPerBlock',
  'targetBlockTimeMs',
  'unbondingPeriodBlocks'
]);
const TOKEN_AMOUNT_PARAMETERS = new Set([
  'blockReward',
  'contractDeploymentBond',
  'minValidatorStake',
  'proposalDeposit'
]);
const DECIMAL_PARAMETERS = new Set(['quorumRate']);

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const flags = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const nextValue = rest[index + 1];
    if (!nextValue || nextValue.startsWith('--')) {
      flags[key] = true;
      continue;
    }

    flags[key] = nextValue;
    index += 1;
  }

  return {
    command,
    flags
  };
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function getClient(flags) {
  return new AfroChainClient({
    baseUrl: flags.api || 'http://localhost:4100',
    operatorToken: flags['operator-token'] || process.env.AFC_OPERATOR_TOKEN || null,
    peerToken: flags['peer-token'] || process.env.AFC_PEER_TOKEN || null
  });
}

async function loadWallet(filePath) {
  const raw = await readFile(resolve(filePath), 'utf8');
  return JSON.parse(raw);
}

async function saveWallet(filePath, wallet) {
  await writeFile(resolve(filePath), JSON.stringify(wallet, null, 2), 'utf8');
}

async function loadJsonFile(filePath) {
  const raw = await readFile(resolve(filePath), 'utf8');
  return JSON.parse(raw);
}

function requireFlag(flags, name) {
  if (!flags[name]) {
    throw new Error(`Missing required flag --${name}`);
  }

  return flags[name];
}

function getAmountFlag(flags, name, defaultValue = null) {
  const raw = flags[name] ?? defaultValue;
  if (raw === null || raw === undefined) {
    return null;
  }

  return parseUnits(raw);
}

function getWholeNumberFlag(flags, name, defaultValue = 0) {
  const normalized = Number(flags[name] ?? defaultValue);

  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`Flag --${name} must be a whole number greater than or equal to zero.`);
  }

  return normalized;
}

function parseWholeNumberValue(value, label) {
  const normalized = Number(value);

  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`${label} must be a whole number greater than or equal to zero.`);
  }

  return normalized;
}

function parseDecimalValue(value, label) {
  const normalized = Number(value);

  if (!Number.isFinite(normalized)) {
    throw new Error(`${label} must be a valid number.`);
  }

  return normalized;
}

function parseGovernanceChange(change) {
  if (!change?.parameter) {
    throw new Error('Each protocol governance change must include a parameter.');
  }

  if (change.value === undefined || change.value === null || change.value === '') {
    throw new Error(`Governance change ${change.parameter} is missing a value.`);
  }

  let value;
  if (TOKEN_AMOUNT_PARAMETERS.has(change.parameter)) {
    value = typeof change.value === 'string' ? parseUnits(change.value) : Number(change.value);
  } else if (WHOLE_NUMBER_PARAMETERS.has(change.parameter)) {
    value = parseWholeNumberValue(change.value, `Governance parameter ${change.parameter}`);
  } else if (DECIMAL_PARAMETERS.has(change.parameter)) {
    value = parseDecimalValue(change.value, `Governance parameter ${change.parameter}`);
  } else {
    value = parseDecimalValue(change.value, `Governance parameter ${change.parameter}`);
  }

  return {
    parameter: change.parameter,
    value
  };
}

async function buildProtocolProposalChanges(flags) {
  if (flags['changes-file']) {
    const changes = await loadJsonFile(flags['changes-file']);
    if (!Array.isArray(changes) || !changes.length) {
      throw new Error('Protocol proposal changes file must contain a non-empty array.');
    }

    return changes.map((change) => parseGovernanceChange(change));
  }

  return [
    parseGovernanceChange({
      parameter: requireFlag(flags, 'parameter'),
      value: requireFlag(flags, 'value')
    })
  ];
}

function validateSnapshotShape(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Snapshot import requires a JSON object.');
  }

  if (!Array.isArray(snapshot.chain)) {
    throw new Error('Snapshot import requires a chain array.');
  }

  if (!snapshot.state || typeof snapshot.state !== 'object') {
    throw new Error('Snapshot import requires a state object.');
  }

  if (!snapshot.state.balances || typeof snapshot.state.balances !== 'object') {
    throw new Error('Snapshot import requires state.balances.');
  }

  if (!snapshot.state.nonces || typeof snapshot.state.nonces !== 'object') {
    throw new Error('Snapshot import requires state.nonces.');
  }

  return snapshot;
}

async function buildContractCallArgs(flags, wallet) {
  if (flags['args-file']) {
    return loadJsonFile(flags['args-file']);
  }

  if (flags['args-json']) {
    return JSON.parse(flags['args-json']);
  }

  const method = requireFlag(flags, 'method');

  switch (method) {
    case 'approve':
      return {
        amount: getAmountFlag(flags, 'amount', '0'),
        spender: requireFlag(flags, 'spender')
      };
    case 'transfer':
      return {
        amount: getAmountFlag(flags, 'amount', '25'),
        destinationCountry: flags.destination || 'Nigeria',
        mobileMoneyProvider: flags.rail || 'M-Pesa',
        originCountry: flags.origin || 'Kenya',
        reference: flags.reference || 'CLI contract transfer',
        to: requireFlag(flags, 'to')
      };
    case 'transferFrom':
      return {
        amount: getAmountFlag(flags, 'amount', '25'),
        destinationCountry: flags.destination || 'Nigeria',
        from: flags.from || wallet.address,
        mobileMoneyProvider: flags.rail || 'M-Pesa',
        originCountry: flags.origin || 'Kenya',
        reference: flags.reference || 'CLI contract transferFrom',
        to: requireFlag(flags, 'to')
      };
    default:
      return {};
  }
}

async function buildTreasuryProposalGrants(flags) {
  if (flags['grants-file']) {
    const grants = await loadJsonFile(flags['grants-file']);
    if (!Array.isArray(grants) || !grants.length) {
      throw new Error('Treasury proposal grants file must contain a non-empty array.');
    }

    return grants.map((grant) => ({
      ...grant,
      amount: typeof grant.amount === 'string' ? parseUnits(grant.amount) : Number(grant.amount),
      cliffBlocks: getWholeNumberFlag(grant, 'cliffBlocks', 0),
      vestingBlocks: getWholeNumberFlag(grant, 'vestingBlocks', 0)
    }));
  }

  return [
    {
      amount: getAmountFlag(flags, 'grant-amount', '250'),
      cliffBlocks: getWholeNumberFlag(flags, 'grant-cliff-blocks', 0),
      label: flags['grant-label'] || null,
      note: flags['grant-note'] || null,
      recipient: requireFlag(flags, 'grant-recipient'),
      source: flags['grant-source'] || 'afc_community_grants',
      vestingBlocks: getWholeNumberFlag(flags, 'grant-vesting-blocks', 0)
    }
  ];
}

async function resolveTransactionFee(client, wallet, transactionConfig, flags) {
  if (flags.fee) {
    return Number(flags.fee);
  }

  const estimate = await client.estimateTransactionCost({
    ...transactionConfig,
    sender: wallet.address
  });

  return Number(estimate.minimumFee || 500);
}

async function run() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'help':
      console.log(`AfroChain CLI

Commands:
  wallet:create --out wallet.json [--label "My Wallet"]
  faucet --address afc_... [--amount 500] [--api http://localhost:4100]
  payment --wallet wallet.json --to afc_... --amount 25 [--origin Kenya] [--destination Nigeria] [--rail M-Pesa] [--reference Text] [--simulate]
  stake --wallet wallet.json --action delegate --validator afc_... [--amount 250] [--api http://localhost:4100]
  proposal:protocol --wallet wallet.json --title "Change" --summary "Why" --parameter baseFee --value 250 [--changes-file changes.json] [--simulate]
  contract:deploy --wallet wallet.json --template savings_circle --name Demo [--amount 100] [--counterparty afc_...] [--api http://localhost:4100]
  contract:call --wallet wallet.json --contract afc_contract_afrocoin --method transfer --to afc_... [--amount 25] [--simulate] [--args-json '{}'] [--api http://localhost:4100]
  proposal:treasury --wallet wallet.json --title "Grant" --summary "Why" --grant-recipient afc_... [--grant-amount 250] [--grant-source afc_community_grants] [--grant-vesting-blocks 6] [--grants-file grants.json]
  contracts:templates [--api http://localhost:4100]
  finality [--api http://localhost:4100]
  search --query kenya [--api http://localhost:4100]
  activity --address afc_... [--limit 20] [--api http://localhost:4100]
  database:status [--api http://localhost:4100]
  network:sync [--api http://localhost:4100] [--mempool-limit 25]
  snapshot:save [--path snapshot.json] [--api http://localhost:4100]
  snapshot:export [--out snapshot.json] [--api http://localhost:4100]
  snapshot:import --file snapshot.json [--api http://localhost:4100]

Operator routes:
  Use --operator-token <token> or set AFC_OPERATOR_TOKEN for faucet, block production, peer admin, network sync, and snapshots.
`);
      return;
    case 'wallet:create': {
      const wallet = await createWallet(flags.label || 'AfroChain CLI Wallet');
      if (flags.out) {
        await saveWallet(flags.out, wallet);
      }
      printJson(wallet);
      return;
    }
    case 'faucet': {
      const client = getClient(flags);
      const result = await client.requestFaucet(requireFlag(flags, 'address'), getAmountFlag(flags, 'amount', '500'), {
        label: flags.label || 'CLI wallet',
        note: flags.note || 'CLI faucet request'
      });
      printJson(result);
      return;
    }
    case 'payment': {
      const client = getClient(flags);
      const wallet = await loadWallet(requireFlag(flags, 'wallet'));
      const config = {
        payload: {
          amount: getAmountFlag(flags, 'amount', '25'),
          destinationCountry: flags.destination || 'Nigeria',
          mobileMoneyProvider: flags.rail || 'M-Pesa',
          originCountry: flags.origin || 'Kenya',
          recipient: requireFlag(flags, 'to'),
          reference: flags.reference || 'CLI payment'
        },
        type: 'payment'
      };
      const fee = await resolveTransactionFee(client, wallet, config, flags);
      const result = flags.simulate
        ? await client.signAndSimulate(wallet, { ...config, fee })
        : await client.signAndSubmit(wallet, { ...config, fee });
      printJson(result);
      return;
    }
    case 'stake': {
      const client = getClient(flags);
      const wallet = await loadWallet(requireFlag(flags, 'wallet'));
      const action = requireFlag(flags, 'action');
      const config = {
        payload: {
          action,
          amount: action === 'claim_rewards' ? 0 : getAmountFlag(flags, 'amount', '250'),
          commissionRate: Number(flags.commission || 0.08),
          endpoint: flags.endpoint || 'https://validator-community.afrochain.local',
          name: flags.name || 'CLI Validator',
          region: flags.region || 'Pan-Africa',
          validator: flags.validator || wallet.address
        },
        type: 'stake'
      };
      printJson(
        await client.signAndSubmit(wallet, {
          ...config,
          fee: await resolveTransactionFee(client, wallet, config, flags)
        })
      );
      return;
    }
    case 'proposal:protocol': {
      const client = getClient(flags);
      const wallet = await loadWallet(requireFlag(flags, 'wallet'));
      const config = {
        payload: {
          category: 'protocol',
          changes: await buildProtocolProposalChanges(flags),
          summary: requireFlag(flags, 'summary'),
          title: requireFlag(flags, 'title')
        },
        type: 'proposal'
      };
      const fee = await resolveTransactionFee(client, wallet, config, flags);
      const result = flags.simulate
        ? await client.signAndSimulate(wallet, { ...config, fee })
        : await client.signAndSubmit(wallet, { ...config, fee });
      printJson(result);
      return;
    }
    case 'contract:deploy': {
      const client = getClient(flags);
      const wallet = await loadWallet(requireFlag(flags, 'wallet'));
      const template = requireFlag(flags, 'template');
      const payload =
        template === 'merchant_escrow'
          ? {
              args: {
                amount: getAmountFlag(flags, 'amount', '100'),
                buyer: wallet.address,
                merchant: requireFlag(flags, 'counterparty')
              },
              name: flags.name || 'CLI Escrow',
              template
            }
          : {
              args: {
                contributionAmount: getAmountFlag(flags, 'amount', '100'),
                members: [wallet.address]
              },
              name: flags.name || 'CLI Savings Circle',
              template
            };
      const fee = await resolveTransactionFee(
        client,
        wallet,
        {
          payload,
          type: 'contract_deploy'
        },
        flags
      );
      printJson(
        await client.signAndSubmit(wallet, {
          fee,
          payload,
          type: 'contract_deploy'
        })
      );
      return;
    }
    case 'contract:call': {
      const client = getClient(flags);
      const wallet = await loadWallet(requireFlag(flags, 'wallet'));
      const config = {
        payload: {
          args: await buildContractCallArgs(flags, wallet),
          contract: requireFlag(flags, 'contract'),
          gasLimit: getWholeNumberFlag(flags, 'gas-limit', 30000),
          method: requireFlag(flags, 'method')
        },
        type: 'contract_call'
      };
      const fee = await resolveTransactionFee(client, wallet, config, flags);
      const result = flags.simulate
        ? await client.signAndSimulate(wallet, { ...config, fee })
        : await client.signAndSubmit(wallet, { ...config, fee });
      printJson(result);
      return;
    }
    case 'proposal:treasury': {
      const client = getClient(flags);
      const wallet = await loadWallet(requireFlag(flags, 'wallet'));
      const config = {
        payload: {
          category: 'treasury',
          grants: await buildTreasuryProposalGrants(flags),
          summary: requireFlag(flags, 'summary'),
          title: requireFlag(flags, 'title')
        },
        type: 'proposal'
      };
      const fee = await resolveTransactionFee(client, wallet, config, flags);
      const result = flags.simulate
        ? await client.signAndSimulate(wallet, { ...config, fee })
        : await client.signAndSubmit(wallet, { ...config, fee });
      printJson(result);
      return;
    }
    case 'contracts:templates': {
      const client = getClient(flags);
      printJson(await client.getContractTemplates());
      return;
    }
    case 'finality': {
      const client = getClient(flags);
      printJson(await client.getFinality());
      return;
    }
    case 'search': {
      const client = getClient(flags);
      printJson(await client.search(requireFlag(flags, 'query')));
      return;
    }
    case 'activity': {
      const client = getClient(flags);
      printJson(await client.getAccountActivity(requireFlag(flags, 'address'), Number(flags.limit || 20)));
      return;
    }
    case 'database:status': {
      const client = getClient(flags);
      printJson(await client.getDatabaseStatus());
      return;
    }
    case 'network:sync': {
      const client = getClient(flags);
      printJson(
        await client.syncNetwork({
          mempoolLimit: Number(flags['mempool-limit'] || 25)
        })
      );
      return;
    }
    case 'snapshot:save': {
      const client = getClient(flags);
      printJson(await client.saveSnapshot(flags.path));
      return;
    }
    case 'snapshot:export': {
      const client = getClient(flags);
      const snapshot = await client.exportSnapshot();
      if (flags.out) {
        await writeFile(resolve(flags.out), JSON.stringify(snapshot, null, 2), 'utf8');
      }
      printJson(snapshot);
      return;
    }
    case 'snapshot:import': {
      const client = getClient(flags);
      const snapshot = validateSnapshotShape(await loadJsonFile(requireFlag(flags, 'file')));
      printJson(await client.importSnapshot(snapshot));
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
