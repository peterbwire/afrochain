import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';

import {
  createContractInstance,
  estimateContractCallGas,
  estimateContractDeployGas,
  executeContractCall,
  getAllowanceExposure,
  readContract as readContractState,
  summarizeContractPortfolio
} from './contracts/templates.js';
import { createTransactionId, isValidAddress, verifyTransactionSignature } from './crypto.js';
import { createDatabase } from './database.js';
import { createGenesisState } from './genesis.js';
import { createProposal, finalizeProposals, processTreasuryGrantVesting, voteOnProposal } from './governance.js';
import { syncNodeWithPeers } from './peer-sync.js';
import { finalizeSnapshot, loadSnapshotFile, saveSnapshotFile, verifySnapshotEnvelope } from './persistence.js';
import {
  applyStakeTransaction,
  distributeBlockRewards,
  getAccountStakedAmount,
  getTotalActiveStake,
  processPendingWithdrawals,
  selectProposer
} from './staking.js';
import { corridorKey, deepClone, nowIso, sha256Hex, stableStringify, sumRecord } from './utils.js';

function toHashableTransaction(transaction) {
  const {
    blockHeight,
    proposer,
    receipt,
    receivedAt,
    result,
    source,
    status,
    ...hashableTransaction
  } = transaction;

  return hashableTransaction;
}

function toHashableBlock(block) {
  return {
    height: block.height,
    previousHash: block.previousHash,
    proposer: block.proposer,
    stateRoot: block.stateRoot,
    timestamp: block.timestamp,
    transactions: block.transactions.map(toHashableTransaction)
  };
}

