import { createId, sumRecord } from '../utils.js';

export const SYSTEM_CONTRACTS = {
  AFROCOIN: 'afc_contract_afrocoin',
  GOVERNANCE: 'afc_contract_governance'
};

const templateRegistry = {
  afrocoin: {
    label: 'AfroCoin Native Token',
    description: 'Predeployed system contract exposing ERC20-style methods for the native AFC asset.',
    methods: ['approve', 'transfer', 'transferFrom'],
    deploy: () => ({
      allowances: {}
    }),
    deployGas: () => 600,
    callGas(_context, _contract, method) {
      switch (method) {
        case 'approve':
          return 800;
        case 'transfer':
          return 1_400;
        case 'transferFrom':
          return 1_900;
        default:
          throw new Error(`Unsupported AfroCoin method: ${method}`);
      }
    },
    call(context, contract, method, args = {}) {
      const amount = Number(args.amount || 0);

      switch (method) {
        case 'approve': {
          if (amount < 0) {
            throw new Error('Approval amount must be zero or positive.');
          }

          const spender = args.spender;
          contract.state.allowances[context.sender] ||= {};
          contract.state.allowances[context.sender][spender] = amount;
          return {
            approved: amount,
            owner: context.sender,
            spender
          };
        }
        case 'transfer': {
          context.transfer(context.sender, args.to, amount, {
            metrics: true,
            mobileMoneyProvider: args.mobileMoneyProvider,
            originCountry: args.originCountry,
            destinationCountry: args.destinationCountry,
            reference: args.reference
          });

          return {
            amount,
            from: context.sender,
            to: args.to
          };
        }
        case 'transferFrom': {
          const ownerAllowances = contract.state.allowances[args.from] || {};
          const remainingAllowance = Number(ownerAllowances[context.sender] || 0);

          if (remainingAllowance < amount) {
            throw new Error('Allowance is too low for transferFrom.');
          }

          ownerAllowances[context.sender] = remainingAllowance - amount;
          contract.state.allowances[args.from] = ownerAllowances;

          context.transfer(args.from, args.to, amount, {
            metrics: true,
            mobileMoneyProvider: args.mobileMoneyProvider,
            originCountry: args.originCountry,
            destinationCountry: args.destinationCountry,
            reference: args.reference
          });

          return {
            amount,
            from: args.from,
            spender: context.sender,
            to: args.to
          };
        }
        default:
          throw new Error(`Unsupported AfroCoin method: ${method}`);
      }
    },
    view(context, contract, method, args = {}) {
      switch (method) {
        case 'balanceOf':
          return {
            address: args.address,
            balance: context.getBalance(args.address)
          };
        case 'allowance':
          return {
            allowance: Number(contract.state.allowances?.[args.owner]?.[args.spender] || 0),
            owner: args.owner,
            spender: args.spender
          };
        case 'stats':
          return {
            holders: Object.keys(context.state.balances).length,
            symbol: context.state.token.symbol,
            totalSupply: context.state.token.totalSupply
          };
        default:
          return {
            state: contract.state
          };
      }
    }
  },
  governance: {
    label: 'AfroChain DAO',
    description: 'Protocol governance contract surfacing proposals and parameter controls.',
    methods: [],
    deploy: () => ({}),
    deployGas: () => 500,
    view(context) {
      return {
        parameters: context.state.params,
        proposals: Object.values(context.state.proposals)
      };
    }
  },
  savings_circle: {
    label: 'Savings Circle',
    description: 'A community savings contract for rotating payouts and collective inclusion.',
    methods: ['join', 'contribute', 'payoutNext'],
    deploy(args = {}, meta) {
      return {
        contributionAmount: Number(args.contributionAmount || 0),
        currentRecipientIndex: 0,
        members: args.members || [meta.owner],
        payouts: [],
        pot: 0
      };
    },
    deployGas(args = {}) {
      return 1_100 + (args.members?.length || 1) * 80;
    },
    callGas(_context, contract, method) {
      switch (method) {
        case 'join':
          return 900;
        case 'contribute':
          return 1_800;
        case 'payoutNext':
          return 2_400 + contract.state.members.length * 60;
        default:
          throw new Error(`Unsupported savings circle method: ${method}`);
      }
    },
    call(context, contract, method) {
      switch (method) {
        case 'join': {
          if (!contract.state.members.includes(context.sender)) {
            contract.state.members.push(context.sender);
          }

          return {
            joined: true,
            memberCount: contract.state.members.length
          };
        }
        case 'contribute': {
          const amount = contract.state.contributionAmount;
          if (amount <= 0) {
            throw new Error('Contribution amount must be configured on deployment.');
          }

          context.transfer(context.sender, contract.address, amount, {
            metrics: false
          });
          contract.state.pot += amount;

          return {
            contributed: amount,
            pot: contract.state.pot
          };
        }
        case 'payoutNext': {
          if (!contract.state.members.length) {
            throw new Error('Savings circle has no members.');
          }

          if (contract.state.pot <= 0) {
            throw new Error('Savings circle pot is empty.');
          }

          const recipient = contract.state.members[contract.state.currentRecipientIndex];
          const payout = contract.state.pot;

          context.transfer(contract.address, recipient, payout, {
            metrics: false
          });

          contract.state.payouts.push({
            amount: payout,
            recipient,
            timestamp: context.timestamp
          });
          contract.state.pot = 0;
          contract.state.currentRecipientIndex =
            (contract.state.currentRecipientIndex + 1) % contract.state.members.length;

          return {
            payout,
            recipient
          };
        }
        default:
          throw new Error(`Unsupported savings circle method: ${method}`);
      }
    }
  },
  merchant_escrow: {
    label: 'Merchant Escrow',
    description: 'Cross-border merchant protection for mobile-first commerce and remittance flows.',
    methods: ['fund', 'release', 'refund'],
    deploy(args = {}, meta) {
      return {
        amount: Number(args.amount || 0),
        buyer: args.buyer || meta.owner,
        funded: false,
        merchant: args.merchant,
        released: false
      };
    },
    deployGas: () => 1_250,
    callGas(_context, _contract, method) {
      switch (method) {
        case 'fund':
          return 1_900;
        case 'release':
          return 2_100;
        case 'refund':
          return 2_200;
        default:
          throw new Error(`Unsupported escrow method: ${method}`);
      }
    },
    call(context, contract, method) {
      switch (method) {
        case 'fund': {
          if (context.sender !== contract.state.buyer) {
            throw new Error('Only the buyer can fund this escrow.');
          }

          if (contract.state.funded) {
            throw new Error('Escrow has already been funded.');
          }

          context.transfer(contract.state.buyer, contract.address, contract.state.amount, {
            metrics: false
          });
          contract.state.funded = true;

          return {
            funded: contract.state.amount
          };
        }
        case 'release': {
          if (!contract.state.funded) {
            throw new Error('Escrow must be funded before release.');
          }

          if (contract.state.released) {
            throw new Error('Escrow has already been released.');
          }

          if (context.sender !== contract.state.buyer && context.sender !== contract.owner) {
            throw new Error('Only the buyer or contract owner can release this escrow.');
          }

          context.transfer(contract.address, contract.state.merchant, contract.state.amount, {
            metrics: false
          });
          contract.state.released = true;

          return {
            merchant: contract.state.merchant,
            released: contract.state.amount
          };
        }
        case 'refund': {
          if (!contract.state.funded || contract.state.released) {
            throw new Error('Escrow cannot be refunded in its current state.');
          }

          if (context.sender !== contract.owner && context.sender !== contract.state.merchant) {
            throw new Error('Only the contract owner or merchant can approve a refund.');
          }

          context.transfer(contract.address, contract.state.buyer, contract.state.amount, {
            metrics: false
          });
          contract.state.funded = false;

          return {
            buyer: contract.state.buyer,
            refunded: contract.state.amount
          };
        }
        default:
          throw new Error(`Unsupported escrow method: ${method}`);
      }
    }
  }
};

