import { nowIso } from './utils.js';

async function readJsonResponse(response, peerUrl, route) {
  if (!response.ok) {
    throw new Error(`Peer ${peerUrl} returned ${response.status} for ${route}.`);
  }

  return response.json();
}

async function fetchPeerJson(peerUrl, route) {
  const response = await fetch(`${peerUrl}${route}`);
  return readJsonResponse(response, peerUrl, route);
}

export async function syncNodeWithPeers(node, options = {}) {
  const peers = node.getPeersByTransport('http');
  const startedAt = nowIso();
  const summary = {
    completedAt: null,
    discoveredPeerCount: 0,
    errors: [],
    finalHeight: node.getTip().height,
    finalTipHash: node.getTip().hash,
    importedBlockCount: 0,
    importedBlocks: [],
    importedTransactionCount: 0,
    localHeight: node.getTip().height,
    localTipHash: node.getTip().hash,
    mempoolImports: [],
    peers: [],
    startedAt,
    status: 'ok'
  };

  for (const peer of peers) {
    const peerStartedAt = Date.now();
    const peerSummary = {
      discoveredPeers: 0,
      importedBlocks: 0,
      importedTransactions: 0,
      remoteHeight: null,
      remoteTipHash: null,
      status: 'pending',
      url: peer.url
    };

    try {
      const health = await fetchPeerJson(peer.url, '/health');
      const remoteChainId = health.chainId || null;
      const remoteNetwork = health.network || null;

      if (remoteChainId && remoteChainId !== node.state.chainId) {
        throw new Error(
          `Peer ${peer.url} is on chain ${remoteChainId}, expected ${node.state.chainId}.`
        );
      }

      if (remoteNetwork && remoteNetwork !== node.state.network) {
        throw new Error(
          `Peer ${peer.url} is on network ${remoteNetwork}, expected ${node.state.network}.`
        );
      }

      node.notePeerSeen(peer.url);
      peerSummary.remoteHeight = Number(health.height || 0);
      peerSummary.remoteTipHash = health.tipHash || null;

      const peerDirectory = await fetchPeerJson(peer.url, '/peers');
      for (const discoveredPeer of peerDirectory) {
        if (!discoveredPeer?.url || discoveredPeer.url === peer.url) {
          continue;
        }

        const added = node.addPeer(discoveredPeer);
        if (added) {
          peerSummary.discoveredPeers += 1;
          summary.discoveredPeerCount += 1;
        }
      }

      const currentHeight = node.getTip().height;
      if (peerSummary.remoteHeight > currentHeight) {
        for (let height = currentHeight + 1; height <= peerSummary.remoteHeight; height += 1) {
          const block = await fetchPeerJson(peer.url, `/blocks/${height}`);

          if (!block?.hash) {
            throw new Error(`Peer ${peer.url} did not return a valid block at height ${height}.`);
          }

          await node.acceptBlock(block, {
            broadcast: false
          });
          peerSummary.importedBlocks += 1;
          summary.importedBlockCount += 1;
          summary.importedBlocks.push({
            hash: block.hash,
            height: block.height,
            peer: peer.url
          });
        }
      }

      const mempoolLimit = Number(options.mempoolLimit || 25);
      if (mempoolLimit > 0) {
        const remoteMempool = await fetchPeerJson(peer.url, `/mempool?limit=${mempoolLimit}`);
        for (const transaction of remoteMempool.transactions || []) {
          if (node.hasTransaction(transaction.id)) {
            continue;
          }

          try {
            await node.submitTransaction(transaction, {
              broadcast: false,
              source: 'peer-sync'
            });
            peerSummary.importedTransactions += 1;
            summary.importedTransactionCount += 1;
            summary.mempoolImports.push({
              peer: peer.url,
              txId: transaction.id,
              type: transaction.type
            });
          } catch (error) {
            summary.errors.push(`Transaction ${transaction.id} from ${peer.url}: ${error.message}`);
          }
        }
      }

      node.recordPeerSuccess(peer.url, {
        chainId: remoteChainId,
        discoveredPeers: peerSummary.discoveredPeers,
        importedBlocks: peerSummary.importedBlocks,
        importedTransactions: peerSummary.importedTransactions,
        latencyMs: Date.now() - peerStartedAt,
        network: remoteNetwork
      });
      peerSummary.status = 'reachable';
    } catch (error) {
      node.recordPeerFailure(peer.url, error, {
        latencyMs: Date.now() - peerStartedAt,
        status: /expected/.test(error.message) ? 'incompatible' : 'failed'
      });
      peerSummary.status = 'failed';
      summary.errors.push(`Peer ${peer.url}: ${error.message}`);
    }

    summary.peers.push(peerSummary);
  }

  summary.completedAt = nowIso();
  summary.finalHeight = node.getTip().height;
  summary.finalTipHash = node.getTip().hash;

  if (summary.errors.length) {
    summary.status = summary.importedBlockCount || summary.importedTransactionCount ? 'partial' : 'degraded';
  }

  if (!peers.length) {
    summary.status = 'idle';
  }

  await node.recordSyncSummary(summary);
  return summary;
}