function normalizePeerInput(peerInput) {
  if (!peerInput) {
    return null;
  }

  if (typeof peerInput === 'string') {
    return {
      label: null,
      region: null,
      transport: /^tcp:\/\//i.test(peerInput) ? 'socket' : 'http',
      url: peerInput
    };
  }

  if (!peerInput.url) {
    return null;
  }

  return {
    label: peerInput.label || null,
    region: peerInput.region || null,
    transport: peerInput.transport || (/^tcp:\/\//i.test(peerInput.url) ? 'socket' : 'http'),
    url: peerInput.url
  };
}

function summarizeStatusCounts(items, selectKey) {
  return items.reduce((summary, item) => {
    const key = selectKey(item);
    summary[key] = Number(summary[key] || 0) + 1;
    return summary;
  }, {});
}

function getSnapshotHeight(snapshot) {
  if (!snapshot?.chain?.length) {
    return -1;
  }

  return Number(snapshot.chain.at(-1)?.height || -1);
}

function getSnapshotTimestamp(snapshot) {
  if (!snapshot?.exportedAt) {
    return 0;
  }

  return new Date(snapshot.exportedAt).getTime() || 0;
}

function pickFreshestSnapshot(...snapshots) {
  return snapshots
    .filter(Boolean)
    .sort((left, right) => {
      const heightDelta = getSnapshotHeight(right) - getSnapshotHeight(left);
      if (heightDelta !== 0) {
        return heightDelta;
      }

      return getSnapshotTimestamp(right) - getSnapshotTimestamp(left);
    })[0] || null;
}

const SYSTEM_FAUCET_PUBLIC_KEY = 'afrochain-system-faucet';
const SYSTEM_FAUCET_SIGNATURE = 'afrochain-system-faucet';
const TRUSTED_SYSTEM_TRANSACTION_SOURCES = new Set(['faucet', 'system']);
const DEFAULT_GOSSIP_TTL = 2;
const DEFAULT_BLOCK_GOSSIP_FANOUT = 5;
const DEFAULT_PEER_GOSSIP_FANOUT = 3;
const DEFAULT_TRANSACTION_GOSSIP_FANOUT = 3;
const PEER_QUARANTINE_FAILURE_STREAK = 3;
const PEER_QUARANTINE_SCORE = -20;
const DEFAULT_PEER_PROBE_TIMEOUT_MS = 2_500;
const DEFAULT_PEER_REQUEST_TIMEOUT_MS = 4_000;
const DEFAULT_PEER_REQUEST_RETRIES = 2;
const DEFAULT_PEER_DISCOVERY_LIMIT = 25;
const ZERO_HASH = '0'.repeat(64);

function clampPeerScore(score) {
  return Math.max(-100, Math.min(100, Math.round(Number(score || 0))));
}

function uniqueValues(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function parseBooleanOption(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function buildDefaultSnapshotRoots(snapshotPath = null) {
  return uniqueValues([
    snapshotPath ? dirname(resolve(snapshotPath)) : null,
    resolve(process.cwd(), 'data'),
    resolve(process.cwd(), 'snapshots')
  ]);
}

function isPrivatePeerHostname(hostname) {
  if (!hostname) {
    return true;
  }

  const normalizedHostname = hostname.toLowerCase();
  if (normalizedHostname === 'localhost' || normalizedHostname.endsWith('.local')) {
    return true;
  }

  const ipVersion = isIP(normalizedHostname);
  if (ipVersion === 4) {
    if (
      normalizedHostname.startsWith('10.') ||
      normalizedHostname.startsWith('127.') ||
      normalizedHostname.startsWith('192.168.')
    ) {
      return true;
    }

    const octets = normalizedHostname.split('.').map((octet) => Number(octet));
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
      return true;
    }

    if (octets[0] === 169 && octets[1] === 254) {
      return true;
    }
  }

  if (ipVersion === 6) {
    return (
      normalizedHostname === '::1' ||
      normalizedHostname.startsWith('fc') ||
      normalizedHostname.startsWith('fd') ||
      normalizedHostname.startsWith('fe80:')
    );
  }

  return false;
}

function normalizePeerUrl(peerUrl, transport) {
  const protocolSet = transport === 'socket' ? new Set(['tcp:']) : new Set(['http:', 'https:']);
  const url = new URL(peerUrl);

  if (!protocolSet.has(url.protocol)) {
    throw new Error(`Unsupported ${transport} peer protocol for ${peerUrl}.`);
  }

  if (url.username || url.password) {
    throw new Error('Peer URLs must not include embedded credentials.');
  }

  if (url.pathname && url.pathname !== '/') {
    throw new Error('Peer URLs must point at the root host, not a nested path.');
  }

  if (transport === 'socket') {
    if (!url.port) {
      throw new Error('Socket peer URLs must include an explicit port.');
    }

    return `tcp://${url.hostname}:${url.port}`;
  }

  return url.origin;
}

export class AfroChainNode {
  static async createFromDisk(options = {}) {
    const database = options.database ?? (options.databasePath ? await createDatabase(options.databasePath) : null);
    const fileSnapshot = options.snapshot ? null : options.snapshotPath ? await loadSnapshotFile(options.snapshotPath) : null;
    const databaseSnapshot = options.snapshot || !database ? null : database.loadLatestSnapshot();
    const snapshot = pickFreshestSnapshot(options.snapshot, fileSnapshot, databaseSnapshot);

    return new AfroChainNode({
      ...options,
      database,
      snapshot
    });
  }

  constructor(options = {}) {
    const snapshot = options.snapshot || null;

    this.database = options.database || null;
    this.databasePath = options.databasePath || this.database?.filePath || null;
    this.configuredChainId = options.chainId || snapshot?.state?.chainId || null;
    this.configuredNetwork = options.network || snapshot?.state?.network || null;
    this.operatorToken = options.operatorToken || null;
    this.peerToken = options.peerToken || null;
    this.snapshotSigningSecret = options.snapshotSigningSecret || null;
    this.requireSignedSnapshots = options.requireSignedSnapshots ?? Boolean(this.snapshotSigningSecret);
    this.allowedSnapshotRoots = uniqueValues([
      ...(options.allowedSnapshotRoots || []),
      ...buildDefaultSnapshotRoots(options.snapshotPath || null)
    ]);
    this.allowPrivatePeerAddresses = parseBooleanOption(
      options.allowPrivatePeerAddresses,
      (options.network || snapshot?.state?.network || 'devnet') !== 'mainnet'
    );
    this.peerRequestTimeoutMs = Math.max(
      500,
      Number(options.peerRequestTimeoutMs || DEFAULT_PEER_REQUEST_TIMEOUT_MS)
    );
    this.peerRequestRetries = Math.max(0, Number(options.peerRequestRetries ?? DEFAULT_PEER_REQUEST_RETRIES));
    this.peerDiscoveryLimit = Math.max(1, Number(options.peerDiscoveryLimit || DEFAULT_PEER_DISCOVERY_LIMIT));
    this.validatorAddress = options.validatorAddress || snapshot?.validatorAddress || null;
    this.snapshotPath = options.snapshotPath || null;
    this.autoPersist = options.autoPersist !== false;
    this.lastPersistedAt = snapshot?.exportedAt || null;
    this.lastSyncSummary = snapshot?.lastSyncSummary || null;
    this.relayTransports = [];
    this.nodeMetadata = {
      label:
        options.label ||
        snapshot?.nodeMetadata?.label ||
        (this.validatorAddress ? `Validator ${this.validatorAddress.slice(-6)}` : 'AfroChain Observer'),
      publicUrl: options.publicUrl || snapshot?.nodeMetadata?.publicUrl || null,
      region: options.region || snapshot?.nodeMetadata?.region || 'Pan-Africa',
      role: this.validatorAddress ? 'validator' : 'observer',
      socketUrl: options.socketPublicUrl || snapshot?.nodeMetadata?.socketUrl || null,
      startedAt: nowIso()
    };

    this.state = deepClone(
      snapshot?.state ||
        options.genesisState ||
        createGenesisState({
          chainId: options.chainId,
          network: options.network,
          timestamp: options.timestamp
        })
    );
    this.chain = snapshot?.chain?.length ? deepClone(snapshot.chain) : [this.createGenesisBlock()];
    this.mempool = deepClone(snapshot?.mempool || []);
    this.mempoolRejections = deepClone(snapshot?.mempoolRejections || []);
    this.peers = new Set();
    this.peerDirectory = {};

    for (const peer of snapshot?.peers || []) {
      this.addPeer(peer, { persist: false });
    }

    for (const peer of options.peers || []) {
      this.addPeer(peer, { persist: false });
    }

    if (snapshot) {
      this.assertSnapshotIntegrity(snapshot);
    }
  }

  createGenesisBlock() {
    const block = {
      height: 0,
      previousHash: '0'.repeat(64),
      proposer: 'genesis',
      stateRoot: this.buildStateRoot(this.state),
      timestamp: this.state.genesisTimestamp,
      transactions: []
    };

    block.hash = this.hashBlock(block);
    return block;
  }

  hashBlock(block) {
    return sha256Hex(stableStringify(toHashableBlock(block)));
  }

  assertPeerUrlAllowed(peerUrl, options = {}) {
    const transport = options.transport || (/^tcp:\/\//i.test(peerUrl) ? 'socket' : 'http');
    const normalizedUrl = normalizePeerUrl(peerUrl, transport);
    const hostname = new URL(normalizedUrl).hostname;
    const allowPrivate = options.allowPrivate ?? this.allowPrivatePeerAddresses;

    if (!allowPrivate && isPrivatePeerHostname(hostname)) {
      throw new Error(`Peer ${normalizedUrl} uses a private or loopback address that is not allowed by this node policy.`);
    }

    return normalizedUrl;
  }

  buildStateRoot(state) {
    return sha256Hex({
      addressBook: state.addressBook,
      balances: state.balances,
      chainId: state.chainId,
      contracts: Object.fromEntries(
        Object.entries(state.contracts).map(([address, contract]) => [
          address,
          {
            owner: contract.owner,
            state: contract.state,
            template: contract.template
          }
        ])
      ),
      delegations: state.delegations,
      faucet: state.faucet,
      lastUpdatedAt: state.lastUpdatedAt,
      metrics: state.metrics,
      network: state.network,
      nonces: state.nonces,
      pendingTreasuryGrants: state.pendingTreasuryGrants,
      pendingWithdrawals: state.pendingWithdrawals,
      params: state.params,
      proposals: state.proposals,
      rewardAccounts: state.rewardAccounts,
      token: state.token,
      transactions: state.transactions,
      treasury: state.treasury,
      treasuryEvents: state.treasuryEvents,
      treasuryVestingEscrow: state.treasuryVestingEscrow,
      validators: state.validators
    });
  }

  assertSnapshotIntegrity(snapshot) {
    const requireManifest = Number(snapshot.snapshotVersion || 0) >= 5 || this.requireSignedSnapshots;
    verifySnapshotEnvelope(snapshot, {
      requireManifest,
      requireSignature: this.requireSignedSnapshots,
      signingSecret: this.snapshotSigningSecret
    });

    if (!snapshot?.state || !Array.isArray(snapshot.chain) || !snapshot.chain.length) {
      throw new Error('Snapshot must include state and a non-empty chain.');
    }

    if (this.configuredChainId && snapshot.state.chainId !== this.configuredChainId) {
      throw new Error(`Snapshot chainId ${snapshot.state.chainId} does not match node chainId ${this.configuredChainId}.`);
    }

    if (this.configuredNetwork && snapshot.state.network !== this.configuredNetwork) {
      throw new Error(`Snapshot network ${snapshot.state.network} does not match node network ${this.configuredNetwork}.`);
    }

    const genesisBlock = snapshot.chain[0];
    if (Number(genesisBlock.height) !== 0 || genesisBlock.previousHash !== ZERO_HASH) {
      throw new Error('Snapshot genesis block is malformed.');
    }

    if (this.hashBlock(genesisBlock) !== genesisBlock.hash) {
      throw new Error('Snapshot genesis block hash is invalid.');
    }

    for (let index = 1; index < snapshot.chain.length; index += 1) {
      const previousBlock = snapshot.chain[index - 1];
      const block = snapshot.chain[index];

      if (Number(block.height) !== Number(previousBlock.height) + 1) {
        throw new Error(`Snapshot block ${block.hash || index} does not continue the chain height sequence.`);
      }

      if (block.previousHash !== previousBlock.hash) {
        throw new Error(`Snapshot block ${block.hash || index} does not link to the previous block hash.`);
      }

      if (this.hashBlock(block) !== block.hash) {
        throw new Error(`Snapshot block ${block.height} failed hash validation.`);
      }
    }

    const tip = snapshot.chain.at(-1);
    if (Number(tip.height) !== snapshot.chain.length - 1) {
      throw new Error('Snapshot tip height does not match the chain length.');
    }

    const computedStateRoot = this.buildStateRoot(snapshot.state);
    if (tip.stateRoot !== computedStateRoot) {
      throw new Error('Snapshot tip state root does not match the computed state root.');
    }

    return {
      chainId: snapshot.state.chainId,
      height: tip.height,
      network: snapshot.state.network,
      tipHash: tip.hash
    };
  }

  createSnapshot() {
    return finalizeSnapshot({
      chain: deepClone(this.chain),
      databasePath: this.databasePath,
      exportedAt: nowIso(),
      lastSyncSummary: this.lastSyncSummary,
      mempool: deepClone(this.mempool),
      mempoolRejections: deepClone(this.mempoolRejections),
      nodeMetadata: {
        ...this.nodeMetadata
      },
      peers: this.getPeers(),
      snapshotVersion: 5,
      state: deepClone(this.state),
      validatorAddress: this.validatorAddress
    }, {
      signingSecret: this.snapshotSigningSecret
    });
  }

  async saveSnapshot(filePath = this.snapshotPath) {
    const targetPath = filePath || this.snapshotPath;
    const snapshot = this.createSnapshot();

    if (targetPath) {
      await saveSnapshotFile(targetPath, snapshot, {
        allowedRoots: this.allowedSnapshotRoots
      });
    }

    if (this.database) {
      this.database.saveSnapshot(snapshot);
    }

    this.lastPersistedAt = snapshot.exportedAt;
    return targetPath || this.databasePath || null;
  }

  async persistState() {
    if (!this.autoPersist || (!this.snapshotPath && !this.database)) {
      return null;
    }

    return this.saveSnapshot(this.snapshotPath);
  }

  importSnapshot(snapshot) {
    this.assertSnapshotIntegrity(snapshot);

    this.state = deepClone(snapshot.state);
    this.chain = deepClone(snapshot.chain);
    this.lastSyncSummary = snapshot.lastSyncSummary || null;
    this.mempool = deepClone(snapshot.mempool || []);
    this.mempoolRejections = deepClone(snapshot.mempoolRejections || []);
    this.peers = new Set();
    this.peerDirectory = {};

    for (const peer of snapshot.peers || []) {
      this.addPeer(peer, { persist: false });
    }

    const persistedSnapshot = this.createSnapshot();
    if (this.database) {
      this.database.saveSnapshot(persistedSnapshot);
    }

    if (this.autoPersist && this.snapshotPath) {
      void saveSnapshotFile(this.snapshotPath, persistedSnapshot, {
        allowedRoots: this.allowedSnapshotRoots
      });
    }

    this.lastPersistedAt = persistedSnapshot.exportedAt;
    return {
      hash: this.getTip().hash,
      height: this.getTip().height,
      importedAt: persistedSnapshot.exportedAt
    };
  }

  addPeer(peerInput, options = {}) {
    const peer = normalizePeerInput(peerInput);

    if (!peer?.url) {
      return false;
    }

    let normalizedPeerUrl;
    try {
      normalizedPeerUrl = this.assertPeerUrlAllowed(peer.url, {
        allowPrivate: options.allowPrivate,
        transport: peer.transport
      });
    } catch (error) {
      if (options.throwOnInvalid) {
        throw error;
      }

      return false;
    }

    const existing = this.peerDirectory[normalizedPeerUrl] || null;
    const added = !existing;
    this.peers.add(normalizedPeerUrl);
    this.peerDirectory[normalizedPeerUrl] = {
      addedAt: existing?.addedAt || nowIso(),
      compatibleChainId: existing?.compatibleChainId || null,
      compatibleNetwork: existing?.compatibleNetwork || null,
      failureCount: Number(existing?.failureCount || 0),
      failureStreak: Number(existing?.failureStreak || 0),
      label: peer.label ?? existing?.label ?? null,
      lastError: existing?.lastError || null,
      lastFailureAt: existing?.lastFailureAt || null,
      lastLatencyMs: existing?.lastLatencyMs || null,
      lastSeenAt: existing?.lastSeenAt || null,
      lastSuccessAt: existing?.lastSuccessAt || null,
      quarantinedAt: existing?.quarantinedAt || null,
      quarantineReason: existing?.quarantineReason || null,
      region: peer.region ?? existing?.region ?? null,
      score: clampPeerScore(existing?.score || 0),
      status: existing?.status || 'registered',
      successCount: Number(existing?.successCount || 0),
      transport: peer.transport ?? existing?.transport ?? 'http',
      url: normalizedPeerUrl
    };

    if (options.persist !== false) {
      void this.persistState();
    }

    return added;
  }

  notePeerSeen(peerUrl) {
    if (!this.peerDirectory[peerUrl]) {
      this.addPeer(peerUrl, { persist: false });
    }

    this.peerDirectory[peerUrl].lastSeenAt = nowIso();
    this.peerDirectory[peerUrl].status = 'reachable';
  }

  buildPeerView(peerRecord) {
    if (!peerRecord) {
      return null;
    }

    const score = clampPeerScore(peerRecord.score || 0);
    const failureStreak = Number(peerRecord.failureStreak || 0);
    const incompatible = peerRecord.status === 'incompatible';
    const quarantined =
      incompatible ||
      Boolean(peerRecord.quarantinedAt) ||
      failureStreak >= PEER_QUARANTINE_FAILURE_STREAK ||
      score <= PEER_QUARANTINE_SCORE;
    const status = incompatible ? 'incompatible' : quarantined ? 'quarantined' : peerRecord.status || 'registered';

    return {
      ...peerRecord,
      broadcastEligible: !quarantined,
      failureCount: Number(peerRecord.failureCount || 0),
      failureStreak,
      quarantined,
      score,
      status,
      successCount: Number(peerRecord.successCount || 0)
    };
  }

  getPeers() {
    return Object.values(this.peerDirectory)
      .map((peer) => this.buildPeerView(peer))
      .sort((left, right) => {
      const scoreDelta = Number(right.score || 0) - Number(left.score || 0);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      const rightSeenAt = new Date(right.lastSeenAt || right.lastSuccessAt || 0).getTime();
      const leftSeenAt = new Date(left.lastSeenAt || left.lastSuccessAt || 0).getTime();
      if (rightSeenAt !== leftSeenAt) {
        return rightSeenAt - leftSeenAt;
      }

        return left.url.localeCompare(right.url);
      });
  }

  getPeer(peerUrl) {
    return this.buildPeerView(this.peerDirectory[peerUrl] || null);
  }

  getPeersByTransport(transport) {
    return this.getPeers().filter((peer) => peer.transport === transport);
  }

  updatePeerRecord(peerUrl, updates = {}) {
    if (!peerUrl) {
      return null;
    }

    if (!this.peerDirectory[peerUrl]) {
      this.addPeer(peerUrl, { persist: false });
    }

    const current = this.peerDirectory[peerUrl];
    const nextRecord = {
      ...current,
      ...updates,
      score: clampPeerScore(updates.score ?? current.score ?? 0),
      url: peerUrl
    };

    if (updates.clearQuarantine) {
      nextRecord.quarantinedAt = null;
      nextRecord.quarantineReason = null;
    }

    this.peerDirectory[peerUrl] = nextRecord;

    return this.getPeer(peerUrl);
  }

  quarantinePeer(peerUrl, reason, options = {}) {
    return this.updatePeerRecord(peerUrl, {
      quarantineReason: reason || 'Peer health below AfroChain safety threshold.',
      quarantinedAt: options.quarantinedAt || nowIso(),
      status: options.status || 'quarantined'
    });
  }

  restorePeer(peerUrl, options = {}) {
    const restoredPeer = this.updatePeerRecord(peerUrl, {
      clearQuarantine: true,
      failureStreak: 0,
      score: Math.max(0, Number(this.peerDirectory[peerUrl]?.score || 0)),
      status: options.status || 'registered'
    });

    if (options.persist !== false) {
      void this.persistState();
    }

    return restoredPeer;
  }

  recordPeerSuccess(peerUrl, metadata = {}) {
    const current = this.peerDirectory[peerUrl] || {};
    const importedBlocks = Number(metadata.importedBlocks || 0);
    const importedTransactions = Number(metadata.importedTransactions || 0);
    const discoveredPeers = Number(metadata.discoveredPeers || 0);
    const scoreDelta =
      2 + Math.min(importedBlocks, 4) + Math.min(importedTransactions, 3) + Math.min(discoveredPeers, 2);

    return this.updatePeerRecord(peerUrl, {
      compatibleChainId: metadata.chainId ?? current.compatibleChainId ?? null,
      compatibleNetwork: metadata.network ?? current.compatibleNetwork ?? null,
      clearQuarantine: true,
      failureStreak: 0,
      lastError: null,
      lastLatencyMs: metadata.latencyMs ?? current.lastLatencyMs ?? null,
      lastSeenAt: metadata.seenAt || nowIso(),
      lastSuccessAt: nowIso(),
      score: Number(current.score || 0) + scoreDelta,
      status: metadata.status || 'reachable',
      successCount: Number(current.successCount || 0) + 1
    });
  }

  recordPeerFailure(peerUrl, error, metadata = {}) {
    const current = this.peerDirectory[peerUrl] || {};
    const failureStreak = Number(current.failureStreak || 0) + 1;
    const penalty = 4 + Math.min(failureStreak, 4) * 2;
    const peerRecord = this.updatePeerRecord(peerUrl, {
      compatibleChainId: metadata.chainId ?? current.compatibleChainId ?? null,
      compatibleNetwork: metadata.network ?? current.compatibleNetwork ?? null,
      failureCount: Number(current.failureCount || 0) + 1,
      failureStreak,
      lastError: error?.message || String(error),
      lastFailureAt: nowIso(),
      lastLatencyMs: metadata.latencyMs ?? current.lastLatencyMs ?? null,
      score: Number(current.score || 0) - penalty,
      status: metadata.status || 'failed'
    });

    if (
      metadata.status === 'incompatible' ||
      failureStreak >= PEER_QUARANTINE_FAILURE_STREAK ||
      Number(peerRecord.score || 0) <= PEER_QUARANTINE_SCORE
    ) {
      return this.quarantinePeer(peerUrl, metadata.reason || error?.message, {
        status: metadata.status === 'incompatible' ? 'incompatible' : 'quarantined'
      });
    }

    return peerRecord;
  }

  async probePeer(peerUrl, options = {}) {
    if (!peerUrl) {
      throw new Error('Peer URL is required for probing.');
    }

    const normalizedPeerUrl = this.assertPeerUrlAllowed(peerUrl, {
      allowPrivate: options.allowPrivate,
      transport: options.transport || 'http'
    });

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutMs = Number(options.timeoutMs || this.peerRequestTimeoutMs || DEFAULT_PEER_PROBE_TIMEOUT_MS);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${normalizedPeerUrl}/health`, {
        signal: controller.signal
      });
      const health = await response.json();

      if (!response.ok) {
        throw new Error(`Peer ${normalizedPeerUrl} returned ${response.status} for /health.`);
      }

      if (health.chainId && health.chainId !== this.state.chainId) {
        throw new Error(`Peer ${normalizedPeerUrl} is on chain ${health.chainId}, expected ${this.state.chainId}.`);
      }

      if (health.network && health.network !== this.state.network) {
        throw new Error(`Peer ${normalizedPeerUrl} is on network ${health.network}, expected ${this.state.network}.`);
      }

      const peer = this.recordPeerSuccess(normalizedPeerUrl, {
        chainId: health.chainId || null,
        latencyMs: Date.now() - startedAt,
        network: health.network || null,
        seenAt: nowIso(),
        status: 'reachable'
      });

      if (options.persist !== false) {
        await this.persistState();
      }

      return {
        health,
        peer,
        status: 'reachable',
        url: normalizedPeerUrl
      };
    } catch (error) {
      const peer = this.recordPeerFailure(normalizedPeerUrl, error, {
        latencyMs: Date.now() - startedAt,
        status: /expected/.test(error.message) ? 'incompatible' : 'failed'
      });

      if (options.persist !== false) {
        await this.persistState();
      }

      return {
        error: error.message,
        peer,
        status: peer.status,
        url: normalizedPeerUrl
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async probePeers(options = {}) {
    const targets = options.peerUrls?.length
      ? options.peerUrls
      : this.getPeers()
          .filter((peer) => options.includeQuarantined || peer.broadcastEligible)
          .slice(0, Number(options.limit || this.getPeers().length))
          .map((peer) => peer.url);
    const results = [];

    for (const peerUrl of targets) {
      results.push(
        await this.probePeer(peerUrl, {
          persist: false,
          timeoutMs: options.timeoutMs
        })
      );
    }

    if (options.persist !== false) {
      await this.persistState();
    }

    return {
      completedAt: nowIso(),
      healthy: results.filter((result) => result.status === 'reachable').length,
      probed: results.length,
      quarantined: results.filter((result) => result.status === 'quarantined' || result.status === 'incompatible').length,
      results
    };
  }

  getBroadcastPeers(options = {}) {
    const excludedPeerUrls = new Set((options.excludePeerUrls || []).filter(Boolean));
    const fanout = Number(options.fanout || 0);
    const peers = (options.peerUrls?.length
      ? options.peerUrls.map((peerUrl) => this.peerDirectory[peerUrl]).filter(Boolean)
      : this.getPeers()
    )
      .map((peer) => this.buildPeerView(peer))
      .filter((peer) => peer && !excludedPeerUrls.has(peer.url))
      .filter((peer) => !options.transport || peer.transport === options.transport)
      .filter((peer) => options.includeQuarantined || peer.broadcastEligible);

    if (!fanout || fanout >= peers.length) {
      return peers;
    }

    return peers.slice(0, fanout);
  }

  registerRelayTransport(transport) {
    if (!transport || this.relayTransports.includes(transport)) {
      return transport;
    }

    this.relayTransports.push(transport);
    return transport;
  }

  async broadcastRelayTransports(kind, payload, options = {}) {
    if (!this.relayTransports.length) {
      return [];
    }

    return Promise.allSettled(
      this.relayTransports.map((transport) => {
        if (kind === 'transaction' && transport.broadcastTransaction) {
          return transport.broadcastTransaction(payload, options);
        }

        if (kind === 'block' && transport.broadcastBlock) {
          return transport.broadcastBlock(payload, options);
        }

        if (kind === 'peers' && transport.broadcastPeers) {
          return transport.broadcastPeers(payload, options);
        }

        return null;
      })
    );
  }

  buildRelayMetadata(options = {}) {
    return {
      originUrl: options.originUrl || this.nodeMetadata.publicUrl || null,
      sourceUrl: this.nodeMetadata.publicUrl || null,
      ttl: Math.max(0, Number(options.ttl ?? DEFAULT_GOSSIP_TTL))
    };
  }

  async broadcastTransaction(transaction, options = {}) {
    const ttl = Math.max(0, Number(options.ttl ?? DEFAULT_GOSSIP_TTL));
    if (ttl <= 0) {
      return [];
    }

    return this.broadcastJson(
      '/sync/transactions',
      {
        relay: this.buildRelayMetadata({
          ...options,
          ttl
        }),
        transaction
      },
      {
        ...options,
        fanout: Number(options.fanout || DEFAULT_TRANSACTION_GOSSIP_FANOUT)
      }
    );
  }

  async broadcastBlock(block, options = {}) {
    const ttl = Math.max(0, Number(options.ttl ?? DEFAULT_GOSSIP_TTL));
    if (ttl <= 0) {
      return [];
    }

    return this.broadcastJson(
      '/sync/blocks',
      {
        block,
        relay: this.buildRelayMetadata({
          ...options,
          ttl
        })
      },
      {
        ...options,
        fanout: Number(options.fanout || DEFAULT_BLOCK_GOSSIP_FANOUT)
      }
    );
  }

  async broadcastPeerAnnouncements(peers, options = {}) {
    const normalizedPeers = peers.map((peer) => normalizePeerInput(peer)).filter(Boolean);
    const ttl = Math.max(0, Number(options.ttl ?? DEFAULT_GOSSIP_TTL));

    if (!normalizedPeers.length || ttl <= 0) {
      return [];
    }

    return this.broadcastJson(
      '/sync/peers',
      {
        peers: normalizedPeers,
        relay: this.buildRelayMetadata({
          ...options,
          ttl
        })
      },
      {
        ...options,
        fanout: Number(options.fanout || DEFAULT_PEER_GOSSIP_FANOUT)
      }
    );
  }

  async announcePeer(peerInput, options = {}) {
    const normalizedPeer = normalizePeerInput(peerInput);
    const added = this.addPeer(normalizedPeer, options);

    if (added && options.broadcast !== false) {
      await Promise.all([
        this.broadcastPeerAnnouncements([normalizedPeer], {
          excludePeerUrls: options.excludePeerUrls,
          ttl: options.ttl
        }),
        this.broadcastRelayTransports('peers', [normalizedPeer], {
          excludePeerUrls: options.excludePeerUrls,
          ttl: options.ttl
        })
      ]);
    }

    return {
      added,
      peer: normalizedPeer?.url ? this.getPeer(normalizedPeer.url) : null,
      peers: this.getPeers()
    };
  }

  async receivePeerAnnouncements(peers, options = {}) {
    const sourceUrl = options.sourceUrl || null;
    const discoveredPeers = [];

    for (const peer of peers || []) {
      const normalizedPeer = normalizePeerInput(peer);
      if (!normalizedPeer?.url || normalizedPeer.url === sourceUrl || normalizedPeer.url === this.nodeMetadata.publicUrl) {
        continue;
      }

      const added = this.addPeer(normalizedPeer, {
        persist: false
      });
      if (added) {
        discoveredPeers.push(normalizedPeer);
      }
    }

    if (discoveredPeers.length && options.persist !== false) {
      await this.persistState();
    }

    if (discoveredPeers.length && options.broadcast !== false && Number(options.ttl || 0) > 0) {
      await this.broadcastPeerAnnouncements(discoveredPeers, {
        excludePeerUrls: [sourceUrl].filter(Boolean),
        ttl: Number(options.ttl || 0)
      });
    }

    return {
      accepted: discoveredPeers.length,
      peers: this.getPeers()
    };
  }

  async gossipNetworkState(options = {}) {
    const peerAnnouncements = this.getPeers()
      .slice(0, Number(options.peerLimit || 10))
      .map((peer) => ({
        label: peer.label,
        region: peer.region,
        url: peer.url
      }));
    const transactions = this.getMempool(Number(options.transactionLimit || 10));
    const includeLatestBlock = options.includeLatestBlock !== false && this.getTip().height > 0;

    if (options.includePeers !== false && peerAnnouncements.length) {
      await this.broadcastPeerAnnouncements(peerAnnouncements, {
        fanout: options.peerFanout,
        ttl: options.ttl
      });
    }

    if (options.includeTransactions !== false) {
      for (const transaction of transactions) {
        await this.broadcastTransaction(transaction, {
          fanout: options.transactionFanout,
          ttl: options.ttl
        });
      }
    }

    if (includeLatestBlock) {
      await this.broadcastBlock(this.getTip(), {
        fanout: options.blockFanout,
        ttl: options.ttl
      });
    }

    return {
      blockCount: includeLatestBlock ? 1 : 0,
      peerAnnouncementCount: options.includePeers === false ? 0 : peerAnnouncements.length,
      peerFanout: Number(options.peerFanout || DEFAULT_PEER_GOSSIP_FANOUT),
      transactionCount: options.includeTransactions === false ? 0 : transactions.length,
      transactionFanout: Number(options.transactionFanout || DEFAULT_TRANSACTION_GOSSIP_FANOUT)
    };
  }

  getPeerSummary() {
    const peers = this.getPeers();

    return {
      averageScore: peers.length
        ? peers.reduce((total, peer) => total + Number(peer.score || 0), 0) / peers.length
        : 0,
      broadcastEligibleCount: peers.filter((peer) => peer.broadcastEligible).length,
      incompatibleCount: peers.filter((peer) => peer.status === 'incompatible').length,
      quarantinedCount: peers.filter((peer) => peer.status === 'quarantined').length,
      reachableCount: peers.filter((peer) => peer.status === 'reachable').length,
      registeredCount: peers.filter((peer) => peer.status === 'registered').length,
      total: peers.length
    };
  }

  ensureAccountInState(state, address) {
    if (!address) {
      throw new Error('Address is required.');
    }

    state.balances[address] ??= 0;
    state.nonces[address] ??= 0;
    state.rewardAccounts[address] ??= 0;
    return address;
  }

  getBalanceFromState(state, address) {
    if (!address) {
      return 0;
    }

    return Number(state.balances?.[address] || 0);
  }

  buildAccountView(state, address) {
    return {
      address,
      balance: this.getBalanceFromState(state, address),
      label: state.addressBook[address]?.label || null,
      nonce: Number(state.nonces[address] || 0),
      pendingWithdrawals: state.pendingWithdrawals.filter((withdrawal) => withdrawal.address === address),
      rewards: Number(state.rewardAccounts[address] || 0),
      stakingPower: getAccountStakedAmount(state, address)
    };
  }

  creditInState(state, address, amount) {
    const normalizedAmount = Number(amount || 0);
    if (normalizedAmount < 0) {
      throw new Error('Credit amount must not be negative.');
    }

    this.ensureAccountInState(state, address);
    state.balances[address] += normalizedAmount;
  }

  debitInState(state, address, amount) {
    const normalizedAmount = Number(amount || 0);
    if (normalizedAmount < 0) {
      throw new Error('Debit amount must not be negative.');
    }

    this.ensureAccountInState(state, address);

    if (state.balances[address] < normalizedAmount) {
      throw new Error(`Insufficient AFC balance for ${address}.`);
    }

    state.balances[address] -= normalizedAmount;
  }

  transferInState(state, from, to, amount, options = {}) {
    const normalizedAmount = Number(amount || 0);
    if (normalizedAmount <= 0) {
      throw new Error('Transfer amount must be greater than zero.');
    }

    if (!isValidAddress(from) || !isValidAddress(to)) {
      throw new Error('Both sender and recipient addresses must be valid AfroChain addresses.');
    }

    this.debitInState(state, from, normalizedAmount);
    this.creditInState(state, to, normalizedAmount);

    if (options.metrics !== false) {
      const originCountry = options.originCountry || 'Local';
      const destinationCountry = options.destinationCountry || 'Local';
      const corridor = corridorKey(originCountry, destinationCountry);

      state.metrics.corridors[corridor] ||= {
        mobileMoneyVolume: 0,
        transactions: 0,
        volume: 0
      };
      state.metrics.corridors[corridor].transactions += 1;
      state.metrics.corridors[corridor].volume += normalizedAmount;

      if (options.mobileMoneyProvider) {
        state.metrics.corridors[corridor].mobileMoneyVolume += normalizedAmount;
      }

      if (originCountry !== destinationCountry) {
        state.metrics.crossBorderTransactions += 1;
        state.metrics.crossBorderVolume += normalizedAmount;
      }
    }

    return {
      amount: normalizedAmount,
      from,
      to
    };
  }

  getExecutionHelpers(state, timestamp) {
    return {
      credit: (address, amount) => this.creditInState(state, address, amount),
      debit: (address, amount) => this.debitInState(state, address, amount),
      getBalance: (address) => this.getBalanceFromState(state, address),
      transfer: (from, to, amount, options) => this.transferInState(state, from, to, amount, options),
      timestamp
    };
  }

  hasTransaction(transactionId) {
    return Boolean(
      this.state.transactions[transactionId] || this.mempool.some((transaction) => transaction.id === transactionId)
    );
  }

  getNextNonce(address) {
    const committedNonce = Number(this.state.nonces[address] || 0);
    const pendingCount = this.mempool.filter((transaction) => transaction.sender === address).length;
    return committedNonce + pendingCount + 1;
  }

  normalizeTransaction(transaction) {
    const normalized = {
      ...transaction,
      fee: Number(transaction.fee || 0),
      nonce: Number(transaction.nonce || 0),
      payload: transaction.payload || {},
      timestamp: transaction.timestamp || nowIso()
    };

    normalized.id = normalized.id || createTransactionId(normalized);
    return normalized;
  }

  isSystemFaucetTransaction(transaction) {
    return (
      transaction?.type === 'faucet' &&
      transaction.publicKey === SYSTEM_FAUCET_PUBLIC_KEY &&
      transaction.signature === SYSTEM_FAUCET_SIGNATURE
    );
  }

  isTrustedSystemTransactionSource(source) {
    return TRUSTED_SYSTEM_TRANSACTION_SOURCES.has(source || '');
  }

  buildExecutionContext(state = this.state, blockHeight = this.chain.length) {
    return {
      blockHeight,
      proposerAddress: selectProposer(state, this.getTip().hash, blockHeight)
    };
  }

  getActivityEntrySearchWindow() {
    return Object.keys(this.state.transactions).length + Number(this.state.treasuryEvents?.length || 0);
  }

  recordMempoolRejection(transaction, reason, stage = 'admission') {
    this.mempoolRejections.unshift({
      nonce: Number(transaction?.nonce || 0),
      reason,
      recordedAt: nowIso(),
      sender: transaction?.sender || null,
      source: transaction?.source || null,
      stage,
      txId: transaction?.id || null,
      type: transaction?.type || null
    });
    this.mempoolRejections = this.mempoolRejections.slice(0, 50);
  }

  buildFaucetTransaction(address, amount, options = {}) {
    const timestamp = options.timestamp || nowIso();

    const transaction = {
      fee: 0,
      nonce: Number(options.nonce || this.getNextNonce(this.state.faucet.address)),
      payload: {
        amount: Number(amount),
        label: options.label || null,
        note: options.note || 'Developer faucet',
        recipient: address,
        region: options.region || 'Pan-Africa'
      },
      publicKey: SYSTEM_FAUCET_PUBLIC_KEY,
      sender: this.state.faucet.address,
      signature: SYSTEM_FAUCET_SIGNATURE,
      timestamp,
      type: 'faucet'
    };

    transaction.id = createTransactionId(transaction);
    return transaction;
  }

  validateFaucetTransaction(state, transaction) {
    const normalizedAmount = Math.round(Number(transaction.payload?.amount || 0));
    const recipient = transaction.payload?.recipient;
    const requestTimestampMs = new Date(transaction.timestamp).getTime();
    const lastRequestAt = Number(state.faucet.requestLog[recipient] || 0);

    if (transaction.sender !== state.faucet.address) {
      throw new Error('System faucet transactions must originate from the configured faucet account.');
    }

    if (!this.isSystemFaucetTransaction(transaction)) {
      throw new Error('System faucet transactions must use the reserved system transaction markers.');
    }

    if (!isValidAddress(recipient)) {
      throw new Error('Faucet recipient must be a valid AfroChain address.');
    }

    if (Number(transaction.fee || 0) !== 0) {
      throw new Error('System faucet transactions must not charge a fee.');
    }

    if (!Number.isFinite(requestTimestampMs)) {
      throw new Error('System faucet transactions must include a valid timestamp.');
    }

    if (normalizedAmount <= 0) {
      throw new Error('Faucet amount must be greater than zero.');
    }

    if (normalizedAmount > state.faucet.maxAmount) {
      throw new Error(`Faucet requests are capped at ${state.faucet.maxAmount} base units.`);
    }

    if (state.faucet.cooldownMs && lastRequestAt && requestTimestampMs - lastRequestAt < state.faucet.cooldownMs) {
      const retryAfterMs = state.faucet.cooldownMs - (requestTimestampMs - lastRequestAt);
      throw new Error(`Faucet cooldown active. Retry in ${Math.ceil(retryAfterMs / 1000)} seconds.`);
    }
  }

  applyFaucetOnState(state, transaction, helpers) {
    const normalizedAmount = Math.round(Number(transaction.payload.amount || 0));
    const recipient = transaction.payload.recipient;
    const requestTimestampMs = new Date(transaction.timestamp).getTime();

    helpers.transfer(state.faucet.address, recipient, normalizedAmount, {
      metrics: false
    });
    state.faucet.requestLog[recipient] = requestTimestampMs;
    state.faucet.disbursements.unshift({
      address: recipient,
      amount: normalizedAmount,
      id: transaction.id,
      label: transaction.payload.label || null,
      note: transaction.payload.note || 'Developer faucet',
      timestamp: transaction.timestamp
    });
    state.faucet.disbursements = state.faucet.disbursements.slice(0, 25);
    state.addressBook[recipient] ||= {
      label: transaction.payload.label || 'Faucet Recipient',
      region: transaction.payload.region || 'Pan-Africa',
      type: 'wallet'
    };

    return {
      address: recipient,
      amount: normalizedAmount,
      remainingBalance: helpers.getBalance(state.faucet.address)
    };
  }

  projectPendingTransactions(transactions = this.mempool, options = {}) {
    let projectedState = deepClone(options.baseState || this.state);
    const context = options.context || this.buildExecutionContext(options.baseState || this.state);
    const retainedTransactions = [];
    const rejectedTransactions = [];

    for (const transaction of transactions) {
      try {
        const execution = this.executeTransactionOnState(projectedState, transaction, context, {
          status: options.status || 'pending'
        });
        projectedState = execution.state;
        retainedTransactions.push(transaction);
      } catch (error) {
        rejectedTransactions.push({
          reason: error.message,
          transaction
        });
      }
    }

    return {
      context,
      rejectedTransactions,
      retainedTransactions,
      state: projectedState
    };
  }

  reconcileMempool(stage = 'reconciliation') {
    const projection = this.projectPendingTransactions(this.mempool);

    this.mempool = projection.retainedTransactions;
    for (const rejection of projection.rejectedTransactions) {
      this.recordMempoolRejection(rejection.transaction, rejection.reason, stage);
    }

    return projection;
  }

  collectRelatedAddresses(transaction, result) {
    const addresses = new Set([transaction.sender]);

    for (const candidate of [
      transaction.payload?.recipient,
      transaction.payload?.validator,
      transaction.payload?.contract,
      result?.address,
      result?.from,
      result?.merchant,
      result?.recipient,
      result?.spender,
      result?.to,
      result?.validator
    ]) {
      if (candidate && typeof candidate === 'string' && candidate.startsWith('afc_')) {
        addresses.add(candidate);
      }
    }

    return [...addresses];
  }

  applyPaymentOnState(state, transaction, helpers) {
    return helpers.transfer(transaction.sender, transaction.payload.recipient, transaction.payload.amount, {
      destinationCountry: transaction.payload.destinationCountry,
      metrics: true,
      mobileMoneyProvider: transaction.payload.mobileMoneyProvider,
      originCountry: transaction.payload.originCountry,
      reference: transaction.payload.reference
    });
  }

  estimateTransactionExecution(state, transaction) {
    const baseFee = Number(state.params.baseFee || 0);
    const defaultContractGasLimit = Number(state.params.defaultContractGasLimit || 30_000);
    const contractGasPrice = Number(state.params.contractGasPrice || 0);

    if (transaction.type === 'faucet') {
      return {
        gasLimit: 0,
        gasPrice: 0,
        gasUsed: 0,
        minimumFee: 0
      };
    }

    if (transaction.type === 'contract_deploy') {
      const gasUsed = estimateContractDeployGas(transaction.payload.template, transaction.payload.args || {});
      const gasLimit = Number(transaction.payload.gasLimit || defaultContractGasLimit);

      if (gasLimit < gasUsed) {
        throw new Error(`Contract deployment requires at least ${gasUsed} gas, but only ${gasLimit} was provided.`);
      }

      return {
        gasLimit,
        gasPrice: contractGasPrice,
        gasUsed,
        minimumFee: baseFee + gasUsed * contractGasPrice
      };
    }

    if (transaction.type === 'contract_call') {
      const contract = state.contracts[transaction.payload.contract];
      if (!contract) {
        throw new Error('Contract does not exist.');
      }

      const gasUsed = estimateContractCallGas(
        {
          getBalance: (address) => this.getBalanceFromState(state, address),
          sender: transaction.sender,
          state,
          timestamp: transaction.timestamp,
          transfer: () => ({})
        },
        contract,
        transaction.payload.method,
        transaction.payload.args || {}
      );
      const gasLimit = Number(transaction.payload.gasLimit || defaultContractGasLimit);

      if (gasLimit < gasUsed) {
        throw new Error(`Contract call requires at least ${gasUsed} gas, but only ${gasLimit} was provided.`);
      }

      return {
        gasLimit,
        gasPrice: contractGasPrice,
        gasUsed,
        minimumFee: baseFee + gasUsed * contractGasPrice
      };
    }

    return {
      gasLimit: 0,
      gasPrice: 0,
      gasUsed: 0,
      minimumFee: baseFee
    };
  }

  estimateTransactionCost(transaction) {
    const normalized = this.normalizeTransaction(transaction);
    const executionCost = this.estimateTransactionExecution(this.state, normalized);

    return {
      baseFee: Number(this.state.params.baseFee || 0),
      contractGasPrice: Number(this.state.params.contractGasPrice || 0),
      defaultContractGasLimit: Number(this.state.params.defaultContractGasLimit || 30_000),
      minimumFee: executionCost.minimumFee,
      recommendedFee: executionCost.minimumFee,
      transaction: {
        payload: normalized.payload,
        sender: normalized.sender,
        type: normalized.type
      },
      ...executionCost
    };
  }

  applyContractDeployOnState(state, transaction, helpers) {
    const payload = transaction.payload;
    const contract = createContractInstance(payload.template, {
      address: payload.address,
      args: payload.args,
      description: payload.description,
      name: payload.name,
      owner: transaction.sender,
      timestamp: transaction.timestamp
    });

    if (state.contracts[contract.address]) {
      throw new Error('A contract already exists at that address.');
    }

    helpers.debit(transaction.sender, state.params.contractDeploymentBond);
    helpers.credit(state.treasury, state.params.contractDeploymentBond);
    state.contracts[contract.address] = contract;
    this.ensureAccountInState(state, contract.address);
    state.metrics.activeContracts = Object.keys(state.contracts).length;

    return {
      address: contract.address,
      owner: contract.owner,
      template: contract.template
    };
  }

  applyContractCallOnState(state, transaction, helpers) {
    const contract = state.contracts[transaction.payload.contract];
    if (!contract) {
      throw new Error('Contract does not exist.');
    }

    return executeContractCall(
      {
        getBalance: helpers.getBalance,
        sender: transaction.sender,
        state,
        timestamp: transaction.timestamp,
        transfer: helpers.transfer
      },
      contract,
      transaction.payload.method,
      transaction.payload.args
    );
  }

  executeTransactionOnState(baseState, transaction, context, options = {}) {
    const normalized = this.normalizeTransaction(transaction);
    const draftState = deepClone(baseState);
    const helpers = this.getExecutionHelpers(draftState, normalized.timestamp);
    const systemFaucetTransaction = this.isSystemFaucetTransaction(normalized);

    if (!systemFaucetTransaction && !options.skipSignatureCheck && !verifyTransactionSignature(normalized)) {
      throw new Error('Transaction signature verification failed during execution.');
    }

    if (systemFaucetTransaction) {
      this.validateFaucetTransaction(draftState, normalized);
    }

    if (normalized.nonce !== Number(draftState.nonces[normalized.sender] || 0) + 1) {
      throw new Error('Transaction nonce does not match the next committed nonce.');
    }

    const executionCost = this.estimateTransactionExecution(draftState, normalized);
    if (normalized.fee < executionCost.minimumFee) {
      throw new Error(`Transaction fee must be at least ${executionCost.minimumFee} for this execution path.`);
    }

    helpers.debit(normalized.sender, normalized.fee);

    let result;
    switch (normalized.type) {
      case 'faucet':
        result = this.applyFaucetOnState(draftState, normalized, helpers);
        break;
      case 'payment':
        result = this.applyPaymentOnState(draftState, normalized, helpers);
        break;
      case 'stake':
        result = applyStakeTransaction(draftState, normalized.sender, normalized.payload, {
          credit: helpers.credit,
          currentHeight: context.blockHeight,
          debit: helpers.debit
        });
        break;
      case 'contract_deploy':
        result = this.applyContractDeployOnState(draftState, normalized, helpers);
        break;
      case 'contract_call':
        result = this.applyContractCallOnState(draftState, normalized, helpers);
        break;
      case 'proposal':
        result = createProposal(draftState, normalized.sender, normalized.payload, {
          credit: helpers.credit,
          currentHeight: context.blockHeight,
          debit: helpers.debit,
          timestamp: normalized.timestamp
        });
        break;
      case 'vote':
        result = voteOnProposal(draftState, normalized.sender, normalized.payload, {
          currentHeight: context.blockHeight
        });
        break;
      default:
        throw new Error(`Unsupported transaction type: ${normalized.type}`);
    }

    draftState.nonces[normalized.sender] = normalized.nonce;
    draftState.metrics.totalContractGasUsed = Number(draftState.metrics.totalContractGasUsed || 0) + executionCost.gasUsed;
    draftState.metrics.totalTransactions += 1;
    draftState.lastUpdatedAt = normalized.timestamp;

    const receipt = {
      blockHeight: context.blockHeight,
      executedAt: normalized.timestamp,
      feeCharged: normalized.fee,
      gasLimit: executionCost.gasLimit,
      gasPrice: executionCost.gasPrice,
      gasUsed: executionCost.gasUsed,
      minimumFee: executionCost.minimumFee,
      proposer: context.proposerAddress,
      success: true,
      txId: normalized.id,
      type: normalized.type
    };

    draftState.transactions[normalized.id] = {
      ...normalized,
      blockHeight: context.blockHeight,
      proposer: context.proposerAddress,
      receipt,
      result,
      status: options.status || 'confirmed'
    };

    return {
      normalized,
      receipt,
      result,
      state: draftState
    };
  }

  validateTransactionForMempool(normalized) {
    if (!normalized.type || !normalized.sender) {
      throw new Error('Transaction type and sender are required.');
    }

    if (this.hasTransaction(normalized.id)) {
      throw new Error('Transaction already exists in the mempool or chain.');
    }

    if (!isValidAddress(normalized.sender)) {
      throw new Error('Sender address is not a valid AfroChain address.');
    }

    if (!verifyTransactionSignature(normalized)) {
      throw new Error('Transaction signature verification failed.');
    }
  }

  async submitTransaction(transaction, options = {}) {
    const normalized = this.normalizeTransaction(transaction);
    const pendingTransaction = {
      ...normalized,
      receivedAt: nowIso(),
      source: options.source || 'client'
    };

    if (this.isSystemFaucetTransaction(normalized)) {
      if (!options.allowSystemTransactions && !this.isTrustedSystemTransactionSource(options.source)) {
        throw new Error('System faucet transactions can only be submitted by trusted node workflows.');
      }

      this.validateFaucetTransaction(this.state, normalized);
    } else {
      this.validateTransactionForMempool(normalized);
    }

    const projection = this.projectPendingTransactions([...this.mempool, pendingTransaction]);
    const candidateRejection = projection.rejectedTransactions.find(
      ({ transaction: rejectedTransaction }) => rejectedTransaction.id === normalized.id
    );

    if (candidateRejection) {
      this.recordMempoolRejection(pendingTransaction, candidateRejection.reason, 'admission');
      throw new Error(candidateRejection.reason);
    }

    this.mempool = projection.retainedTransactions;
    for (const rejection of projection.rejectedTransactions) {
      if (rejection.transaction.id !== normalized.id) {
        this.recordMempoolRejection(rejection.transaction, rejection.reason, 'admission');
      }
    }

    await this.persistState();

    if (options.broadcast !== false) {
      await Promise.all([
        this.broadcastTransaction(normalized, {
          excludePeerUrls: options.excludePeerUrls,
          fanout: options.fanout,
          ttl: options.ttl
        }),
        this.broadcastRelayTransports('transaction', normalized, {
          excludePeerUrls: options.excludePeerUrls,
          ttl: options.ttl
        })
      ]);
    }

    return {
      accepted: true,
      mempoolSize: this.mempool.length,
      transaction: normalized
    };
  }

  applyTransaction(transaction, context) {
    const execution = this.executeTransactionOnState(this.state, transaction, context);
    this.state = execution.state;
    return execution.receipt;
  }

  simulateTransaction(transaction) {
    const execution = this.executeTransactionOnState(
      this.state,
      transaction,
      this.buildExecutionContext(this.state),
      {
        status: 'simulated'
      }
    );
    const relatedAccounts = this.collectRelatedAddresses(execution.normalized, execution.result).map((address) =>
      this.buildAccountView(execution.state, address)
    );

    return {
      accounts: relatedAccounts,
      accepted: true,
      previewBlockHeight: this.chain.length,
      receipt: execution.receipt,
      result: execution.result,
      simulatedStateRoot: this.buildStateRoot(execution.state)
    };
  }

  async requestFaucet(address, amount, options = {}) {
    if (!isValidAddress(address)) {
      throw new Error('Faucet recipient must be a valid AfroChain address.');
    }

    this.reconcileMempool('pre-faucet');

    const faucet = this.state.faucet;
    const normalizedAmount = Math.round(Number(amount || faucet.maxAmount));
    const requestTimestamp = nowIso();

    if (normalizedAmount <= 0) {
      throw new Error('Faucet amount must be greater than zero.');
    }

    if (normalizedAmount > faucet.maxAmount) {
      throw new Error(`Faucet requests are capped at ${faucet.maxAmount} base units.`);
    }

    const faucetTransaction = this.buildFaucetTransaction(address, normalizedAmount, {
      ...options,
      timestamp: requestTimestamp
    });

    const submission = await this.submitTransaction(faucetTransaction, {
      allowSystemTransactions: true,
      source: 'faucet'
    });
    const canProduceImmediately =
      !this.validatorAddress || this.buildExecutionContext(this.state).proposerAddress === this.validatorAddress;

    if (canProduceImmediately) {
      const production = await this.produceBlock({
        broadcast: options.broadcast,
        force: !this.validatorAddress
      });

      return {
        address,
        amount: normalizedAmount,
        blockHeight: production.block.height,
        remainingBalance: this.getBalanceFromState(this.state, faucet.address),
        status: 'confirmed',
        timestamp: requestTimestamp,
        transactionId: faucetTransaction.id
      };
    }

    return {
      address,
      amount: normalizedAmount,
      mempoolSize: submission.mempoolSize,
      remainingBalance: this.getBalanceFromState(this.state, faucet.address),
      status: 'queued',
      timestamp: requestTimestamp,
      transactionId: faucetTransaction.id
    };
  }

  getTip() {
    return this.chain.at(-1);
  }

  getFinalityOverview() {
    const tip = this.getTip();
    const finalityDepth = Number(this.state.params.finalityDepth || 0);
    const finalizedHeight = Math.max(0, tip.height - finalityDepth);
    const finalizedBlock = this.chain[finalizedHeight] || this.chain[0];

    return {
      finalizedHeight,
      finalizedTipHash: finalizedBlock?.hash || null,
      finalityDepth,
      tipHeight: tip.height
    };
  }

  buildBlockView(block) {
    const finality = this.getFinalityOverview();
    const confirmations = Math.max(0, this.getTip().height - block.height);

    return {
      ...block,
      confirmations,
      finalized: block.height <= finality.finalizedHeight,
      remainingToFinality: Math.max(0, finality.finalityDepth - confirmations)
    };
  }

  getOverview() {
    const tip = this.getTip();
    const activeValidators = Object.values(this.state.validators).filter((validator) => validator.active);
    const finality = this.getFinalityOverview();

    return {
      activeValidatorCount: activeValidators.length,
      baseFee: this.state.params.baseFee,
      chainId: this.state.chainId,
      contractGasPrice: this.state.params.contractGasPrice,
      contractCount: Object.keys(this.state.contracts).length,
      crossBorderVolume: this.state.metrics.crossBorderVolume,
      defaultContractGasLimit: this.state.params.defaultContractGasLimit,
      faucetBalance: this.getBalanceFromState(this.state, this.state.faucet.address),
      finalizedHeight: finality.finalizedHeight,
      finalizedTipHash: finality.finalizedTipHash,
      finalityDepth: finality.finalityDepth,
      height: tip.height,
      lastSyncAt: this.lastSyncSummary?.completedAt || null,
      mobileRelayerPoolBalance: this.getBalanceFromState(this.state, this.state.mobileRelayerPool),
      network: this.state.network,
      operatorApiProtected: Boolean(this.operatorToken),
      peerCount: this.peers.size,
      peerDiscoveryLimit: this.peerDiscoveryLimit,
      peerRequestRetries: this.peerRequestRetries,
      peerRequestTimeoutMs: this.peerRequestTimeoutMs,
      peerRelayProtected: Boolean(this.peerToken),
      persistenceMode: this.database ? 'hybrid' : this.snapshotPath ? 'snapshot' : 'memory',
      privatePeerAddressesAllowed: this.allowPrivatePeerAddresses,
      snapshotPath: this.snapshotPath,
      snapshotRoots: this.allowedSnapshotRoots,
      signedSnapshotsRequired: this.requireSignedSnapshots,
      socketUrl: this.nodeMetadata.socketUrl,
      targetBlockTimeMs: this.state.params.targetBlockTimeMs,
      tipHash: tip.hash,
      token: this.state.token,
      totalStaked: getTotalActiveStake(this.state)
    };
  }

  getMetrics() {
    const corridors = Object.entries(this.state.metrics.corridors)
      .map(([name, summary]) => ({
        ...summary,
        name
      }))
      .sort((left, right) => right.volume - left.volume);

    return {
      ...this.state.metrics,
      corridors,
      finality: this.getFinalityOverview(),
      totalActiveStake: getTotalActiveStake(this.state)
    };
  }

  getNetworkTopology() {
    const finality = this.getFinalityOverview();
    const peers = this.getPeers();

    return {
      chain: {
        finalizedHeight: finality.finalizedHeight,
        finalizedTipHash: finality.finalizedTipHash,
        finalityDepth: finality.finalityDepth,
        height: this.getTip().height,
        tipHash: this.getTip().hash
      },
      database: this.getDatabaseStatus(),
      lastPersistedAt: this.lastPersistedAt,
      lastSyncSummary: this.lastSyncSummary,
      mempool: this.getMempoolStats(),
      node: {
        ...this.nodeMetadata,
        databasePath: this.databasePath,
        snapshotPath: this.snapshotPath,
        validatorAddress: this.validatorAddress
      },
      peerSummary: this.getPeerSummary(),
      peers
    };
  }

  getDatabaseStatus() {
    if (!this.database) {
      return {
        enabled: false,
        filePath: this.databasePath,
        latestSnapshot: null,
        latestSync: this.lastSyncSummary
          ? {
              completedAt: this.lastSyncSummary.completedAt,
              peerCount: this.lastSyncSummary.peers.length
            }
          : null,
        snapshotCount: 0,
        syncRunCount: 0
      };
    }

    return this.database.getStatus();
  }

  getTreasuryAnalytics() {
    const treasuryTypes = new Set(['treasury', 'inclusion_pool', 'settlement_pool']);
    const treasuryAccounts = Object.entries(this.state.addressBook)
      .filter(([, metadata]) => treasuryTypes.has(metadata.type))
      .map(([address, metadata]) => ({
        address,
        balance: this.getBalanceFromState(this.state, address),
        label: metadata.label,
        region: metadata.region,
        type: metadata.type
      }))
      .sort((left, right) => right.balance - left.balance);
    const pendingTreasuryGrants = [...(this.state.pendingTreasuryGrants || [])]
      .sort((left, right) => left.startHeight - right.startHeight)
      .slice(0, 10);
    const recentTreasuryEvents = [...(this.state.treasuryEvents || [])].slice(0, 10);
    const recentVestingReleases = recentTreasuryEvents.filter((event) => event.type === 'treasury_vesting_release').slice(0, 5);

    return {
      faucet: this.getFaucetOverview(),
      pendingWithdrawalTotal: this.state.pendingWithdrawals.reduce(
        (total, withdrawal) => total + Number(withdrawal.amount || 0),
        0
      ),
      pendingTreasuryGrantCount: Number(this.state.pendingTreasuryGrants?.length || 0),
      pendingTreasuryGrantTotal: (this.state.pendingTreasuryGrants || []).reduce(
        (total, grant) => total + Math.max(0, Number(grant.amount || 0) - Number(grant.amountReleased || 0)),
        0
      ),
      pendingTreasuryGrants,
      recentTreasuryProposals: this.getProposals()
        .filter((proposal) => proposal.category === 'treasury')
        .slice(0, 5),
      recentTreasuryEvents,
      recentVestingReleases,
      proposalSummary: summarizeStatusCounts(Object.values(this.state.proposals), (proposal) => proposal.status),
      rewardLiabilities: sumRecord(this.state.rewardAccounts),
      topTreasuryAccounts: treasuryAccounts,
      treasuryGrantCount: Number(this.state.metrics.treasuryGrantCount || 0),
      treasuryGrantVolume: Number(this.state.metrics.treasuryGrantVolume || 0),
      treasuryVestingCount: Number(this.state.metrics.treasuryVestingCount || 0),
      treasuryVestingEscrowBalance: this.getBalanceFromState(this.state, this.state.treasuryVestingEscrow),
      treasuryVestingReleased: Number(this.state.metrics.treasuryVestingReleased || 0),
      treasuryVestingVolume: Number(this.state.metrics.treasuryVestingVolume || 0),
      treasuryShareOfSupply:
        treasuryAccounts.reduce((total, account) => total + account.balance, 0) / this.state.token.totalSupply,
      validatorConcentration: this.getValidators().slice(0, 5).map((validator) => ({
        address: validator.address,
        name: validator.name,
        share: validator.totalStake / Math.max(getTotalActiveStake(this.state), 1),
        totalStake: validator.totalStake
      }))
    };
  }

  getMempool(limit = 50) {
    return [...this.mempool]
      .sort((left, right) => new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime())
      .slice(0, Number(limit));
  }

  getMempoolStats() {
    return {
      pendingByType: summarizeStatusCounts(this.mempool, (transaction) => transaction.type),
      pendingFees: this.mempool.reduce((total, transaction) => total + Number(transaction.fee || 0), 0),
      recentRejections: this.mempoolRejections.slice(0, 10),
      rejectionCount: this.mempoolRejections.length,
      size: this.mempool.length
    };
  }

  getCorridors(limit = 20) {
    return Object.entries(this.state.metrics.corridors)
      .map(([name, summary]) => ({
        ...summary,
        name,
        shareOfCrossBorderVolume:
          Number(this.state.metrics.crossBorderVolume || 0) > 0 ? summary.volume / this.state.metrics.crossBorderVolume : 0
      }))
      .sort((left, right) => right.volume - left.volume)
      .slice(0, Number(limit));
  }

  getBlocks(limit = 20) {
    return this.chain.slice(-Number(limit)).reverse().map((block) => this.buildBlockView(block));
  }

  getBlock(height) {
    const block = this.chain.find((candidate) => candidate.height === Number(height)) || null;
    return block ? this.buildBlockView(block) : null;
  }

  getTransactions(limit = 50) {
    const finality = this.getFinalityOverview();

    return Object.values(this.state.transactions)
      .sort((left, right) => right.blockHeight - left.blockHeight)
      .slice(0, Number(limit))
      .map((transaction) => ({
        ...transaction,
        finalized: transaction.blockHeight <= finality.finalizedHeight
      }));
  }

  getTransaction(transactionId) {
    const transaction = this.state.transactions[transactionId] || null;
    if (!transaction) {
      return null;
    }

    return {
      ...transaction,
      finalized: transaction.blockHeight <= this.getFinalityOverview().finalizedHeight
    };
  }

  buildActivityEntry(transaction) {
    const participants = this.collectRelatedAddresses(transaction, transaction.result);
    const amount = Number(
      transaction.payload?.amount ||
        transaction.result?.amount ||
        transaction.result?.approved ||
        transaction.result?.claimed ||
        transaction.result?.disbursed ||
        transaction.result?.funded ||
        transaction.result?.grantVolume ||
        transaction.result?.payout ||
        transaction.result?.refunded ||
        transaction.result?.released ||
        0
    );
    const contractAddress =
      transaction.payload?.contract || (transaction.type === 'contract_deploy' ? transaction.result?.address : null);
    const corridor =
      transaction.type === 'payment'
        ? corridorKey(transaction.payload?.originCountry || 'Local', transaction.payload?.destinationCountry || 'Local')
        : null;

    return {
      amount,
      blockHeight: transaction.blockHeight,
      contractAddress,
      corridor,
      fee: Number(transaction.fee || 0),
      finalized: Boolean(transaction.blockHeight <= this.getFinalityOverview().finalizedHeight),
      gasUsed: Number(transaction.receipt?.gasUsed || 0),
      id: transaction.id,
      participants,
      sender: transaction.sender,
      status: transaction.status,
      summary:
        transaction.type === 'faucet'
          ? `Faucet disbursement to ${transaction.payload?.recipient}`
          : transaction.type === 'payment'
          ? `Payment from ${transaction.sender} to ${transaction.payload?.recipient}`
          : transaction.type === 'stake'
            ? `Stake action ${transaction.payload?.action}`
            : transaction.type === 'contract_deploy'
              ? `Contract deployed at ${transaction.result?.address}`
              : transaction.type === 'contract_call'
                ? `Contract call ${transaction.payload?.method}`
                : transaction.type === 'proposal'
                  ? `${
                      transaction.payload?.category === 'treasury' ? 'Treasury proposal created' : 'Proposal created'
                    }: ${transaction.payload?.title}`
                  : transaction.type === 'vote'
                    ? `Vote cast on ${transaction.payload?.proposalId}`
                    : transaction.type,
      timestamp: transaction.timestamp,
      txId: transaction.id,
      type: transaction.type
    };
  }

  buildTreasuryEventActivity(event) {
    return {
      amount: Number(event.amount || 0),
      blockHeight: Number(event.blockHeight || 0),
      contractAddress: null,
      corridor: null,
      fee: 0,
      finalized: Boolean(event.blockHeight <= this.getFinalityOverview().finalizedHeight),
      gasUsed: 0,
      id: event.id,
      participants: event.participants || [event.source, event.recipient].filter(Boolean),
      sender: event.source || this.state.treasury,
      status: 'confirmed',
      summary:
        event.type === 'treasury_vesting_scheduled'
          ? `Treasury vesting scheduled for ${event.recipient}`
          : event.type === 'treasury_vesting_release'
            ? `Treasury vesting released to ${event.recipient}`
            : `Treasury grant disbursed to ${event.recipient}`,
      timestamp: event.timestamp,
      txId: null,
      type: event.type
    };
  }

  getActivityFeed(limit = 50) {
    const transactionActivities = Object.values(this.state.transactions).map((transaction) => this.buildActivityEntry(transaction));
    const treasuryActivities = (this.state.treasuryEvents || []).map((event) => this.buildTreasuryEventActivity(event));

    return [...transactionActivities, ...treasuryActivities]
      .sort((left, right) => {
        const leftHeight = Number(this.state.transactions[left.txId]?.blockHeight || left.blockHeight || 0);
        const rightHeight = Number(this.state.transactions[right.txId]?.blockHeight || right.blockHeight || 0);

        if (rightHeight !== leftHeight) {
          return rightHeight - leftHeight;
        }

        return new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
      })
      .slice(0, Number(limit));
  }

  getAccountActivity(address, limit = 20) {
    return this.getActivityFeed(this.getActivityEntrySearchWindow())
      .filter((activity) => activity.participants.includes(address))
      .slice(0, Number(limit));
  }

  getContractActivity(address, limit = 20) {
    return this.getActivityFeed(this.getActivityEntrySearchWindow())
      .filter((activity) => activity.contractAddress === address)
      .slice(0, Number(limit));
  }

  search(query) {
    const normalizedQuery = String(query || '').trim().toLowerCase();

    if (!normalizedQuery) {
      return {
        query,
        results: {
          accounts: [],
          contracts: [],
          proposals: [],
          transactions: [],
          validators: []
        }
      };
    }

    const accountMatches = Object.keys(this.state.balances)
      .filter((address) => {
        const label = this.state.addressBook[address]?.label?.toLowerCase() || '';
        return address.toLowerCase().includes(normalizedQuery) || label.includes(normalizedQuery);
      })
      .slice(0, 6)
      .map((address) => this.getAccount(address));

    const contractMatches = Object.values(this.state.contracts)
      .filter((contract) => {
        const name = contract.name?.toLowerCase() || '';
        const template = contract.template?.toLowerCase() || '';
        return (
          contract.address.toLowerCase().includes(normalizedQuery) ||
          name.includes(normalizedQuery) ||
          template.includes(normalizedQuery)
        );
      })
      .slice(0, 6)
      .map((contract) => this.getContract(contract.address));

    const validatorMatches = this.getValidators()
      .filter((validator) => {
        const name = validator.name?.toLowerCase() || '';
        const region = validator.region?.toLowerCase() || '';
        return (
          validator.address.toLowerCase().includes(normalizedQuery) ||
          name.includes(normalizedQuery) ||
          region.includes(normalizedQuery)
        );
      })
      .slice(0, 6);

    const transactionMatches = Object.values(this.state.transactions)
      .sort((left, right) => right.blockHeight - left.blockHeight)
      .filter((transaction) => {
        const recipient = transaction.payload?.recipient?.toLowerCase() || '';
        const title = transaction.payload?.title?.toLowerCase() || '';
        return (
          transaction.id.toLowerCase().includes(normalizedQuery) ||
          transaction.sender.toLowerCase().includes(normalizedQuery) ||
          recipient.includes(normalizedQuery) ||
          title.includes(normalizedQuery)
        );
      })
      .slice(0, 6)
      .map((transaction) => this.buildActivityEntry(transaction));

    const proposalMatches = this.getProposals()
      .filter((proposal) => {
        const title = proposal.title?.toLowerCase() || '';
        const summary = proposal.summary?.toLowerCase() || '';
        return proposal.id.toLowerCase().includes(normalizedQuery) || title.includes(normalizedQuery) || summary.includes(normalizedQuery);
      })
      .slice(0, 6);

    return {
      query,
      results: {
        accounts: accountMatches,
        contracts: contractMatches,
        proposals: proposalMatches,
        transactions: transactionMatches,
        validators: validatorMatches
      }
    };
  }

  getAccount(address) {
    return this.buildAccountView(this.state, address);
  }

  getValidators() {
    return Object.values(this.state.validators)
      .map((validator) => ({
        ...validator,
        rewardBalance: Number(this.state.rewardAccounts[validator.address] || 0)
      }))
      .sort((left, right) => right.totalStake - left.totalStake);
  }

  getStakingOverview() {
    return {
      minValidatorStake: this.state.params.minValidatorStake,
      pendingWithdrawals: this.state.pendingWithdrawals,
      rewardAccounts: this.state.rewardAccounts,
      totalActiveStake: getTotalActiveStake(this.state),
      validators: this.getValidators()
    };
  }

  getProposals() {
    return Object.values(this.state.proposals).sort((left, right) => right.endHeight - left.endHeight);
  }

  getContracts() {
    return summarizeContractPortfolio(this.state).map((contract) =>
      contract.address === 'afc_contract_afrocoin'
        ? {
            ...contract,
            allowanceExposure: getAllowanceExposure(this.state.contracts[contract.address])
          }
        : contract
    );
  }

  getContract(address) {
    const contract = this.state.contracts[address];
    if (!contract) {
      return null;
    }

    return {
      ...contract,
      balance: this.getBalanceFromState(this.state, address)
    };
  }

  readContract(address, method, args = {}) {
    const contract = this.state.contracts[address];
    if (!contract) {
      throw new Error('Contract does not exist.');
    }

    return readContractState(
      {
        getBalance: (targetAddress) => this.getBalanceFromState(this.state, targetAddress),
        state: this.state
      },
      contract,
      method,
      args
    );
  }

  getFaucetOverview() {
    return {
      address: this.state.faucet.address,
      cooldownMs: this.state.faucet.cooldownMs,
      maxAmount: this.state.faucet.maxAmount,
      recentDisbursements: this.state.faucet.disbursements,
      remainingBalance: this.getBalanceFromState(this.state, this.state.faucet.address)
    };
  }

  async produceBlock(options = {}) {
    const nextHeight = this.chain.length;
    const selectedProposer = selectProposer(this.state, this.getTip().hash, nextHeight);

    if (this.validatorAddress && !options.force && selectedProposer !== this.validatorAddress) {
      throw new Error(`Validator ${this.validatorAddress} is not the selected proposer for block ${nextHeight}.`);
    }

    const proposerAddress = selectedProposer;
    this.reconcileMempool('pre-block');
    const queuedTransactions = [...this.mempool];
    const candidateTransactions = queuedTransactions.slice(0, this.state.params.maxTransactionsPerBlock);
    const overflowTransactions = queuedTransactions.slice(this.state.params.maxTransactionsPerBlock);
    const acceptedTransactions = [];
    const rejectedTransactions = [];
    const blockTimestamp = nowIso();
    let totalFees = 0;

    this.mempool = overflowTransactions;

    for (const transaction of candidateTransactions) {
      try {
        const receipt = this.applyTransaction(transaction, {
          blockHeight: nextHeight,
          proposerAddress
        });
        totalFees += Number(transaction.fee || 0);
        acceptedTransactions.push({
          ...transaction,
          receipt
        });
      } catch (error) {
        this.recordMempoolRejection(transaction, error.message, 'block');
        rejectedTransactions.push({
          reason: error.message,
          txId: transaction.id
        });
      }
    }

    const liveHelpers = this.getExecutionHelpers(this.state, blockTimestamp);
    const maturedWithdrawals = processPendingWithdrawals(this.state, nextHeight, liveHelpers);
    const finalizedProposals = finalizeProposals(this.state, nextHeight, liveHelpers);
    const treasuryVestingReleases = processTreasuryGrantVesting(this.state, nextHeight, liveHelpers);
    const rewardSummary = distributeBlockRewards(this.state, proposerAddress, totalFees, {
      credit: liveHelpers.credit,
      currentHeight: nextHeight,
      debit: liveHelpers.debit
    });
    this.state.metrics.totalBlocks += 1;

    const block = {
      height: nextHeight,
      previousHash: this.getTip().hash,
      proposer: proposerAddress,
      stateRoot: this.buildStateRoot(this.state),
      timestamp: blockTimestamp,
      transactions: acceptedTransactions
    };

    block.hash = this.hashBlock(block);
    this.chain.push(block);

    await this.persistState();

    if (options.broadcast !== false) {
      await Promise.all([
        this.broadcastBlock(block, {
          excludePeerUrls: options.excludePeerUrls,
          fanout: options.fanout,
          ttl: options.ttl
        }),
        this.broadcastRelayTransports('block', block, {
          excludePeerUrls: options.excludePeerUrls,
          ttl: options.ttl
        })
      ]);
    }

    return {
      block,
      finalizedProposals,
      maturedWithdrawals,
      rejectedTransactions,
      rewardSummary,
      treasuryVestingReleases
    };
  }

  async acceptBlock(block, options = {}) {
    const previousState = deepClone(this.state);
    const previousChain = deepClone(this.chain);
    const previousMempool = [...this.mempool];

    try {
      if (block.height !== this.chain.length) {
        throw new Error('Received block height does not extend the current chain.');
      }

      if (block.previousHash !== this.getTip().hash) {
        throw new Error('Received block previous hash does not match the local tip.');
      }

      const selectedProposer = selectProposer(this.state, this.getTip().hash, block.height);
      if (block.proposer !== selectedProposer) {
        throw new Error('Received block proposer does not match the PoS selection for this height.');
      }

      if (this.hashBlock(block) !== block.hash) {
        throw new Error('Received block hash failed validation.');
      }

      let totalFees = 0;
      for (const transaction of block.transactions) {
        this.applyTransaction(transaction, {
          blockHeight: block.height,
          proposerAddress: block.proposer
        });
        totalFees += Number(transaction.fee || 0);
      }

      const liveHelpers = this.getExecutionHelpers(this.state, block.timestamp);
      processPendingWithdrawals(this.state, block.height, liveHelpers);
      finalizeProposals(this.state, block.height, liveHelpers);
      processTreasuryGrantVesting(this.state, block.height, liveHelpers);
      distributeBlockRewards(this.state, block.proposer, totalFees, {
        credit: liveHelpers.credit,
        currentHeight: block.height,
        debit: liveHelpers.debit
      });
      this.state.metrics.totalBlocks += 1;

      const localStateRoot = this.buildStateRoot(this.state);
      if (localStateRoot !== block.stateRoot) {
        throw new Error('Received block state root does not match the locally computed root.');
      }

      this.chain.push(block);
      this.mempool = this.mempool.filter(
        (pendingTransaction) => !block.transactions.some((transaction) => transaction.id === pendingTransaction.id)
      );
      this.reconcileMempool('post-block');

      await this.persistState();

      if (options.broadcast !== false) {
        await Promise.all([
          this.broadcastBlock(block, {
            excludePeerUrls: options.excludePeerUrls,
            fanout: options.fanout,
            ttl: options.ttl
          }),
          this.broadcastRelayTransports('block', block, {
            excludePeerUrls: options.excludePeerUrls,
            ttl: options.ttl
          })
        ]);
      }

      return {
        accepted: true,
        hash: block.hash,
        height: block.height
      };
    } catch (error) {
      this.state = previousState;
      this.chain = previousChain;
      this.mempool = previousMempool;
      throw error;
    }
  }

  async broadcastJson(path, payload, options = {}) {
    const peers = this.getBroadcastPeers({
      ...options,
      transport: 'http'
    });
    if (!peers.length) {
      return [];
    }

    return Promise.allSettled(
      peers.map(async (peer) => {
        const requestStartedAt = Date.now();
        const controller = new AbortController();
        const timeoutMs = Number(options.timeoutMs || this.peerRequestTimeoutMs || DEFAULT_PEER_REQUEST_TIMEOUT_MS);
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(`${peer.url}${path}`, {
            body: JSON.stringify(payload),
            headers: {
              'content-type': 'application/json',
              ...(this.peerToken
                ? {
                    'x-afrochain-peer-token': this.peerToken
                  }
                : {})
            },
            method: 'POST',
            signal: controller.signal
          });

          if (!response.ok) {
            throw new Error(`Peer ${peer.url} returned ${response.status} for ${path}.`);
          }

          this.recordPeerSuccess(peer.url, {
            latencyMs: Date.now() - requestStartedAt
          });
          return {
            status: response.status,
            url: peer.url
          };
        } catch (error) {
          this.recordPeerFailure(peer.url, error, {
            latencyMs: Date.now() - requestStartedAt
          });
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
      })
    );
  }

  async recordSyncSummary(summary) {
    this.lastSyncSummary = summary;

    if (this.database) {
      this.database.recordSyncRun(summary);
    }

    if (this.autoPersist && (this.snapshotPath || this.database)) {
      await this.persistState();
    }

    return summary;
  }

  async syncWithPeers(options = {}) {
    return syncNodeWithPeers(this, options);
  }
}
