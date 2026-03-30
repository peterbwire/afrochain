import { isValidAddress } from './crypto.js';
import { createId, sumRecord } from './utils.js';
import { getAccountStakedAmount, getTotalActiveStake } from './staking.js';

const MUTABLE_PARAMETERS = new Set([
  'baseFee',
  'blockReward',
  'contractGasPrice',
  'contractDeploymentBond',
  'defaultContractGasLimit',
  'finalityDepth',
  'governanceVotingWindow',
  'maxTransactionsPerBlock',
  'minValidatorStake',
  'proposalDeposit',
  'quorumRate',
  'targetBlockTimeMs',
  'unbondingPeriodBlocks'
]);
const TREASURY_SOURCE_TYPES = new Set(['treasury', 'inclusion_pool', 'settlement_pool']);
const PROPOSAL_CATEGORIES = new Set(['protocol', 'treasury', 'informational']);
const MAX_TREASURY_EVENTS = 50;

function applyProposalChanges(state, changes = []) {
  const applied = [];

  for (const change of changes) {
    if (!MUTABLE_PARAMETERS.has(change.parameter)) {
      continue;
    }

    state.params[change.parameter] = change.value;
    applied.push(change);
  }

  return applied;
}

function normalizeWholeBlocks(value, label) {
  const normalized = Number(value || 0);

  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`${label} must be a whole number greater than or equal to zero.`);
  }

  return normalized;
}

function ensureTreasuryRecipientMetadata(state, grant) {
  state.addressBook[grant.recipient] ||= {
    label: grant.label || 'Treasury Grant Recipient',
    region: grant.region || 'Pan-Africa',
    type: 'wallet'
  };
}

function recordTreasuryEvent(state, event) {
  state.treasuryEvents ??= [];
  state.treasuryEvents.unshift(event);
  state.treasuryEvents = state.treasuryEvents.slice(0, MAX_TREASURY_EVENTS);
}

function normalizeGrant(state, grant = {}) {
  const source = grant.source || state.treasury;
  const amount = Number(grant.amount || 0);
  const cliffBlocks = normalizeWholeBlocks(grant.cliffBlocks || 0, 'Treasury grant cliff');
  const sourceMetadata = state.addressBook[source];
  const vestingBlocks = normalizeWholeBlocks(grant.vestingBlocks || 0, 'Treasury grant vesting duration');

  if (!sourceMetadata || !TREASURY_SOURCE_TYPES.has(sourceMetadata.type)) {
    throw new Error(`Treasury grant source ${source} is not a recognized treasury account.`);
  }

  if (!isValidAddress(grant.recipient)) {
    throw new Error('Treasury grant recipient must be a valid AfroChain address.');
  }

  if (amount <= 0) {
    throw new Error('Treasury grant amount must be greater than zero.');
  }

  if (!Number.isInteger(amount)) {
    throw new Error('Treasury grant amount must be expressed in whole base units.');
  }

  if (!vestingBlocks && cliffBlocks > 0) {
    throw new Error('Treasury grant cliffs require a vesting duration greater than zero.');
  }

  return {
    amount,
    cliffBlocks,
    label: grant.label || null,
    note: grant.note || null,
    recipient: grant.recipient,
    region: grant.region || 'Pan-Africa',
    source,
    vestingBlocks
  };
}

function normalizeGrants(state, grants = []) {
  return grants.map((grant) => normalizeGrant(state, grant));
}

function validateProposalPayload(state, payload) {
  const category = payload.category || 'protocol';
  const changes = payload.changes || [];
  const grants = normalizeGrants(state, payload.grants || []);
  const vestingGrantCount = grants.filter((grant) => grant.vestingBlocks > 0).length;
  const vestedGrantVolume = grants.reduce(
    (total, grant) => total + (grant.vestingBlocks > 0 ? grant.amount : 0),
    0
  );
  const grantVolume = grants.reduce((total, grant) => total + grant.amount, 0);

  if (!PROPOSAL_CATEGORIES.has(category)) {
    throw new Error(`Unsupported proposal category: ${category}`);
  }

  if (category === 'treasury' && !grants.length) {
    throw new Error('Treasury proposals must include at least one grant disbursement.');
  }

  if (category === 'protocol' && !changes.length && !grants.length) {
    throw new Error('Protocol proposals must include a parameter change or treasury action.');
  }

  return {
    category,
    changes,
    grantCount: grants.length,
    grants,
    grantVolume,
    immediateGrantVolume: grantVolume - vestedGrantVolume,
    vestedGrantVolume,
    vestingGrantCount
  };
}