function getSampleTemplateArgs(templateName) {
  switch (templateName) {
    case 'savings_circle':
      return {
        contributionAmount: 1,
        members: ['afc_sample_member_1', 'afc_sample_member_2']
      };
    case 'merchant_escrow':
      return {
        amount: 1,
        buyer: 'afc_sample_buyer',
        merchant: 'afc_sample_merchant'
      };
    default:
      return {};
  }
}

function buildSampleMethodGas(templateName, template) {
  if (!template.methods?.length) {
    return {};
  }

  const args = getSampleTemplateArgs(templateName);
  const metadata = {
    address: `afc_contract_sample_${templateName}`,
    name: `${template.label} Sample`,
    owner: 'afc_sample_owner',
    timestamp: new Date('2026-01-01T00:00:00.000Z').toISOString()
  };
  const sampleContract = {
    ...metadata,
    state: template.deploy(args, metadata),
    template: templateName
  };
  const context = {
    getBalance: () => 0,
    sender: metadata.owner,
    state: {
      balances: {}
    },
    timestamp: metadata.timestamp,
    transfer: () => ({})
  };

  return Object.fromEntries(
    template.methods.map((method) => [method, Number(template.callGas ? template.callGas(context, sampleContract, method, {}) : 1_200)])
  );
}

export function createSystemContracts(timestamp) {
  return {
    [SYSTEM_CONTRACTS.AFROCOIN]: {
      address: SYSTEM_CONTRACTS.AFROCOIN,
      createdAt: timestamp,
      description: templateRegistry.afrocoin.description,
      name: 'AfroCoin',
      owner: 'afc_treasury',
      state: templateRegistry.afrocoin.deploy(),
      system: true,
      template: 'afrocoin'
    },
    [SYSTEM_CONTRACTS.GOVERNANCE]: {
      address: SYSTEM_CONTRACTS.GOVERNANCE,
      createdAt: timestamp,
      description: templateRegistry.governance.description,
      name: 'AfroChain DAO',
      owner: 'afc_treasury',
      state: templateRegistry.governance.deploy(),
      system: true,
      template: 'governance'
    }
  };
}

