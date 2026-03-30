import { createSystemContracts } from './contracts/templates.js';
import { AFC_SYMBOL, AFC_UNIT, corridorKey } from './utils.js';

export const TOTAL_SUPPLY = 2_100_000_000 * AFC_UNIT;

export const BOOTSTRAP_VALIDATORS = [
  {
    address: 'afc_validator_nairobi',
    commissionRate: 0.06,
    endpoint: 'https://validator-nairobi.afrochain.local',
    liquidBalance: 5_000_000 * AFC_UNIT,
    name: 'Nairobi Core',
    region: 'Kenya',
    selfStake: 15_000_000 * AFC_UNIT
  },
  {
    address: 'afc_validator_lagos',
    commissionRate: 0.065,
    endpoint: 'https://validator-lagos.afrochain.local',
    liquidBalance: 5_000_000 * AFC_UNIT,
    name: 'Lagos Relay',
    region: 'Nigeria',
    selfStake: 15_000_000 * AFC_UNIT
  },
  {
    address: 'afc_validator_kigali',
    commissionRate: 0.055,
    endpoint: 'https://validator-kigali.afrochain.local',
    liquidBalance: 5_000_000 * AFC_UNIT,
    name: 'Kigali Trust',
    region: 'Rwanda',
    selfStake: 15_000_000 * AFC_UNIT
  },
  {
    address: 'afc_validator_cape_town',
    commissionRate: 0.07,
    endpoint: 'https://validator-cape-town.afrochain.local',
    liquidBalance: 5_000_000 * AFC_UNIT,
    name: 'Cape Town Edge',
    region: 'South Africa',
    selfStake: 15_000_000 * AFC_UNIT
  }
];

export function createGenesisState(options = {}) {
  const timestamp = options.timestamp || '2026-01-01T00:00:00.000Z';
  const treasury = 'afc_treasury';
  const communityGrants = 'afc_community_grants';
  const settlementHub = 'afc_settlement_hub';
  const innovationFund = 'afc_innovation_fund';
  const mobileRelayerPool = 'afc_mobile_relayer_pool';
  const treasuryVestingEscrow = 'afc_treasury_vesting_escrow';
  const communityTreasury = 140_000_000 * AFC_UNIT;
  const settlementLiquidity = 180_000_000 * AFC_UNIT;
  const innovationReserve = 80_000_000 * AFC_UNIT;
  const relayerReserve = 60_000_000 * AFC_UNIT;
  let allocatedSupply = communityTreasury + settlementLiquidity + innovationReserve + relayerReserve;

  const balances = {
    [communityGrants]: communityTreasury,
    [innovationFund]: innovationReserve,
    [mobileRelayerPool]: relayerReserve,
    [settlementHub]: settlementLiquidity
  };
  const nonces = {};
  const rewardAccounts = {};
  const delegations = {};
  const validators = {};
  const addressBook = {
    [communityGrants]: {
      label: 'Community Grants Treasury',
      region: 'Pan-Africa',
      type: 'treasury'
    },
    [innovationFund]: {
      label: 'Financial Inclusion Innovation Fund',
      region: 'Pan-Africa',
      type: 'treasury'
    },
    [mobileRelayerPool]: {
      label: 'Mobile Relayer Subsidy Pool',
      region: 'Pan-Africa',
      type: 'inclusion_pool'
    },
    [settlementHub]: {
      label: 'Cross-Border Settlement Hub',
      region: 'Pan-Africa',
      type: 'settlement_pool'
    },
    [treasury]: {
      label: 'AfroChain Treasury',
      region: 'Pan-Africa',
      type: 'treasury'
    },
    [treasuryVestingEscrow]: {
      label: 'Treasury Vesting Escrow',
      region: 'Pan-Africa',
      type: 'treasury_escrow'
    }
  };

  for (const validator of BOOTSTRAP_VALIDATORS) {
    allocatedSupply += validator.liquidBalance + validator.selfStake;
    balances[validator.address] = validator.liquidBalance;
    nonces[validator.address] = 0;
    rewardAccounts[validator.address] = 0;
    delegations[validator.address] = {
      [validator.address]: validator.selfStake
    };
    validators[validator.address] = {
      active: true,
      address: validator.address,
      blocksProduced: 0,
      commissionRate: validator.commissionRate,
      delegatedStake: 0,
      endpoint: validator.endpoint,
      lastProposedHeight: 0,
      name: validator.name,
      region: validator.region,
      rewards: 0,
      selfStake: validator.selfStake,
      totalStake: validator.selfStake,
      uptime: 100
    };
    addressBook[validator.address] = {
      label: validator.name,
      region: validator.region,
      type: 'validator'
    };
  }

  balances[treasury] = TOTAL_SUPPLY - allocatedSupply;
  balances[treasuryVestingEscrow] = 0;
  nonces[treasury] = 0;
  nonces[communityGrants] = 0;
  nonces[settlementHub] = 0;
  nonces[innovationFund] = 0;
  nonces[mobileRelayerPool] = 0;
  nonces[treasuryVestingEscrow] = 0;

  return {
    addressBook,
    balances,
    chainId: options.chainId || 'afrochain-1',
    contracts: createSystemContracts(timestamp),
    delegations,
    faucet: {
      address: communityGrants,
      cooldownMs: 300_000,
      disbursements: [],
      maxAmount: 2_500 * AFC_UNIT,
      requestLog: {}
    },
    genesisTimestamp: timestamp,
    lastUpdatedAt: timestamp,
    metrics: {
      activeContracts: 2,
      corridors: {
        [corridorKey('Kenya', 'Nigeria')]: {
          mobileMoneyVolume: 0,
          transactions: 0,
          volume: 0
        },
        [corridorKey('Ghana', 'South Africa')]: {
          mobileMoneyVolume: 0,
          transactions: 0,
          volume: 0
        },
        [corridorKey('Rwanda', 'Tanzania')]: {
          mobileMoneyVolume: 0,
          transactions: 0,
          volume: 0
        }
      },
      crossBorderTransactions: 0,
      crossBorderVolume: 0,
      mobileSubsidies: 0,
      totalContractGasUsed: 0,
      totalBlocks: 0,
      totalFeesBurned: 0,
      totalTransactions: 0,
      treasuryGrantCount: 0,
      treasuryGrantVolume: 0,
      treasuryVestingCount: 0,
      treasuryVestingReleased: 0,
      treasuryVestingVolume: 0
    },
    mobileRelayerPool,
    network: options.network || 'devnet',
    nonces,
    pendingTreasuryGrants: [],
    params: {
      baseFee: 500,
      blockReward: 35 * AFC_UNIT,
      contractGasPrice: 5,
      contractDeploymentBond: 25 * AFC_UNIT,
      defaultContractGasLimit: 30_000,
      feeBurnRate: 0.1,
      finalityDepth: 2,
      governanceVotingWindow: 12,
      maxTransactionsPerBlock: 25,
      minValidatorStake: 250_000 * AFC_UNIT,
      mobileRelayerRate: 0.2,
      proposalDeposit: 150 * AFC_UNIT,
      quorumRate: 0.25,
      targetBlockTimeMs: 15_000,
      unbondingPeriodBlocks: 5
    },
    pendingWithdrawals: [],
    proposals: {},
    rewardAccounts,
    token: {
      decimals: 6,
      name: 'AfroCoin',
      symbol: AFC_SYMBOL,
      totalSupply: TOTAL_SUPPLY
    },
    transactions: {},
    treasury,
    treasuryEvents: [],
    treasuryVestingEscrow,
    validators
  };
}