function buildProposalExecutionPlan(state, proposal) {
  const normalizedGrants = normalizeGrants(state, proposal.grants || []);
  const sourceTotals = normalizedGrants.reduce((totals, grant) => {
    totals[grant.source] = Number(totals[grant.source] || 0) + grant.amount;
    return totals;
  }, {});
  const grantDisbursements = normalizedGrants.filter((grant) => grant.vestingBlocks <= 0);
  const vestingGrantSchedules = normalizedGrants.filter((grant) => grant.vestingBlocks > 0);

  for (const [source, totalAmount] of Object.entries(sourceTotals)) {
    if (Number(state.balances[source] || 0) < totalAmount) {
      throw new Error(`Treasury source ${source} does not have enough AFC to fund the approved grants.`);
    }
  }

  return {
    appliedChanges: proposal.changes || [],
    grantDisbursements,
    vestingGrantSchedules
  };
}

function applyTreasuryGrants(state, grants, helpers, options = {}) {
  const disbursements = [];

  grants.forEach((grant, index) => {
    helpers.debit(grant.source, grant.amount);
    helpers.credit(grant.recipient, grant.amount);
    ensureTreasuryRecipientMetadata(state, grant);
    state.metrics.treasuryGrantCount = Number(state.metrics.treasuryGrantCount || 0) + 1;
    state.metrics.treasuryGrantVolume = Number(state.metrics.treasuryGrantVolume || 0) + grant.amount;
    const disbursement = {
      ...grant,
      blockHeight: options.currentHeight,
      executedAt: helpers.timestamp
    };
    recordTreasuryEvent(state, {
      amount: grant.amount,
      blockHeight: options.currentHeight,
      id: createId('treasury_event', `${options.proposalId || 'proposal'}:grant:${index}:${grant.recipient}:${options.currentHeight}`),
      label: grant.label,
      note: grant.note,
      participants: [grant.source, grant.recipient],
      proposalId: options.proposalId || null,
      recipient: grant.recipient,
      source: grant.source,
      timestamp: helpers.timestamp,
      type: 'treasury_grant_disbursement'
    });
    disbursements.push(disbursement);
  });

  return disbursements;
}

function scheduleTreasuryGrantVesting(state, grants, helpers, options = {}) {
  const schedules = [];

  state.pendingTreasuryGrants ??= [];

  grants.forEach((grant, index) => {
    helpers.debit(grant.source, grant.amount);
    helpers.credit(state.treasuryVestingEscrow, grant.amount);
    ensureTreasuryRecipientMetadata(state, grant);

    const schedule = {
      ...grant,
      amountReleased: 0,
      approvedAtHeight: options.currentHeight,
      completedAtHeight: null,
      createdAt: helpers.timestamp,
      endHeight: options.currentHeight + grant.cliffBlocks + grant.vestingBlocks,
      id: createId(
        'grant_vest',
        `${options.proposalId || 'proposal'}:${grant.recipient}:${options.currentHeight}:${index}:${grant.amount}`
      ),
      lastReleasedAtHeight: null,
      proposalId: options.proposalId || null,
      startHeight: options.currentHeight + grant.cliffBlocks + 1
    };

    state.pendingTreasuryGrants.push(schedule);
    state.metrics.treasuryVestingCount = Number(state.metrics.treasuryVestingCount || 0) + 1;
    state.metrics.treasuryVestingVolume = Number(state.metrics.treasuryVestingVolume || 0) + grant.amount;
    recordTreasuryEvent(state, {
      amount: grant.amount,
      blockHeight: options.currentHeight,
      cliffBlocks: grant.cliffBlocks,
      id: createId(
        'treasury_event',
        `${options.proposalId || 'proposal'}:vesting:${index}:${grant.recipient}:${options.currentHeight}`
      ),
      label: grant.label,
      note: grant.note,
      participants: [grant.source, grant.recipient],
      proposalId: options.proposalId || null,
      recipient: grant.recipient,
      source: grant.source,
      startHeight: schedule.startHeight,
      timestamp: helpers.timestamp,
      type: 'treasury_vesting_scheduled',
      vestingBlocks: grant.vestingBlocks
    });
    schedules.push(schedule);
  });

  return schedules;
}

