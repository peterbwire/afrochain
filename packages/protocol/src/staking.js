import { clampNumber, createId, pickWeighted } from './utils.js';

function ensureDelegationBook(state, validatorAddress) {
  state.delegations[validatorAddress] ||= {};
  return state.delegations[validatorAddress];
}

export function getAccountStakedAmount(state, address) {
  return Object.values(state.delegations).reduce(
    (total, delegationBook) => total + Number(delegationBook[address] || 0),
    0
  );
}

export function getTotalActiveStake(state) {
  return Object.values(state.validators)
    .filter((validator) => validator.active)
    .reduce((total, validator) => total + Number(validator.totalStake || 0), 0);
}

export function selectProposer(state, previousHash, nextHeight) {
  const validators = Object.values(state.validators)
    .filter((validator) => validator.active)
    .map((validator) => ({
      key: validator.address,
      weight: Number(validator.totalStake || 0)
    }));

  return pickWeighted(validators, `${previousHash}${nextHeight}`) || Object.keys(state.validators)[0] || null;
}

export function applyStakeTransaction(state, sender, payload, helpers) {
  const action = payload.action;
  const amount = Number(payload.amount || 0);

  switch (action) {
    case 'register_validator': {
      if (state.validators[sender]?.active) {
        throw new Error('Sender is already registered as an active validator.');
      }

      if (amount < state.params.minValidatorStake) {
        throw new Error('Self-stake is below the minimum validator stake.');
      }

      helpers.debit(sender, amount);
      state.rewardAccounts[sender] ||= 0;
      ensureDelegationBook(state, sender)[sender] = amount;
      state.validators[sender] = {
        active: true,
        address: sender,
        blocksProduced: 0,
        commissionRate: clampNumber(payload.commissionRate ?? 0.08, 0, 0.2),
        delegatedStake: 0,
        endpoint: payload.endpoint || '',
        lastProposedHeight: helpers.currentHeight,
        name: payload.name || `Validator ${sender.slice(-6)}`,
        region: payload.region || 'Pan-Africa',
        rewards: 0,
        selfStake: amount,
        totalStake: amount,
        uptime: 100
      };
      state.addressBook[sender] ||= {
        label: payload.name || `Validator ${sender.slice(-6)}`,
        region: payload.region || 'Pan-Africa',
        type: 'validator'
      };

      return {
        action,
        validator: sender
      };
    }
    case 'delegate': {
      const validator = state.validators[payload.validator];
      if (!validator?.active) {
        throw new Error('Target validator is not active.');
      }

      if (amount <= 0) {
        throw new Error('Delegation amount must be greater than zero.');
      }

      helpers.debit(sender, amount);
      const delegationBook = ensureDelegationBook(state, payload.validator);
      delegationBook[sender] = Number(delegationBook[sender] || 0) + amount;

      if (sender === payload.validator) {
        validator.selfStake += amount;
      } else {
        validator.delegatedStake += amount;
      }

      validator.totalStake += amount;

      return {
        action,
        amount,
        delegator: sender,
        validator: payload.validator
      };
    }
    case 'undelegate': {
      const validator = state.validators[payload.validator];
      const delegationBook = ensureDelegationBook(state, payload.validator);
      const currentDelegation = Number(delegationBook[sender] || 0);

      if (!validator) {
        throw new Error('Validator does not exist.');
      }

      if (amount <= 0 || currentDelegation < amount) {
        throw new Error('Undelegation amount exceeds the current delegated stake.');
      }

      delegationBook[sender] = currentDelegation - amount;
      if (delegationBook[sender] === 0) {
        delete delegationBook[sender];
      }

      if (sender === payload.validator) {
        validator.selfStake -= amount;
      } else {
        validator.delegatedStake -= amount;
      }

      validator.totalStake -= amount;
      validator.active = validator.selfStake >= state.params.minValidatorStake;

      const withdrawal = {
        address: sender,
        amount,
        id: createId('unstake', `${sender}:${payload.validator}:${helpers.currentHeight}:${amount}`),
        unlockHeight: helpers.currentHeight + state.params.unbondingPeriodBlocks,
        validator: payload.validator
      };

      state.pendingWithdrawals.push(withdrawal);

      return {
        action,
        unlockHeight: withdrawal.unlockHeight,
        validator: payload.validator,
        withdrawalId: withdrawal.id
      };
    }
    case 'claim_rewards': {
      const rewards = Number(state.rewardAccounts[sender] || 0);
      if (rewards <= 0) {
        throw new Error('There are no staking rewards to claim.');
      }

      state.rewardAccounts[sender] = 0;
      helpers.credit(sender, rewards);

      return {
        action,
        claimed: rewards
      };
    }
    default:
      throw new Error(`Unknown stake action: ${action}`);
  }
}

export function processPendingWithdrawals(state, currentHeight, helpers) {
  const matured = [];
  const deferred = [];

  for (const withdrawal of state.pendingWithdrawals) {
    if (withdrawal.unlockHeight <= currentHeight) {
      helpers.credit(withdrawal.address, withdrawal.amount);
      matured.push(withdrawal);
    } else {
      deferred.push(withdrawal);
    }
  }

  state.pendingWithdrawals = deferred;
  return matured;
}

export function distributeBlockRewards(state, proposerAddress, totalFees, helpers) {
  const validator = state.validators[proposerAddress];
  if (!validator) {
    return {
      baseReward: 0,
      burned: 0,
      distributed: 0,
      relayerSubsidy: 0
    };
  }

  const treasuryBalance = Number(state.balances[state.treasury] || 0);
  const baseReward = Math.min(state.params.blockReward, treasuryBalance);
  const burned = Math.round(totalFees * state.params.feeBurnRate);
  const relayerSubsidy = Math.round(totalFees * state.params.mobileRelayerRate);
  const distributableFees = totalFees - burned - relayerSubsidy;
  const rewardPool = Math.max(0, baseReward + distributableFees);

  if (baseReward > 0) {
    helpers.debit(state.treasury, baseReward);
  }

  if (relayerSubsidy > 0) {
    helpers.credit(state.mobileRelayerPool, relayerSubsidy);
    state.metrics.mobileSubsidies += relayerSubsidy;
  }

  const delegationBook = ensureDelegationBook(state, proposerAddress);
  const totalStake = Math.max(validator.totalStake, 1);
  const commission = Math.round(rewardPool * validator.commissionRate);
  let assigned = commission;

  state.rewardAccounts[proposerAddress] = Number(state.rewardAccounts[proposerAddress] || 0) + commission;

  for (const [delegator, stake] of Object.entries(delegationBook)) {
    const share = Math.round((rewardPool - commission) * (Number(stake) / totalStake));
    state.rewardAccounts[delegator] = Number(state.rewardAccounts[delegator] || 0) + share;
    assigned += share;
  }

  if (assigned !== rewardPool) {
    state.rewardAccounts[proposerAddress] += rewardPool - assigned;
  }

  validator.blocksProduced += 1;
  validator.lastProposedHeight = helpers.currentHeight;
  state.metrics.totalFeesBurned += burned;

  return {
    baseReward,
    burned,
    distributed: rewardPool,
    relayerSubsidy
  };
}
