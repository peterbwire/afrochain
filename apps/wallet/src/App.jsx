import { useEffect, useState } from 'react';

import {
  AfroChainClient,
  changeWalletPassphrase,
  createWallet,
  decryptWallet,
  encryptWallet,
  formatUnits,
  isWalletKeystore,
  parseWalletKeystore,
  parseUnits,
  serializeWalletKeystore
} from '@afrochain/sdk';

const client = new AfroChainClient({
  baseUrl: import.meta.env.VITE_AFROCHAIN_API || 'http://localhost:4100',
  operatorToken: import.meta.env.VITE_AFROCHAIN_OPERATOR_TOKEN || null
});
const STORAGE_KEY = 'afrochain.reference.wallet';
const DEFAULT_FEE = 500;
const DEFAULT_SESSION_TIMEOUT_MINUTES = 10;

function readStoredWalletData() {
  try {
    const rawValue = localStorage.getItem(STORAGE_KEY);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch {
    return null;
  }
}

function persistWalletKeystore(keystore) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keystore));
}

function clearStoredWallet() {
  localStorage.removeItem(STORAGE_KEY);
}

function formatAfc(value) {
  return Number(formatUnits(value || 0)).toLocaleString('en-US', {
    maximumFractionDigits: 2
  });
}

function getContractMethods(templateId, templates) {
  return templates.find((template) => template.id === templateId)?.methods || [];
}

function getDefaultContractMethod(templateId, templates) {
  return getContractMethods(templateId, templates)[0] || '';
}

function createGrantDraft(source = 'afc_community_grants') {
  return {
    amount: '250',
    cliffBlocks: '0',
    label: 'Community builder grant',
    note: 'Support local fintech onboarding.',
    recipient: 'afc_settlement_hub',
    source,
    vestingBlocks: '0'
  };
}

