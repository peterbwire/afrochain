import { createUnsignedTransaction, signTransaction } from './wallet.js';

export class AfroChainClient {
  constructor(options = 'http://localhost:4100') {
    const normalizedOptions =
      typeof options === 'string'
        ? {
            baseUrl: options
          }
        : options || {};

    this.baseUrl = (normalizedOptions.baseUrl || 'http://localhost:4100').replace(/\/$/, '');
    this.operatorToken = normalizedOptions.operatorToken || null;
    this.peerToken = normalizedOptions.peerToken || null;
  }

  buildAuthHeaders(authRole) {
    if (authRole === 'operator' && this.operatorToken) {
      return {
        'x-afrochain-operator-token': this.operatorToken
      };
    }

    if (authRole === 'peer' && this.peerToken) {
      return {
        'x-afrochain-peer-token': this.peerToken
      };
    }

    return {};
  }

  async request(path, options = {}) {
    const { authRole = null, headers = {}, ...requestOptions } = options;
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        'content-type': 'application/json',
        ...this.buildAuthHeaders(authRole),
        ...headers
      },
      ...requestOptions
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || `AfroChain request failed with status ${response.status}.`);
    }

    return payload;
  }

  getHealth() {
    return this.request('/health');
  }

  getChain() {
    return this.request('/chain');
  }

  getMetrics() {
    return this.request('/metrics');
  }

  getNetwork() {
    return this.request('/network');
  }

  getFinality() {
    return this.request('/finality');
  }

  getDatabaseStatus() {
    return this.request('/database');
  }

  getTreasury() {
    return this.request('/treasury');
  }

  getFaucet() {
    return this.request('/faucet');
  }

  getMempool(limit = 50) {
    return this.request(`/mempool?limit=${limit}`);
  }

  getActivity(limit = 50) {
    return this.request(`/activity?limit=${limit}`);
  }

  getCorridors(limit = 20) {
    return this.request(`/corridors?limit=${limit}`);
  }

  search(query) {
    return this.request(`/search?q=${encodeURIComponent(query)}`);
  }

  getBlocks(limit = 20) {
    return this.request(`/blocks?limit=${limit}`);
  }

  getTransactions(limit = 50) {
    return this.request(`/transactions?limit=${limit}`);
  }

  getAccount(address) {
    return this.request(`/accounts/${address}`);
  }

  getAccountActivity(address, limit = 20) {
    return this.request(`/accounts/${address}/activity?limit=${limit}`);
  }

  getValidators() {
    return this.request('/validators');
  }

  getStaking() {
    return this.request('/staking');
  }

  getProposals() {
    return this.request('/proposals');
  }

  getContracts() {
    return this.request('/contracts');
  }

  getContractTemplates() {
    return this.request('/contracts/templates');
  }

  getContractActivity(address, limit = 20) {
    return this.request(`/contracts/${address}/activity?limit=${limit}`);
  }

  getPeers() {
    return this.request('/peers');
  }

  exportSnapshot() {
    return this.request('/snapshots/export', {
      authRole: 'operator'
    });
  }

  submitTransaction(transaction) {
    return this.request('/transactions', {
      body: JSON.stringify(transaction),
      method: 'POST'
    });
  }

  produceBlock() {
    return this.request('/blocks/produce', {
      authRole: 'operator',
      body: JSON.stringify({}),
      method: 'POST'
    });
  }

  simulateTransaction(transaction) {
    return this.request('/transactions/simulate', {
      body: JSON.stringify(transaction),
      method: 'POST'
    });
  }

  estimateTransactionCost(transaction) {
    return this.request('/transactions/estimate', {
      body: JSON.stringify(transaction),
      method: 'POST'
    });
  }

  requestFaucet(address, amount, options = {}) {
    return this.request('/faucet', {
      authRole: 'operator',
      body: JSON.stringify({
        ...options,
        address,
        amount
      }),
      method: 'POST'
    });
  }

  addPeer(peer) {
    return this.request('/peers', {
      authRole: 'operator',
      body: JSON.stringify(peer),
      method: 'POST'
    });
  }

  probePeers(options = {}) {
    return this.request('/peers/probe', {
      authRole: 'operator',
      body: JSON.stringify(options),
      method: 'POST'
    });
  }

  restorePeer(url) {
    return this.request('/peers/restore', {
      authRole: 'operator',
      body: JSON.stringify({
        url
      }),
      method: 'POST'
    });
  }

  saveSnapshot(path) {
    return this.request('/snapshots/save', {
      authRole: 'operator',
      body: JSON.stringify({
        path
      }),
      method: 'POST'
    });
  }

  importSnapshot(snapshot) {
    return this.request('/snapshots/import', {
      authRole: 'operator',
      body: JSON.stringify(snapshot),
      method: 'POST'
    });
  }

  syncNetwork(options = {}) {
    return this.request('/network/sync', {
      authRole: 'operator',
      body: JSON.stringify(options),
      method: 'POST'
    });
  }

  gossipNetwork(options = {}) {
    return this.request('/network/gossip', {
      authRole: 'operator',
      body: JSON.stringify(options),
      method: 'POST'
    });
  }

  async getNextNonce(address) {
    const account = await this.getAccount(address);
    return Number(account.nonce || 0) + 1;
  }

  async signAndSubmit(wallet, transactionConfig) {
    const nonce = transactionConfig.nonce || (await this.getNextNonce(wallet.address));
    const unsignedTransaction = createUnsignedTransaction({
      ...transactionConfig,
      nonce,
      publicKey: wallet.publicKey,
      sender: wallet.address
    });
    const signedTransaction = await signTransaction(unsignedTransaction, wallet.privateKey);
    return this.submitTransaction(signedTransaction);
  }

  async signAndSimulate(wallet, transactionConfig) {
    const nonce = transactionConfig.nonce || (await this.getNextNonce(wallet.address));
    const unsignedTransaction = createUnsignedTransaction({
      ...transactionConfig,
      nonce,
      publicKey: wallet.publicKey,
      sender: wallet.address
    });
    const signedTransaction = await signTransaction(unsignedTransaction, wallet.privateKey);
    return this.simulateTransaction(signedTransaction);
  }
}