export function processTreasuryGrantVesting(state, currentHeight, helpers) {
  const activeSchedules = [];
  const releases = [];

  state.pendingTreasuryGrants ??= [];

  for (const schedule of state.pendingTreasuryGrants) {
    const nextSchedule = {
      ...schedule
    };

    if (currentHeight >= nextSchedule.startHeight) {
      const elapsedBlocks = Math.min(nextSchedule.vestingBlocks, currentHeight - nextSchedule.startHeight + 1);
      const totalUnlocked = Math.floor((nextSchedule.amount * elapsedBlocks) / Math.max(nextSchedule.vestingBlocks, 1));
      const releasable = Math.max(0, totalUnlocked - nextSchedule.amountReleased);

      if (releasable > 0) {
        helpers.debit(state.treasuryVestingEscrow, releasable);
        helpers.credit(nextSchedule.recipient, releasable);
        ensureTreasuryRecipientMetadata(state, nextSchedule);
        nextSchedule.amountReleased += releasable;
        nextSchedule.lastReleasedAtHeight = currentHeight;
        state.metrics.treasuryGrantCount = Number(state.metrics.treasuryGrantCount || 0) + 1;
        state.metrics.treasuryGrantVolume = Number(state.metrics.treasuryGrantVolume || 0) + releasable;
        state.metrics.treasuryVestingReleased = Number(state.metrics.treasuryVestingReleased || 0) + releasable;

        const release = {
          amount: releasable,
          blockHeight: currentHeight,
          id: createId('grant_release', `${nextSchedule.id}:${currentHeight}:${nextSchedule.amountReleased}`),
          label: nextSchedule.label,
          note: nextSchedule.note,
          proposalId: nextSchedule.proposalId,
          recipient: nextSchedule.recipient,
          remainingAmount: Math.max(0, nextSchedule.amount - nextSchedule.amountReleased),
          releasedAt: helpers.timestamp,
          releasedSoFar: nextSchedule.amountReleased,
          source: nextSchedule.source,
          startHeight: nextSchedule.startHeight,
          type: 'treasury_vesting_release',
          vestingBlocks: nextSchedule.vestingBlocks
        };

        recordTreasuryEvent(state, {
          ...release,
          participants: [nextSchedule.source, nextSchedule.recipient],
          timestamp: helpers.timestamp
        });
        releases.push(release);
      }
    }

    if (nextSchedule.amountReleased < nextSchedule.amount) {
      activeSchedules.push(nextSchedule);
      continue;
    }

    nextSchedule.completedAtHeight = currentHeight;
  }

  state.pendingTreasuryGrants = activeSchedules;
  return releases;
}