export default function App() {
  const [wallet, setWallet] = useState(null);
  const [keystore, setKeystore] = useState(null);
  const [legacyWallet, setLegacyWallet] = useState(null);
  const [account, setAccount] = useState(null);
  const [activity, setActivity] = useState([]);
  const [validators, setValidators] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [contractTemplates, setContractTemplates] = useState([]);
  const [chain, setChain] = useState(null);
  const [finality, setFinality] = useState(null);
  const [faucet, setFaucet] = useState(null);
  const [treasury, setTreasury] = useState(null);
  const [status, setStatus] = useState('Generating mobile-first wallet...');
  const [paymentPreview, setPaymentPreview] = useState(null);
  const [sendForm, setSendForm] = useState({
    amount: '25',
    destinationCountry: 'Nigeria',
    mobileMoneyProvider: 'M-Pesa',
    originCountry: 'Kenya',
    recipient: 'afc_settlement_hub',
    reference: 'School fees'
  });
  const [stakeForm, setStakeForm] = useState({
    action: 'delegate',
    amount: '250',
    commissionRate: '0.08',
    endpoint: 'https://validator-community.afrochain.local',
    name: 'Community Validator',
    region: 'Ghana',
    validator: 'afc_validator_nairobi'
  });
  const [proposalForm, setProposalForm] = useState({
    category: 'protocol',
    parameter: 'baseFee',
    summary: 'Keep fees low for remittance wallets and merchant micro-payments.',
    title: 'Lower the base transaction fee'
  });
  const [proposalGrants, setProposalGrants] = useState([createGrantDraft()]);
  const [contractForm, setContractForm] = useState({
    amount: '100',
    counterparty: 'afc_settlement_hub',
    gasLimit: '30000',
    name: 'Diaspora Builder Contract',
    template: 'savings_circle'
  });
  const [contractActionForm, setContractActionForm] = useState({
    contract: '',
    gasLimit: '30000',
    method: 'join'
  });
  const [contractActionArgs, setContractActionArgs] = useState({
    amount: '25',
    destinationCountry: 'Nigeria',
    from: '',
    mobileMoneyProvider: 'M-Pesa',
    originCountry: 'Kenya',
    reference: 'Contract payment',
    spender: '',
    to: 'afc_settlement_hub'
  });
  const [contractDeploymentEstimate, setContractDeploymentEstimate] = useState(null);
  const [contractDeploymentEstimateError, setContractDeploymentEstimateError] = useState('');
  const [contractActionEstimate, setContractActionEstimate] = useState(null);
  const [contractActionEstimateError, setContractActionEstimateError] = useState('');
  const [securityForm, setSecurityForm] = useState({
    currentPassphrase: '',
    confirmPassphrase: '',
    createPassphrase: '',
    importKeystoreJson: '',
    sessionTimeoutMinutes: String(DEFAULT_SESSION_TIMEOUT_MINUTES),
    unlockPassphrase: ''
  });
  const [exportedKeystoreJson, setExportedKeystoreJson] = useState('');
  const [lastInteractionAt, setLastInteractionAt] = useState(Date.now());
  const activeWalletIdentity = wallet || legacyWallet || keystore || null;
  const activeAddress = activeWalletIdentity?.address || null;
  const activeLabel = activeWalletIdentity?.label || null;
  const ownedContracts = contracts.filter((contract) => contract.owner === activeAddress);
  const selectedActionContract = contracts.find((contract) => contract.address === contractActionForm.contract) || null;
  const selectedDeployTemplate = contractTemplates.find((template) => template.id === contractForm.template) || null;
  const selectedActionTemplate = contractTemplates.find((template) => template.id === selectedActionContract?.template) || null;
  const contractMethods = getContractMethods(selectedActionContract?.template, contractTemplates);
  const sampleDeployFee = selectedDeployTemplate
    ? Number(chain?.baseFee || DEFAULT_FEE) + Number(chain?.contractGasPrice || 0) * Number(selectedDeployTemplate.sampleDeployGas || 0)
    : null;
  const sampleActionGas = Number(selectedActionTemplate?.sampleMethodGas?.[contractActionForm.method] || 0);
  const sampleActionFee = selectedActionTemplate
    ? Number(chain?.baseFee || DEFAULT_FEE) + Number(chain?.contractGasPrice || 0) * sampleActionGas
    : null;
  const deployGasDisplay = Number(contractDeploymentEstimate?.gasUsed || selectedDeployTemplate?.sampleDeployGas || 0);
  const deployFeeDisplay = Number(contractDeploymentEstimate?.minimumFee || sampleDeployFee || 0);
  const actionGasDisplay = Number(contractActionEstimate?.gasUsed || sampleActionGas || 0);
  const actionFeeDisplay = Number(contractActionEstimate?.minimumFee || sampleActionFee || 0);
  const proposalGrantTotal = proposalGrants.reduce((total, grant) => total + Number(grant.amount || 0), 0);
  const proposalVestingGrantCount = proposalGrants.filter((grant) => Number(grant.vestingBlocks || 0) > 0).length;

  async function bootstrapWallet() {
    const storedWallet = readStoredWalletData();
    if (!storedWallet) {
      setStatus('Create a secured wallet to continue.');
      return null;
    }

    if (isWalletKeystore(storedWallet)) {
      setKeystore(storedWallet);
      setLegacyWallet(null);
      setWallet(null);
      setStatus('Wallet found. Unlock with your passphrase to sign transactions.');
      return storedWallet;
    }

    if (storedWallet?.privateKey && storedWallet?.address) {
      setLegacyWallet(storedWallet);
      setKeystore(null);
      setWallet(null);
      setStatus('Legacy wallet detected. Set a passphrase to encrypt it before continuing.');
      return storedWallet;
    }

    clearStoredWallet();
    setStatus('Stored wallet data was invalid. Create a new secured wallet.');
    return null;
  }

  async function refresh(activeWallet, options = {}) {
    const effectiveWallet = activeWallet || wallet || legacyWallet || keystore;
    if (!effectiveWallet?.address) {
      return;
    }

    try {
      const [
        nextAccount,
        nextActivity,
        nextValidators,
        nextProposals,
        nextContracts,
        nextTemplates,
        nextChain,
        nextFinality,
        nextFaucet,
        nextTreasury
      ] =
        await Promise.all([
          client.getAccount(effectiveWallet.address),
          client.getAccountActivity(effectiveWallet.address, 8),
          client.getValidators(),
          client.getProposals(),
          client.getContracts(),
          client.getContractTemplates(),
          client.getChain(),
          client.getFinality(),
          client.getFaucet(),
          client.getTreasury()
        ]);

      setAccount(nextAccount);
      setActivity(nextActivity);
      setValidators(nextValidators);
      setProposals(nextProposals);
      setContracts(nextContracts);
      setContractTemplates(nextTemplates);
      setChain(nextChain);
      setFinality(nextFinality);
      setFaucet(nextFaucet);
      setTreasury(nextTreasury);
      setContractActionForm((current) => ({
        contract:
          current.contract && nextContracts.some((contract) => contract.address === current.contract)
            ? current.contract
            : nextContracts[0]?.address || '',
        gasLimit: current.gasLimit || String(nextChain.defaultContractGasLimit || 30000),
        method:
          current.method &&
          getContractMethods(
            (nextContracts.find((contract) => contract.address === current.contract) || nextContracts[0] || {}).template,
            nextTemplates
          ).includes(current.method)
            ? current.method
            : getDefaultContractMethod(
                (nextContracts.find((contract) => contract.address === current.contract) || nextContracts[0] || {}).template,
                nextTemplates
              )
      }));

      if (!options.preserveStatus) {
        setStatus(
          wallet?.privateKey
            ? 'Wallet synced with AfroChain.'
            : 'Wallet data refreshed. Unlock to sign transactions.'
        );
      }
    } catch (error) {
      setStatus(`Node unavailable: ${error.message}`);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function initialize() {
      try {
        const activeWallet = await bootstrapWallet();
        if (!mounted) {
          return;
        }

        await refresh(activeWallet, {
          preserveStatus: true
        });
      } catch (error) {
        if (mounted) {
          setStatus(`Wallet setup failed: ${error.message}`);
        }
      }
    }

    initialize();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      void refresh(undefined, {
        preserveStatus: true
      });
    }, 10000);

    return () => {
      clearInterval(intervalId);
    };
  }, [wallet, legacyWallet, keystore]);

  useEffect(() => {
    if (!wallet) {
      return undefined;
    }

    const sessionTimeoutMs = Math.max(
      60_000,
      Number(securityForm.sessionTimeoutMinutes || DEFAULT_SESSION_TIMEOUT_MINUTES) * 60_000
    );
    const markActive = () => setLastInteractionAt(Date.now());
    const eventTypes = ['pointerdown', 'keydown', 'touchstart'];
    const intervalId = setInterval(() => {
      if (Date.now() - lastInteractionAt >= sessionTimeoutMs) {
        handleLockWallet('Wallet auto-locked after inactivity.');
      }
    }, 1000);

    for (const eventType of eventTypes) {
      window.addEventListener(eventType, markActive);
    }

    return () => {
      clearInterval(intervalId);
      for (const eventType of eventTypes) {
        window.removeEventListener(eventType, markActive);
      }
    };
  }, [lastInteractionAt, securityForm.sessionTimeoutMinutes, wallet]);

  useEffect(() => {
    if (!(treasury?.topTreasuryAccounts || []).length) {
      return;
    }

    const defaultSource = treasury.topTreasuryAccounts[0].address;
    setProposalGrants((current) =>
      current.map((grant) => ({
        ...grant,
        source:
          grant.source && treasury.topTreasuryAccounts.some((account) => account.address === grant.source)
            ? grant.source
            : defaultSource
      }))
    );
  }, [treasury]);

  useEffect(() => {
    let cancelled = false;

    async function refreshDeploymentEstimate() {
      if (!wallet) {
        setContractDeploymentEstimate(null);
        setContractDeploymentEstimateError('');
        return;
      }

      try {
        const estimate = await client.estimateTransactionCost({
          ...buildContractDeployConfig(),
          sender: wallet.address
        });

        if (!cancelled) {
          setContractDeploymentEstimate(estimate);
          setContractDeploymentEstimateError('');
        }
      } catch (error) {
        if (!cancelled) {
          setContractDeploymentEstimate(null);
          setContractDeploymentEstimateError(error.message);
        }
      }
    }

    refreshDeploymentEstimate();
    return () => {
      cancelled = true;
    };
  }, [wallet, contractForm.amount, contractForm.counterparty, contractForm.gasLimit, contractForm.template]);

  useEffect(() => {
    let cancelled = false;

    async function refreshActionEstimate() {
      if (!wallet || !contractActionForm.contract || !contractActionForm.method || !selectedActionContract) {
        setContractActionEstimate(null);
        setContractActionEstimateError('');
        return;
      }

      try {
        const estimate = await client.estimateTransactionCost({
          ...buildContractActionConfig(),
          sender: wallet.address
        });

        if (!cancelled) {
          setContractActionEstimate(estimate);
          setContractActionEstimateError('');
        }
      } catch (error) {
        if (!cancelled) {
          setContractActionEstimate(null);
          setContractActionEstimateError(error.message);
        }
      }
    }

    refreshActionEstimate();
    return () => {
      cancelled = true;
    };
  }, [
    wallet,
    selectedActionContract,
    contractActionForm.contract,
    contractActionForm.method,
    contractActionForm.gasLimit,
    contractActionArgs.amount,
    contractActionArgs.destinationCountry,
    contractActionArgs.from,
    contractActionArgs.mobileMoneyProvider,
    contractActionArgs.originCountry,
    contractActionArgs.reference,
    contractActionArgs.spender,
    contractActionArgs.to
  ]);

  function requireUnlockedWallet(message = 'Unlock the wallet to sign AfroChain transactions.') {
    if (wallet?.privateKey) {
      return true;
    }

    setStatus(message);
    return false;
  }

  function getValidatedCreatePassphrase() {
    if (securityForm.createPassphrase.length < 8) {
      throw new Error('Use a wallet passphrase with at least 8 characters.');
    }

    if (securityForm.createPassphrase !== securityForm.confirmPassphrase) {
      throw new Error('Wallet passphrase confirmation does not match.');
    }

    return securityForm.createPassphrase;
  }

  function markSessionActivity() {
    setLastInteractionAt(Date.now());
  }

  async function storeEncryptedWallet(nextWallet) {
    const keystorePayload = await encryptWallet(nextWallet, getValidatedCreatePassphrase());
    persistWalletKeystore(keystorePayload);
    setKeystore(keystorePayload);
    setLegacyWallet(null);
    setWallet(nextWallet);
    setExportedKeystoreJson('');
    markSessionActivity();
    setSecurityForm((current) => ({
      ...current,
      currentPassphrase: '',
      confirmPassphrase: '',
      createPassphrase: '',
      importKeystoreJson: '',
      unlockPassphrase: ''
    }));
    return nextWallet;
  }

  async function handleCreateSecureWallet(event) {
    event.preventDefault();

    try {
      setStatus('Creating and encrypting a new AfroChain wallet...');
      const nextWallet = await storeEncryptedWallet(await createWallet('AfroChain Mobile Wallet'));
      setStatus('Created an encrypted wallet and unlocked it for this session.');
      await refresh(nextWallet, {
        preserveStatus: true
      });
    } catch (error) {
      setStatus(`Wallet creation failed: ${error.message}`);
    }
  }

  async function handleSecureLegacyWallet(event) {
    event.preventDefault();

    if (!legacyWallet) {
      return;
    }

    try {
      setStatus('Encrypting the existing wallet with your passphrase...');
      const nextWallet = await storeEncryptedWallet(legacyWallet);
      setStatus('Legacy wallet encrypted and unlocked.');
      await refresh(nextWallet, {
        preserveStatus: true
      });
    } catch (error) {
      setStatus(`Wallet migration failed: ${error.message}`);
    }
  }

  async function handleUnlockWallet(event) {
    event.preventDefault();

    if (!keystore) {
      setStatus('Create a secured wallet before trying to unlock one.');
      return;
    }

    try {
      setStatus('Unlocking wallet...');
      const unlockedWallet = await decryptWallet(keystore, securityForm.unlockPassphrase);
      setWallet(unlockedWallet);
      markSessionActivity();
      setStatus('Wallet unlocked.');
      setSecurityForm((current) => ({
        ...current,
        unlockPassphrase: ''
      }));
      await refresh(unlockedWallet, {
        preserveStatus: true
      });
    } catch (error) {
      setStatus(error.message);
    }
  }

  function handleLockWallet(nextStatus = 'Wallet locked. Unlock to sign transactions.') {
    setWallet(null);
    setPaymentPreview(null);
    setStatus(nextStatus);
  }

  async function handleChangePassphrase(event) {
    event.preventDefault();

    if (!keystore) {
      setStatus('Create or import a keystore before rotating the passphrase.');
      return;
    }

    try {
      setStatus('Re-encrypting wallet with the new passphrase...');
      const nextKeystore = await changeWalletPassphrase(
        keystore,
        securityForm.currentPassphrase,
        getValidatedCreatePassphrase()
      );
      persistWalletKeystore(nextKeystore);
      setKeystore(nextKeystore);
      setExportedKeystoreJson('');
      setSecurityForm((current) => ({
        ...current,
        confirmPassphrase: '',
        createPassphrase: '',
        currentPassphrase: ''
      }));
      setStatus('Wallet passphrase updated.');
    } catch (error) {
      setStatus(`Passphrase update failed: ${error.message}`);
    }
  }

  function handlePrepareKeystoreExport() {
    if (!keystore) {
      setStatus('No keystore is available to export yet.');
      return;
    }

    setExportedKeystoreJson(serializeWalletKeystore(keystore));
    setStatus('Encrypted keystore JSON prepared below.');
  }

  async function handleImportKeystore(event) {
    event.preventDefault();

    try {
      const importedKeystore = parseWalletKeystore(securityForm.importKeystoreJson);
      persistWalletKeystore(importedKeystore);
      setKeystore(importedKeystore);
      setLegacyWallet(null);
      setWallet(null);
      setExportedKeystoreJson('');
      setSecurityForm((current) => ({
        ...current,
        currentPassphrase: '',
        importKeystoreJson: '',
        unlockPassphrase: ''
      }));
      setStatus('Encrypted keystore imported. Unlock it to sign transactions.');
      await refresh(importedKeystore, {
        preserveStatus: true
      });
    } catch (error) {
      setStatus(`Keystore import failed: ${error.message}`);
    }
  }

  async function submitAndRefresh(transactionConfig, nextStatus) {
    if (!requireUnlockedWallet()) {
      return;
    }

    setStatus(nextStatus);

    try {
      const estimatedConfig = await withEstimatedFee(transactionConfig);
      markSessionActivity();
      await client.signAndSubmit(wallet, estimatedConfig);
      await client.produceBlock();
      setPaymentPreview(null);
    } catch (error) {
      if (!String(error.message).includes('selected proposer')) {
        setStatus(`Submission failed: ${error.message}`);
        return;
      }
    }

    await refresh();
  }

  async function withEstimatedFee(transactionConfig) {
    if (!wallet) {
      return {
        ...transactionConfig,
        fee: Number(transactionConfig.fee || DEFAULT_FEE)
      };
    }

    if (transactionConfig.fee) {
      return transactionConfig;
    }

    try {
      const estimate = await client.estimateTransactionCost({
        ...transactionConfig,
        sender: wallet.address
      });

      return {
        ...transactionConfig,
        fee: Math.max(DEFAULT_FEE, Number(estimate.minimumFee || DEFAULT_FEE))
      };
    } catch (_error) {
      return {
        ...transactionConfig,
        fee: DEFAULT_FEE
      };
    }
  }

  function buildPaymentConfig() {
    return {
      payload: {
        amount: parseUnits(sendForm.amount),
        destinationCountry: sendForm.destinationCountry,
        mobileMoneyProvider: sendForm.mobileMoneyProvider,
        originCountry: sendForm.originCountry,
        recipient: sendForm.recipient,
        reference: sendForm.reference
      },
      type: 'payment'
    };
  }

  function buildContractDeployPayload() {
    return contractForm.template === 'merchant_escrow'
      ? {
          args: {
            amount: parseUnits(contractForm.amount),
            buyer: wallet.address,
            merchant: contractForm.counterparty
          },
          name: contractForm.name,
          template: contractForm.template
        }
      : {
          args: {
            contributionAmount: parseUnits(contractForm.amount),
            members: [wallet.address]
          },
          name: contractForm.name,
          template: contractForm.template
        };
  }

  function buildContractDeployConfig() {
    return {
      payload: {
        ...buildContractDeployPayload(),
        gasLimit: Number(contractForm.gasLimit || chain?.defaultContractGasLimit || 30000)
      },
      type: 'contract_deploy'
    };
  }

  function buildContractActionArgsPayload() {
    if (!selectedActionContract) {
      return {};
    }

    if (selectedActionContract.template === 'afrocoin') {
      if (contractActionForm.method === 'approve') {
        return {
          amount: parseUnits(contractActionArgs.amount || '0'),
          spender: contractActionArgs.spender
        };
      }

      if (contractActionForm.method === 'transfer') {
        return {
          amount: parseUnits(contractActionArgs.amount || '0'),
          destinationCountry: contractActionArgs.destinationCountry,
          mobileMoneyProvider: contractActionArgs.mobileMoneyProvider,
          originCountry: contractActionArgs.originCountry,
          reference: contractActionArgs.reference,
          to: contractActionArgs.to
        };
      }

      if (contractActionForm.method === 'transferFrom') {
        return {
          amount: parseUnits(contractActionArgs.amount || '0'),
          destinationCountry: contractActionArgs.destinationCountry,
          from: contractActionArgs.from || wallet.address,
          mobileMoneyProvider: contractActionArgs.mobileMoneyProvider,
          originCountry: contractActionArgs.originCountry,
          reference: contractActionArgs.reference,
          to: contractActionArgs.to
        };
      }
    }

    return {};
  }

  function buildContractActionConfig() {
    return {
      payload: {
        args: buildContractActionArgsPayload(),
        contract: contractActionForm.contract,
        gasLimit: Number(contractActionForm.gasLimit || chain?.defaultContractGasLimit || 30000),
        method: contractActionForm.method
      },
      type: 'contract_call'
    };
  }

  async function handlePreviewPayment() {
    if (!requireUnlockedWallet('Unlock the wallet before simulating a signed payment.')) {
      return;
    }

    try {
      const preview = await client.signAndSimulate(wallet, await withEstimatedFee(buildPaymentConfig()));
      setPaymentPreview(preview);
      setStatus('Payment simulation ready.');
    } catch (error) {
      setStatus(`Preview failed: ${error.message}`);
    }
  }

  async function handleSend(event) {
    event.preventDefault();
    await submitAndRefresh(buildPaymentConfig(), 'Broadcasting AFC payment...');
  }

  async function handleFaucet() {
    if (!requireUnlockedWallet('Unlock the wallet before requesting faucet funds.')) {
      return;
    }

    try {
      setStatus('Requesting faucet support for this wallet...');
      const result = await client.requestFaucet(wallet.address, parseUnits('500'), {
        label: wallet.label,
        note: 'Mobile wallet bootstrap'
      });
      setStatus(
        result.status === 'confirmed'
          ? `Faucet confirmed in block ${result.blockHeight}.`
          : 'Faucet request queued for the next block.'
      );
      markSessionActivity();
      await refresh(undefined, {
        preserveStatus: true
      });
    } catch (error) {
      setStatus(`Faucet request failed: ${error.message}`);
    }
  }

  async function handleStake(event) {
    event.preventDefault();

    await submitAndRefresh(
      {
        payload: {
          action: stakeForm.action,
          amount: parseUnits(stakeForm.amount),
          commissionRate: Number(stakeForm.commissionRate),
          endpoint: stakeForm.endpoint,
          name: stakeForm.name,
          region: stakeForm.region,
          validator: stakeForm.validator
        },
        type: 'stake'
      },
      'Updating stake and validator state...'
    );
  }

  function updateProposalGrant(index, field, value) {
    setProposalGrants((current) =>
      current.map((grant, grantIndex) => (grantIndex === index ? { ...grant, [field]: value } : grant))
    );
  }

  function handleAddProposalGrant() {
    setProposalGrants((current) => [
      ...current,
      createGrantDraft(treasury?.topTreasuryAccounts?.[0]?.address || current[0]?.source || 'afc_community_grants')
    ]);
  }

  function handleRemoveProposalGrant(index) {
    setProposalGrants((current) => (current.length > 1 ? current.filter((_, grantIndex) => grantIndex !== index) : current));
  }

  async function handleCreateProposal(event) {
    event.preventDefault();

    const payload =
      proposalForm.category === 'treasury'
        ? {
            category: 'treasury',
            grants: proposalGrants.map((grant) => ({
              amount: parseUnits(grant.amount),
              cliffBlocks: Number(grant.cliffBlocks || 0),
              label: grant.label,
              note: grant.note,
              recipient: grant.recipient,
              source: grant.source,
              vestingBlocks: Number(grant.vestingBlocks || 0)
            })),
            summary: proposalForm.summary,
            title: proposalForm.title
          }
        : {
            category: 'protocol',
            changes: [
              {
                parameter: proposalForm.parameter,
                value:
                  proposalForm.parameter === 'baseFee'
                    ? 250
                    : proposalForm.parameter === 'targetBlockTimeMs'
                      ? 12000
                      : proposalForm.parameter === 'contractGasPrice'
                        ? 4
                        : proposalForm.parameter === 'defaultContractGasLimit'
                          ? 40000
                          : proposalForm.parameter === 'finalityDepth'
                            ? 3
                            : parseUnits('200000')
              }
            ],
            summary: proposalForm.summary,
            title: proposalForm.title
          };

    await submitAndRefresh(
      {
        payload,
        type: 'proposal'
      },
      'Submitting DAO proposal...'
    );
  }

  async function handleVote(proposalId, choice) {
    await submitAndRefresh(
      {
        payload: {
          choice,
          proposalId
        },
        type: 'vote'
      },
      `Casting ${choice} vote...`
    );
  }

  async function handleDeployContract(event) {
    event.preventDefault();

    await submitAndRefresh(buildContractDeployConfig(), 'Deploying smart contract template...');
  }

  async function handleContractAction(event) {
    event.preventDefault();

    if (!contractActionForm.contract) {
      setStatus('Select a contract first.');
      return;
    }

    await submitAndRefresh(buildContractActionConfig(), 'Broadcasting contract action...');
  }

  async function handleResetWallet() {
    if (!requireUnlockedWallet('Unlock the wallet before rotating it.')) {
      return;
    }

    try {
      setStatus('Generating a fresh encrypted wallet profile...');
      const nextWallet = await storeEncryptedWallet(await createWallet('AfroChain Mobile Wallet'));
      setStatus('Created a fresh encrypted wallet profile.');
      await refresh(nextWallet, {
        preserveStatus: true
      });
    } catch (error) {
      setStatus(`Wallet rotation failed: ${error.message}`);
    }
  }

  return (
    <main className="wallet-shell">
      <section className="hero-card">
        <div>
          <p className="eyebrow">AfroChain Wallet</p>
          <h1>Low-fee AFC payments, staking, governance, and contract launch tools.</h1>
          <p className="lede">
            This reference wallet now covers operator-grade flows too: faucet bootstrap, payment simulation, account
            activity, no-code contract actions for savings circles and merchant escrow, and encrypted local key storage.
          </p>
        </div>
        <div className="hero-actions">
          <button className="secondary-button" type="button" onClick={handleFaucet} disabled={!wallet}>
            Request Faucet
          </button>
          {wallet ? (
            <button className="secondary-button" type="button" onClick={handleLockWallet}>
              Lock Wallet
            </button>
          ) : null}
        </div>
      </section>

      <section className="content-grid">
        {!keystore && !legacyWallet ? (
          <form className="panel stack" onSubmit={handleCreateSecureWallet}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">Wallet Security</p>
                <h2>Create Encrypted Wallet</h2>
              </div>
            </div>
            <p>Generate a new AfroChain wallet and encrypt the signing key locally with your passphrase.</p>
            <label>
              Passphrase
              <input
                type="password"
                value={securityForm.createPassphrase}
                onChange={(event) => setSecurityForm({ ...securityForm, createPassphrase: event.target.value })}
              />
            </label>
            <label>
              Confirm Passphrase
              <input
                type="password"
                value={securityForm.confirmPassphrase}
                onChange={(event) => setSecurityForm({ ...securityForm, confirmPassphrase: event.target.value })}
              />
            </label>
            <button className="primary-button" type="submit">
              Create Secured Wallet
            </button>
          </form>
        ) : null}

        {legacyWallet ? (
          <form className="panel stack" onSubmit={handleSecureLegacyWallet}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">Security Upgrade</p>
                <h2>Encrypt Existing Wallet</h2>
              </div>
            </div>
            <p>
              A legacy wallet was found in plain local storage. Set a passphrase now to migrate it into encrypted
              keystore storage.
            </p>
            <label>
              New Passphrase
              <input
                type="password"
                value={securityForm.createPassphrase}
                onChange={(event) => setSecurityForm({ ...securityForm, createPassphrase: event.target.value })}
              />
            </label>
            <label>
              Confirm Passphrase
              <input
                type="password"
                value={securityForm.confirmPassphrase}
                onChange={(event) => setSecurityForm({ ...securityForm, confirmPassphrase: event.target.value })}
              />
            </label>
            <button className="primary-button" type="submit">
              Encrypt Existing Wallet
            </button>
          </form>
        ) : null}

        {keystore && !wallet ? (
          <form className="panel stack" onSubmit={handleUnlockWallet}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">Wallet Security</p>
                <h2>Unlock Wallet</h2>
              </div>
            </div>
            <p>Unlocking only restores the private key to memory for this browser session.</p>
            <label>
              Passphrase
              <input
                type="password"
                value={securityForm.unlockPassphrase}
                onChange={(event) => setSecurityForm({ ...securityForm, unlockPassphrase: event.target.value })}
              />
            </label>
            <button className="primary-button" type="submit">
              Unlock Wallet
            </button>
          </form>
        ) : null}

        {keystore && wallet ? (
          <form className="panel stack" onSubmit={handleChangePassphrase}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">Session Security</p>
                <h2>Unlocked Session</h2>
              </div>
            </div>
            <p>
              The wallet is unlocked in memory. Rotate the passphrase without changing the address, choose an
              inactivity timeout, or export the encrypted keystore below.
            </p>
            <label>
              Current Passphrase
              <input
                type="password"
                value={securityForm.currentPassphrase}
                onChange={(event) => setSecurityForm({ ...securityForm, currentPassphrase: event.target.value })}
              />
            </label>
            <label>
              New Passphrase
              <input
                type="password"
                value={securityForm.createPassphrase}
                onChange={(event) => setSecurityForm({ ...securityForm, createPassphrase: event.target.value })}
              />
            </label>
            <label>
              Confirm New Passphrase
              <input
                type="password"
                value={securityForm.confirmPassphrase}
                onChange={(event) => setSecurityForm({ ...securityForm, confirmPassphrase: event.target.value })}
              />
            </label>
            <label>
              Auto-Lock Minutes
              <input
                value={securityForm.sessionTimeoutMinutes}
                onChange={(event) => setSecurityForm({ ...securityForm, sessionTimeoutMinutes: event.target.value })}
              />
            </label>
            <div className="hero-actions">
              <button className="secondary-button" type="submit">
                Change Passphrase
              </button>
              <button className="secondary-button" type="button" onClick={handlePrepareKeystoreExport}>
                Export Keystore
              </button>
              <button className="secondary-button" type="button" onClick={handleLockWallet}>
                Lock Session
              </button>
              <button className="secondary-button" type="button" onClick={handleResetWallet}>
                Rotate Wallet
              </button>
            </div>
            {exportedKeystoreJson ? (
              <label>
                Encrypted Keystore JSON
                <textarea rows="8" value={exportedKeystoreJson} readOnly />
              </label>
            ) : null}
          </form>
        ) : null}

        {!legacyWallet ? (
          <form className="panel stack" onSubmit={handleImportKeystore}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">Keystore Import</p>
                <h2>Load Existing Wallet</h2>
              </div>
            </div>
            <p>Paste an encrypted AfroChain keystore JSON payload to replace the locally stored wallet.</p>
            <label>
              Keystore JSON
              <textarea
                rows="8"
                value={securityForm.importKeystoreJson}
                onChange={(event) => setSecurityForm({ ...securityForm, importKeystoreJson: event.target.value })}
              />
            </label>
            <button className="primary-button" type="submit">
              Import Keystore
            </button>
          </form>
        ) : null}
      </section>

      <section className="panel balance-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Account</p>
            <h2>{activeLabel || 'Preparing wallet'}</h2>
          </div>
          <span className="status-pill">{status}</span>
        </div>
        <div className="account-grid">
          <article className="metric-card highlight">
            <span>Spendable AFC</span>
            <strong>{formatAfc(account?.balance)}</strong>
          </article>
          <article className="metric-card">
            <span>Staking Power</span>
            <strong>{formatAfc(account?.stakingPower)}</strong>
          </article>
          <article className="metric-card">
            <span>Reward Balance</span>
            <strong>{formatAfc(account?.rewards)}</strong>
          </article>
          <article className="metric-card">
            <span>Faucet Max</span>
            <strong>{formatAfc(faucet?.maxAmount)}</strong>
          </article>
        </div>
        <div className="account-grid compact">
          <article className="metric-card">
            <span>Chain Height</span>
            <strong>{chain?.height ?? '-'}</strong>
          </article>
          <article className="metric-card">
            <span>Finalized Height</span>
            <strong>{finality?.finalizedHeight ?? chain?.finalizedHeight ?? '-'}</strong>
          </article>
          <article className="metric-card">
            <span>Contract Gas Price</span>
            <strong>{chain?.contractGasPrice ?? '-'}</strong>
          </article>
          <article className="metric-card">
            <span>Community Grants</span>
            <strong>{formatAfc(treasury?.topTreasuryAccounts?.find((account) => account.address === 'afc_community_grants')?.balance)}</strong>
          </article>
        </div>
        <code className="address-chip">{activeAddress || 'No wallet loaded yet'}</code>
      </section>

      <section className="content-grid">
        <form className="panel stack" onSubmit={handleSend}>
          <div className="panel-header">
            <div>
              <p className="eyebrow">Cross-Border Transfer</p>
              <h2>Send AfroCoin</h2>
            </div>
            <button className="secondary-button" type="button" onClick={handlePreviewPayment}>
              Simulate
            </button>
          </div>
          <label>
            Recipient
            <input
              value={sendForm.recipient}
              onChange={(event) => setSendForm({ ...sendForm, recipient: event.target.value })}
            />
          </label>
          <label>
            Amount (AFC)
            <input
              value={sendForm.amount}
              onChange={(event) => setSendForm({ ...sendForm, amount: event.target.value })}
            />
          </label>
          <div className="two-column">
            <label>
              From
              <input
                value={sendForm.originCountry}
                onChange={(event) => setSendForm({ ...sendForm, originCountry: event.target.value })}
              />
            </label>
            <label>
              To
              <input
                value={sendForm.destinationCountry}
                onChange={(event) => setSendForm({ ...sendForm, destinationCountry: event.target.value })}
              />
            </label>
          </div>
          <label>
            Mobile Money Rail
            <input
              value={sendForm.mobileMoneyProvider}
              onChange={(event) => setSendForm({ ...sendForm, mobileMoneyProvider: event.target.value })}
            />
          </label>
          <label>
            Reference
            <input
              value={sendForm.reference}
              onChange={(event) => setSendForm({ ...sendForm, reference: event.target.value })}
            />
          </label>
          <button className="primary-button" type="submit">
            Send AFC
          </button>
          {paymentPreview ? (
            <article className="proposal-card">
              <div>
                <div className="proposal-meta">
                  <span>Preview</span>
                  <span>Block {paymentPreview.previewBlockHeight}</span>
                  <span>Fee {formatAfc(paymentPreview.receipt?.minimumFee)} AFC</span>
                </div>
                <h3>Simulation result</h3>
                <p>
                  {paymentPreview.accounts
                    .map((item) => `${item.label || item.address}: ${formatAfc(item.balance)} AFC`)
                    .join(' / ')}
                </p>
              </div>
            </article>
          ) : null}
        </form>

        <form className="panel stack" onSubmit={handleStake}>
          <div className="panel-header">
            <div>
              <p className="eyebrow">Proof of Stake</p>
              <h2>Stake or Validate</h2>
            </div>
          </div>
          <label>
            Action
            <select
              value={stakeForm.action}
              onChange={(event) => setStakeForm({ ...stakeForm, action: event.target.value })}
            >
              <option value="delegate">Delegate</option>
              <option value="register_validator">Register Validator</option>
              <option value="claim_rewards">Claim Rewards</option>
            </select>
          </label>
          {stakeForm.action !== 'claim_rewards' ? (
            <>
              <label>
                Amount (AFC)
                <input
                  value={stakeForm.amount}
                  onChange={(event) => setStakeForm({ ...stakeForm, amount: event.target.value })}
                />
              </label>
              <label>
                Validator
                <select
                  value={stakeForm.validator}
                  onChange={(event) => setStakeForm({ ...stakeForm, validator: event.target.value })}
                >
                  {validators.map((validator) => (
                    <option key={validator.address} value={validator.address}>
                      {validator.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          {stakeForm.action === 'register_validator' ? (
            <>
              <label>
                Validator Name
                <input
                  value={stakeForm.name}
                  onChange={(event) => setStakeForm({ ...stakeForm, name: event.target.value })}
                />
              </label>
              <div className="two-column">
                <label>
                  Region
                  <input
                    value={stakeForm.region}
                    onChange={(event) => setStakeForm({ ...stakeForm, region: event.target.value })}
                  />
                </label>
                <label>
                  Commission
                  <input
                    value={stakeForm.commissionRate}
                    onChange={(event) => setStakeForm({ ...stakeForm, commissionRate: event.target.value })}
                  />
                </label>
              </div>
              <label>
                Endpoint
                <input
                  value={stakeForm.endpoint}
                  onChange={(event) => setStakeForm({ ...stakeForm, endpoint: event.target.value })}
                />
              </label>
            </>
          ) : null}
          <button className="primary-button" type="submit">
            Submit Stake Action
          </button>
        </form>
      </section>

      <section className="content-grid">
        <form className="panel stack" onSubmit={handleDeployContract}>
          <div className="panel-header">
            <div>
              <p className="eyebrow">Smart Contracts</p>
              <h2>Deploy dApp template</h2>
            </div>
          </div>
          <label>
            Template
            <select
              value={contractForm.template}
              onChange={(event) =>
                setContractForm({
                  ...contractForm,
                  gasLimit: contractForm.gasLimit || String(chain?.defaultContractGasLimit || 30000),
                  template: event.target.value
                })
              }
            >
              <option value="savings_circle">Savings Circle</option>
              <option value="merchant_escrow">Merchant Escrow</option>
            </select>
          </label>
          <label>
            Contract Name
            <input
              value={contractForm.name}
              onChange={(event) => setContractForm({ ...contractForm, name: event.target.value })}
            />
          </label>
          <label>
            Amount (AFC)
            <input
              value={contractForm.amount}
              onChange={(event) => setContractForm({ ...contractForm, amount: event.target.value })}
            />
          </label>
          <label>
            Counterparty / Merchant
            <input
              value={contractForm.counterparty}
              onChange={(event) => setContractForm({ ...contractForm, counterparty: event.target.value })}
            />
          </label>
          <label>
            Gas Limit
            <input
              value={contractForm.gasLimit}
              onChange={(event) => setContractForm({ ...contractForm, gasLimit: event.target.value })}
            />
          </label>
          <button className="primary-button" type="submit" disabled={Boolean(contractDeploymentEstimateError)}>
            Deploy Contract
          </button>
          {selectedDeployTemplate ? (
            <article className="proposal-card">
              <div>
                <div className="proposal-meta">
                  <span>{selectedDeployTemplate.label}</span>
                  <span>{deployGasDisplay} gas</span>
                </div>
                <h3>Deployment estimate</h3>
                <p>Estimated minimum fee: {formatAfc(deployFeeDisplay)} AFC</p>
                {contractDeploymentEstimate ? <p>Gas limit: {contractDeploymentEstimate.gasLimit}</p> : null}
                {contractDeploymentEstimateError ? <p>{contractDeploymentEstimateError}</p> : null}
              </div>
            </article>
          ) : null}
          <div className="list">
            {ownedContracts.slice(0, 3).map((contract) => (
              <article className="list-card" key={contract.address}>
                <div>
                  <h3>{contract.name}</h3>
                  <p>{contract.template}</p>
                </div>
                <span>{formatAfc(contract.balance)} AFC</span>
              </article>
            ))}
          </div>
        </form>

        <div className="stack">
          <form className="panel stack" onSubmit={handleCreateProposal}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">DAO Governance</p>
                <h2>Create Proposal</h2>
              </div>
            </div>
            <label>
              Category
              <select
                value={proposalForm.category}
                onChange={(event) => setProposalForm({ ...proposalForm, category: event.target.value })}
              >
                <option value="protocol">Protocol</option>
                <option value="treasury">Treasury Grant</option>
              </select>
            </label>
            <label>
              Title
              <input
                value={proposalForm.title}
                onChange={(event) => setProposalForm({ ...proposalForm, title: event.target.value })}
              />
            </label>
            <label>
              Summary
              <textarea
                rows="4"
                value={proposalForm.summary}
                onChange={(event) => setProposalForm({ ...proposalForm, summary: event.target.value })}
              />
            </label>
            {proposalForm.category === 'protocol' ? (
              <label>
                Parameter
                <select
                  value={proposalForm.parameter}
                  onChange={(event) => setProposalForm({ ...proposalForm, parameter: event.target.value })}
                >
                  <option value="baseFee">baseFee</option>
                  <option value="targetBlockTimeMs">targetBlockTimeMs</option>
                  <option value="minValidatorStake">minValidatorStake</option>
                  <option value="contractGasPrice">contractGasPrice</option>
                  <option value="defaultContractGasLimit">defaultContractGasLimit</option>
                  <option value="finalityDepth">finalityDepth</option>
                </select>
              </label>
            ) : (
              <>
                <div className="proposal-meta">
                  <span>{proposalGrants.length} grants</span>
                  <span>{proposalGrantTotal} AFC total</span>
                  <span>{proposalVestingGrantCount} vested schedules</span>
                </div>
                {proposalGrants.map((grant, index) => (
                  <article className="proposal-card nested-card" key={`grant-${index}`}>
                    <div className="panel-header">
                      <div>
                        <h3>Grant #{index + 1}</h3>
                        <p>Use vesting blocks to stream releases over time after proposal approval.</p>
                      </div>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => handleRemoveProposalGrant(index)}
                        disabled={proposalGrants.length === 1}
                      >
                        Remove
                      </button>
                    </div>
                    <label>
                      Grant Source
                      <select value={grant.source} onChange={(event) => updateProposalGrant(index, 'source', event.target.value)}>
                        {(treasury?.topTreasuryAccounts || []).map((account) => (
                          <option key={account.address} value={account.address}>
                            {account.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Recipient
                      <input value={grant.recipient} onChange={(event) => updateProposalGrant(index, 'recipient', event.target.value)} />
                    </label>
                    <div className="two-column">
                      <label>
                        Grant Amount (AFC)
                        <input value={grant.amount} onChange={(event) => updateProposalGrant(index, 'amount', event.target.value)} />
                      </label>
                      <label>
                        Recipient Label
                        <input value={grant.label} onChange={(event) => updateProposalGrant(index, 'label', event.target.value)} />
                      </label>
                    </div>
                    <div className="two-column">
                      <label>
                        Vesting Blocks
                        <input
                          value={grant.vestingBlocks}
                          onChange={(event) => updateProposalGrant(index, 'vestingBlocks', event.target.value)}
                        />
                      </label>
                      <label>
                        Cliff Blocks
                        <input value={grant.cliffBlocks} onChange={(event) => updateProposalGrant(index, 'cliffBlocks', event.target.value)} />
                      </label>
                    </div>
                    <label>
                      Grant Note
                      <input value={grant.note} onChange={(event) => updateProposalGrant(index, 'note', event.target.value)} />
                    </label>
                  </article>
                ))}
                <button className="secondary-button" type="button" onClick={handleAddProposalGrant}>
                  Add Grant
                </button>
              </>
            )}
            <button className="primary-button" type="submit">
              Publish Proposal
            </button>
          </form>

          <form className="panel stack" onSubmit={handleContractAction}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">Contract Actions</p>
                <h2>Use deployed contracts</h2>
              </div>
            </div>
            <label>
              Contract
              <select
                value={contractActionForm.contract}
                onChange={(event) => {
                  const nextContract = contracts.find((contract) => contract.address === event.target.value) || null;
                  const nextMethod = getDefaultContractMethod(nextContract?.template, contractTemplates);

                  setContractActionForm((current) => ({
                    ...current,
                    contract: event.target.value,
                    method: nextMethod
                  }));
                }}
              >
                {contracts.map((contract) => (
                  <option key={contract.address} value={contract.address}>
                    {contract.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Method
              <select
                value={contractActionForm.method}
                onChange={(event) => setContractActionForm({ ...contractActionForm, method: event.target.value })}
              >
                {contractMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            {selectedActionContract?.template === 'afrocoin' && contractActionForm.method === 'approve' ? (
              <>
                <label>
                  Spender
                  <input
                    value={contractActionArgs.spender}
                    onChange={(event) => setContractActionArgs({ ...contractActionArgs, spender: event.target.value })}
                  />
                </label>
                <label>
                  Amount (AFC)
                  <input
                    value={contractActionArgs.amount}
                    onChange={(event) => setContractActionArgs({ ...contractActionArgs, amount: event.target.value })}
                  />
                </label>
              </>
            ) : null}
            {selectedActionContract?.template === 'afrocoin' &&
            ['transfer', 'transferFrom'].includes(contractActionForm.method) ? (
              <>
                {contractActionForm.method === 'transferFrom' ? (
                  <label>
                    From
                    <input
                      value={contractActionArgs.from}
                      onChange={(event) => setContractActionArgs({ ...contractActionArgs, from: event.target.value })}
                    />
                  </label>
                ) : null}
                <label>
                  Recipient
                  <input value={contractActionArgs.to} onChange={(event) => setContractActionArgs({ ...contractActionArgs, to: event.target.value })} />
                </label>
                <label>
                  Amount (AFC)
                  <input
                    value={contractActionArgs.amount}
                    onChange={(event) => setContractActionArgs({ ...contractActionArgs, amount: event.target.value })}
                  />
                </label>
                <div className="two-column">
                  <label>
                    From Country
                    <input
                      value={contractActionArgs.originCountry}
                      onChange={(event) => setContractActionArgs({ ...contractActionArgs, originCountry: event.target.value })}
                    />
                  </label>
                  <label>
                    To Country
                    <input
                      value={contractActionArgs.destinationCountry}
                      onChange={(event) =>
                        setContractActionArgs({ ...contractActionArgs, destinationCountry: event.target.value })
                      }
                    />
                  </label>
                </div>
                <label>
                  Mobile Money Rail
                  <input
                    value={contractActionArgs.mobileMoneyProvider}
                    onChange={(event) =>
                      setContractActionArgs({ ...contractActionArgs, mobileMoneyProvider: event.target.value })
                    }
                  />
                </label>
                <label>
                  Reference
                  <input
                    value={contractActionArgs.reference}
                    onChange={(event) => setContractActionArgs({ ...contractActionArgs, reference: event.target.value })}
                  />
                </label>
              </>
            ) : null}
            <label>
              Gas Limit
              <input
                value={contractActionForm.gasLimit}
                onChange={(event) => setContractActionForm({ ...contractActionForm, gasLimit: event.target.value })}
              />
            </label>
            <button className="primary-button" type="submit" disabled={!contractMethods.length || Boolean(contractActionEstimateError)}>
              Run Contract Method
            </button>
            {selectedActionTemplate ? (
              <article className="proposal-card">
                <div>
                  <div className="proposal-meta">
                    <span>{selectedActionTemplate.label}</span>
                    <span>{actionGasDisplay} gas</span>
                  </div>
                  <h3>Method estimate</h3>
                  <p>Estimated minimum fee: {formatAfc(actionFeeDisplay)} AFC</p>
                  {contractActionEstimate ? <p>Gas limit: {contractActionEstimate.gasLimit}</p> : null}
                  {contractActionEstimateError ? <p>{contractActionEstimateError}</p> : null}
                </div>
              </article>
            ) : null}
          </form>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel stack">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Account Activity</p>
              <h2>Recent wallet events</h2>
            </div>
          </div>
          <div className="list">
            {activity.length ? (
              activity.map((entry) => (
                <article className="proposal-card" key={entry.id}>
                  <div>
                    <div className="proposal-meta">
                      <span>{entry.type}</span>
                      <span>{entry.amount ? `${formatAfc(entry.amount)} AFC` : 'state update'}</span>
                      {entry.gasUsed ? <span>{entry.gasUsed} gas</span> : null}
                    </div>
                    <h3>{entry.summary}</h3>
                    <p>{entry.corridor || entry.sender}</p>
                    <p>{entry.finalized ? 'Finalized' : 'Awaiting finality'}</p>
                  </div>
                </article>
              ))
            ) : (
              <article className="list-card empty-state">
                <p>Once this wallet sends payments, stakes, or uses contracts, activity will appear here.</p>
              </article>
            )}
          </div>
        </div>

        <div className="panel stack">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Validators & DAO</p>
              <h2>Network participation</h2>
            </div>
          </div>
          <div className="list">
            {validators.slice(0, 4).map((validator) => (
              <article className="list-card" key={validator.address}>
                <div>
                  <h3>{validator.name}</h3>
                  <p>
                    {validator.region} / {formatAfc(validator.totalStake)} AFC staked
                  </p>
                </div>
                <span>{Math.round(validator.commissionRate * 100)}% commission</span>
              </article>
            ))}
            {proposals.length ? (
              proposals.map((proposal) => (
                <article className="proposal-card" key={proposal.id}>
                  <div>
                    <div className="proposal-meta">
                      <span>{proposal.status}</span>
                      <span>{proposal.category}</span>
                      <span>Ends at block {proposal.endHeight}</span>
                    </div>
                    <h3>{proposal.title}</h3>
                    <p>{proposal.summary}</p>
                    {proposal.grantVolume ? <p>Grant volume: {formatAfc(proposal.grantVolume)} AFC</p> : null}
                    {proposal.vestingGrantCount ? <p>{proposal.vestingGrantCount} grant schedules use vesting.</p> : null}
                    {proposal.grantSchedules?.length ? <p>{proposal.grantSchedules.length} vesting schedules approved.</p> : null}
                    {proposal.executionError ? <p>{proposal.executionError}</p> : null}
                  </div>
                  <div className="vote-strip">
                    <button type="button" onClick={() => handleVote(proposal.id, 'for')}>
                      Vote For
                    </button>
                    <button type="button" onClick={() => handleVote(proposal.id, 'against')}>
                      Vote Against
                    </button>
                    <button type="button" onClick={() => handleVote(proposal.id, 'abstain')}>
                      Abstain
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <article className="list-card empty-state">
                <p>No proposals have been published yet. Use the form above to launch the first DAO vote.</p>
              </article>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
