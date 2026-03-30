import { fileURLToPath } from 'node:url';

import { createApiServer } from '../api.js';
import { AfroChainNode } from '../node.js';
import { createSocketTransport } from '../socket-transport.js';

const port = Number(process.env.PORT || 4100);
const host = process.env.HOST || '0.0.0.0';
const peers = process.env.AFC_PEERS ? process.env.AFC_PEERS.split(',').filter(Boolean) : [];
const socketPeers = process.env.AFC_SOCKET_PEERS ? process.env.AFC_SOCKET_PEERS.split(',').filter(Boolean) : [];
const socketPort = Number(process.env.AFC_SOCKET_PORT || 0);
const socketHost = process.env.AFC_SOCKET_HOST || host;
const socketPublicUrl = process.env.AFC_SOCKET_PUBLIC_URL || null;
const transportSharedSecret = process.env.AFC_TRANSPORT_SHARED_SECRET || null;
const operatorToken = process.env.AFC_OPERATOR_TOKEN || null;
const peerToken = process.env.AFC_PEER_TOKEN || transportSharedSecret || null;
const snapshotSigningSecret = process.env.AFC_SNAPSHOT_SIGNING_SECRET || null;
const allowedSnapshotRoots = process.env.AFC_SNAPSHOT_ALLOWED_ROOTS
  ? process.env.AFC_SNAPSHOT_ALLOWED_ROOTS.split(',').filter(Boolean)
  : [];
const allowPrivatePeerAddresses =
  process.env.AFC_ALLOW_PRIVATE_PEERS === undefined ? undefined : process.env.AFC_ALLOW_PRIVATE_PEERS;
const peerRequestRetries = Number(process.env.AFC_PEER_REQUEST_RETRIES || 2);
const peerRequestTimeoutMs = Number(process.env.AFC_PEER_REQUEST_TIMEOUT_MS || 4000);
const peerDiscoveryLimit = Number(process.env.AFC_PEER_DISCOVERY_LIMIT || 25);
const validatorAddress = process.env.AFC_VALIDATOR_ADDRESS || null;
const autoBlockMs = Number(process.env.AFC_AUTOBLOCK_MS || 15000);
const syncMs = Number(process.env.AFC_SYNC_MS || 12000);
const syncMempoolLimit = Number(process.env.AFC_SYNC_MEMPOOL_LIMIT || 25);
const snapshotPath =
  process.env.AFC_SNAPSHOT_PATH || fileURLToPath(new URL('../../../data/node-snapshot.json', import.meta.url));
const databasePath =
  process.env.AFC_DB_PATH || fileURLToPath(new URL('../../../data/node-state.sqlite', import.meta.url));

const node = await AfroChainNode.createFromDisk({
  chainId: process.env.AFC_CHAIN_ID || 'afrochain-1',
  databasePath,
  label: process.env.AFC_NODE_LABEL || 'AfroChain Public Node',
  network: process.env.AFC_NETWORK || 'devnet',
  allowedSnapshotRoots,
  allowPrivatePeerAddresses,
  operatorToken,
  peers,
  peerDiscoveryLimit,
  peerToken,
  peerRequestRetries,
  peerRequestTimeoutMs,
  publicUrl: process.env.AFC_PUBLIC_URL || null,
  region: process.env.AFC_REGION || 'Pan-Africa',
  snapshotSigningSecret,
  socketPublicUrl,
  snapshotPath,
  validatorAddress
});

const api = createApiServer(node);
const binding = await api.listen(port, host);

console.log(`AfroChain node listening on http://${binding.host}:${binding.port}`);
console.log(`Network: ${node.state.network} (${node.state.chainId})`);
console.log(`Validator: ${validatorAddress || 'observer / demo mode'}`);
console.log(`Snapshot path: ${snapshotPath}`);
console.log(`Database path: ${databasePath}`);
console.log(`Operator API: ${operatorToken ? 'token protected' : 'disabled (set AFC_OPERATOR_TOKEN to enable)'}`);
console.log(`Peer relay API: ${peerToken ? 'token protected' : 'disabled (set AFC_PEER_TOKEN to enable)'}`);
console.log(`Snapshot signing: ${snapshotSigningSecret ? 'enabled' : 'disabled'}`);
console.log(`Private peer addresses: ${node.allowPrivatePeerAddresses ? 'allowed' : 'blocked'}`);

if (socketPort > 0) {
  const transport = await createSocketTransport(node, {
    host: socketHost,
    peers: socketPeers,
    port: socketPort,
    publicUrl: socketPublicUrl,
    sharedSecret: transportSharedSecret
  });
  console.log(`Socket transport listening on ${transport.publicUrl || transport.url}`);
}

if (autoBlockMs > 0) {
  setInterval(async () => {
    try {
      await node.produceBlock({
        broadcast: true,
        force: !validatorAddress
      });
    } catch (error) {
      console.log(`Block production skipped: ${error.message}`);
    }
  }, autoBlockMs);
}

if (syncMs > 0) {
  setInterval(async () => {
    try {
      const summary = await node.syncWithPeers({
        mempoolLimit: syncMempoolLimit
      });
      console.log(
        `Peer sync ${summary.status}: +${summary.importedBlockCount} blocks, +${summary.importedTransactionCount} txs`
      );
    } catch (error) {
      console.log(`Peer sync failed: ${error.message}`);
    }
  }, syncMs);
}