export function listContractTemplates() {
  return Object.entries(templateRegistry).map(([id, template]) => ({
    description: template.description,
    id,
    label: template.label,
    methods: template.methods || [],
    sampleDeployGas: Number(template.deployGas ? template.deployGas(getSampleTemplateArgs(id)) : 0),
    sampleMethodGas: buildSampleMethodGas(id, template)
  }));
}

export function estimateContractDeployGas(templateName, args = {}) {
  const template = templateRegistry[templateName];
  if (!template) {
    throw new Error(`Unknown contract template: ${templateName}`);
  }

  return Number(template.deployGas ? template.deployGas(args) : 1_000);
}

export function estimateContractCallGas(context, contract, method, args = {}) {
  const template = templateRegistry[contract.template];
  if (!template?.call) {
    throw new Error(`Contract template ${contract.template} does not expose callable methods.`);
  }

  return Number(template.callGas ? template.callGas(context, contract, method, args) : 1_200);
}

export function createContractInstance(templateName, metadata = {}) {
  const template = templateRegistry[templateName];
  if (!template) {
    throw new Error(`Unknown contract template: ${templateName}`);
  }

  const timestamp = metadata.timestamp || new Date().toISOString();
  const address =
    metadata.address || createId('afc_contract', `${metadata.owner}:${templateName}:${timestamp}:${metadata.name || ''}`);

  return {
    address,
    createdAt: timestamp,
    description: metadata.description || template.description,
    name: metadata.name || template.label,
    owner: metadata.owner,
    state: template.deploy(metadata.args || {}, metadata),
    template: templateName
  };
}

export function executeContractCall(context, contract, method, args = {}) {
  const template = templateRegistry[contract.template];
  if (!template?.call) {
    throw new Error(`Contract template ${contract.template} does not expose callable methods.`);
  }

  return template.call(context, contract, method, args);
}

export function readContract(context, contract, method, args = {}) {
  const template = templateRegistry[contract.template];

  if (!template) {
    throw new Error(`Unknown contract template: ${contract.template}`);
  }

  if (!method) {
    return {
      address: contract.address,
      balance: context.getBalance(contract.address),
      owner: contract.owner,
      state: contract.state,
      template: contract.template
    };
  }

  if (!template.view) {
    return {
      state: contract.state
    };
  }

  return template.view(context, contract, method, args);
}

export function summarizeContractPortfolio(state) {
  return Object.values(state.contracts).map((contract) => ({
    address: contract.address,
    balance: Number(state.balances[contract.address] || 0),
    name: contract.name,
    owner: contract.owner,
    template: contract.template
  }));
}

export function getAllowanceExposure(contract) {
  return sumRecord(
    Object.values(contract.state.allowances || {}).reduce((accumulator, ownerAllowances) => {
      const key = `owner_${Object.keys(accumulator).length}`;
      accumulator[key] = sumRecord(ownerAllowances);
      return accumulator;
    }, {})
  );
}