export function createProposal(state, sender, payload, helpers) {
  const votingPower = getAccountStakedAmount(state, sender);
  if (votingPower <= 0) {
    throw new Error('Only stakers can create governance proposals.');
  }

  if (!payload.title || !payload.summary) {
    throw new Error('Proposal title and summary are required.');
  }

  helpers.debit(sender, state.params.proposalDeposit);
  const proposalPayload = validateProposalPayload(state, payload);

  const proposal = {
    ballots: {},
    category: proposalPayload.category,
    changes: proposalPayload.changes,
    createdAt: helpers.timestamp,
    deposit: state.params.proposalDeposit,
    endHeight: helpers.currentHeight + state.params.governanceVotingWindow,
    grantCount: proposalPayload.grantCount,
    grantDisbursements: [],
    grantSchedules: [],
    grantVolume: proposalPayload.grantVolume,
    grants: proposalPayload.grants,
    id: createId('prop', `${sender}:${payload.title}:${helpers.currentHeight}`),
    immediateGrantVolume: proposalPayload.immediateGrantVolume,
    proposer: sender,
    quorumNeeded: 0,
    startHeight: helpers.currentHeight + 1,
    status: 'active',
    summary: payload.summary,
    title: payload.title,
    vestedGrantVolume: proposalPayload.vestedGrantVolume,
    vestingGrantCount: proposalPayload.vestingGrantCount,
    votes: {
      abstain: 0,
      against: 0,
      for: 0
    }
  };

  state.proposals[proposal.id] = proposal;

  return proposal;
}

export function voteOnProposal(state, sender, payload, helpers) {
  const proposal = state.proposals[payload.proposalId];
  const choice = payload.choice;

  if (!proposal) {
    throw new Error('Proposal does not exist.');
  }

  if (!['for', 'against', 'abstain'].includes(choice)) {
    throw new Error('Vote choice must be for, against, or abstain.');
  }

  if (proposal.status !== 'active') {
    throw new Error('Proposal is no longer active.');
  }

  if (helpers.currentHeight < proposal.startHeight || helpers.currentHeight > proposal.endHeight) {
    throw new Error('Proposal is not currently accepting votes.');
  }

  if (proposal.ballots[sender]) {
    throw new Error('Sender has already voted on this proposal.');
  }

  const votingPower = getAccountStakedAmount(state, sender);
  if (votingPower <= 0) {
    throw new Error('Only stakers can vote on proposals.');
  }

  proposal.ballots[sender] = {
    choice,
    votedAtHeight: helpers.currentHeight,
    weight: votingPower
  };
  proposal.votes[choice] += votingPower;

  return {
    choice,
    proposalId: proposal.id,
    votingPower
  };
}

export function finalizeProposals(state, currentHeight, helpers) {
  const finalized = [];
  const totalActiveStake = getTotalActiveStake(state);

  for (const proposal of Object.values(state.proposals)) {
    if (proposal.status !== 'active' || currentHeight <= proposal.endHeight) {
      continue;
    }

    const totalVotes = sumRecord(proposal.votes);
    const quorumNeeded = Math.round(totalActiveStake * state.params.quorumRate);
    const passed = totalVotes >= quorumNeeded && proposal.votes.for > proposal.votes.against;

    proposal.finalizedAtHeight = currentHeight;
    proposal.quorumNeeded = quorumNeeded;
    proposal.status = passed ? 'passed' : 'rejected';

    if (passed) {
      try {
        const executionPlan = buildProposalExecutionPlan(state, proposal);
        proposal.appliedChanges = applyProposalChanges(state, executionPlan.appliedChanges);
        proposal.grantDisbursements = applyTreasuryGrants(state, executionPlan.grantDisbursements, helpers, {
          currentHeight,
          proposalId: proposal.id
        });
        proposal.grantSchedules = scheduleTreasuryGrantVesting(state, executionPlan.vestingGrantSchedules, helpers, {
          currentHeight,
          proposalId: proposal.id
        });
        proposal.executionError = null;
        helpers.credit(proposal.proposer, proposal.deposit);
      } catch (error) {
        proposal.status = 'execution_failed';
        proposal.executionError = error.message;
        proposal.appliedChanges = [];
        proposal.grantDisbursements = [];
        proposal.grantSchedules = [];
        helpers.credit(state.treasury, proposal.deposit);
      }
    } else {
      helpers.credit(state.treasury, proposal.deposit);
    }

    finalized.push({
      category: proposal.category,
      disbursedGrantCount: proposal.grantDisbursements.length,
      id: proposal.id,
      passed: proposal.status === 'passed',
      scheduledGrantCount: proposal.grantSchedules.length,
      status: proposal.status,
      totalVotes
    });
  }

  return finalized;
}
