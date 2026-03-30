import { createServer } from 'node:http';

import { listContractTemplates } from './contracts/templates.js';

const ALLOWED_HEADERS = 'content-type,x-afrochain-operator-token,x-afrochain-peer-token';

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'access-control-allow-headers': ALLOWED_HEADERS,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-origin': '*',
    'content-type': 'application/json'
  });
  response.end(statusCode === 204 ? '' : JSON.stringify(payload, null, 2));
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function parseRelayEnvelope(body, key) {
  if (body?.[key]) {
    return {
      payload: body[key],
      relay: body.relay || {}
    };
  }

  return {
    payload: body,
    relay: {}
  };
}

function getHeaderValue(request, name) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function requireApiToken(request, response, node, role) {
  const expectedToken = role === 'operator' ? node.operatorToken : node.peerToken;
  const headerName = role === 'operator' ? 'x-afrochain-operator-token' : 'x-afrochain-peer-token';

  if (!expectedToken) {
    sendJson(response, 503, {
      error: `AfroChain ${role} API access is disabled because ${headerName.toUpperCase()} is not configured on this node.`
    });
    return false;
  }

  if (getHeaderValue(request, headerName) !== expectedToken) {
    sendJson(response, 401, {
      error: `Missing or invalid AfroChain ${role} API token.`
    });
    return false;
  }

  return true;
}

export function createApiServer(node) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const segments = url.pathname.split('/').filter(Boolean);

    if (request.method === 'OPTIONS') {
      sendJson(response, 204, {});
      return;
    }

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
          status: 'ok',
          ...node.getOverview()
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/chain') {
        sendJson(response, 200, node.getOverview());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/metrics') {
        sendJson(response, 200, node.getMetrics());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/network') {
        sendJson(response, 200, node.getNetworkTopology());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/finality') {
        sendJson(response, 200, node.getFinalityOverview());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/database') {
        sendJson(response, 200, node.getDatabaseStatus());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/treasury') {
        sendJson(response, 200, node.getTreasuryAnalytics());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/faucet') {
        sendJson(response, 200, node.getFaucetOverview());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/mempool') {
        sendJson(response, 200, {
          stats: node.getMempoolStats(),
          transactions: node.getMempool(url.searchParams.get('limit') || 50)
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/activity') {
        sendJson(response, 200, node.getActivityFeed(url.searchParams.get('limit') || 50));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/corridors') {
        sendJson(response, 200, node.getCorridors(url.searchParams.get('limit') || 20));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/search') {
        sendJson(response, 200, node.search(url.searchParams.get('q') || ''));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/blocks') {
        sendJson(response, 200, node.getBlocks(url.searchParams.get('limit') || 20));
        return;
      }

      if (request.method === 'GET' && segments[0] === 'blocks' && segments[1]) {
        sendJson(response, 200, node.getBlock(segments[1]));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/transactions') {
        sendJson(response, 200, node.getTransactions(url.searchParams.get('limit') || 50));
        return;
      }

      if (request.method === 'GET' && segments[0] === 'transactions' && segments[1]) {
        sendJson(response, 200, node.getTransaction(segments[1]));
        return;
      }

      if (request.method === 'GET' && segments[0] === 'accounts' && segments[1] && segments[2] === 'activity') {
        sendJson(response, 200, node.getAccountActivity(segments[1], url.searchParams.get('limit') || 20));
        return;
      }

      if (request.method === 'GET' && segments[0] === 'accounts' && segments[1]) {
        sendJson(response, 200, node.getAccount(segments[1]));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/validators') {
        sendJson(response, 200, node.getValidators());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/staking') {
        sendJson(response, 200, node.getStakingOverview());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/proposals') {
        sendJson(response, 200, node.getProposals());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/contracts') {
        sendJson(response, 200, node.getContracts());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/contracts/templates') {
        sendJson(response, 200, listContractTemplates());
        return;
      }

      if (request.method === 'GET' && segments[0] === 'contracts' && segments[1] && segments[2] === 'activity') {
        sendJson(response, 200, node.getContractActivity(segments[1], url.searchParams.get('limit') || 20));
        return;
      }

      if (request.method === 'GET' && segments[0] === 'contracts' && segments[1] && segments[2] === 'read') {
        const args = url.searchParams.get('args') ? JSON.parse(url.searchParams.get('args')) : {};
        sendJson(response, 200, node.readContract(segments[1], url.searchParams.get('method'), args));
        return;
      }

      if (request.method === 'GET' && segments[0] === 'contracts' && segments[1] && segments[2] !== 'read') {
        sendJson(response, 200, node.getContract(segments[1]));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/peers') {
        sendJson(response, 200, node.getPeers());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/snapshots/export') {
        if (!requireApiToken(request, response, node, 'operator')) {
          return;
        }

        sendJson(response, 200, node.createSnapshot());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/transactions') {
        const body = await readRequestBody(request);
        sendJson(response, 202, await node.submitTransaction(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/transactions/simulate') {
        const body = await readRequestBody(request);
        sendJson(response, 200, node.simulateTransaction(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/transactions/estimate') {
        const body = await readRequestBody(request);
        sendJson(response, 200, node.estimateTransactionCost(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/blocks/produce') {
        if (!requireApiToken(request, response, node, 'operator')) {
          return;
        }

        sendJson(response, 201, await node.produceBlock());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/faucet') {
        if (!requireApiToken(request, response, node, 'operator')) {
          return;
        }

        const body = await readRequestBody(request);
        sendJson(response, 201, await node.requestFaucet(body.address, body.amount, body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/peers') {
        if (!requireApiToken(request, response, node, 'operator')) {
          return;
        }

        const body = await readRequestBody(request);
        sendJson(response, 201, await node.announcePeer(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/peers/probe') {
        if (!requireApiToken(request, response, node, 'operator')) {
          return;
        }

        const body = await readRequestBody(request);
        sendJson(
          response,
          202,
          await node.probePeers({
            includeQuarantined: body.includeQuarantined,
            limit: body.limit,
            peerUrls: body.url ? [body.url] : body.peerUrls,
            timeoutMs: body.timeoutMs
          })
        );
        return;
      }

      if (request.method === 'POST' && url.pathname === '/peers/restore') {
        if (!requireApiToken(request, response, node, 'operator')) {
          return;
        }

        const body = await readRequestBody(request);
        sendJson(response, 200, {
          peer: node.restorePeer(body.url),
          peers: node.getPeers()
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/snapshots/save') {
        if (!requireApiToken(request, response, node, 'operator')) {
          return;
        }

        const body = await readRequestBody(request);
        sendJson(response, 201, {
          savedTo: await node.saveSnapshot(body.path)
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/snapshots/import') {
        if (!requireApiToken(request, response, node, 'operator')) {
          return;
        }

        const body = await readRequestBody(request);
        sendJson(response, 201, node.importSnapshot(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/network/sync') {
        if (!requireApiToken(request, response, node, 'operator')) {
          return;
        }

        const body = await readRequestBody(request);
        sendJson(response, 202, await node.syncWithPeers(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/network/gossip') {
        if (!requireApiToken(request, response, node, 'operator')) {
          return;
        }

        const body = await readRequestBody(request);
        sendJson(response, 202, await node.gossipNetworkState(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/sync/transactions') {
        if (!requireApiToken(request, response, node, 'peer')) {
          return;
        }

        const body = await readRequestBody(request);
        const { payload: transaction, relay } = parseRelayEnvelope(body, 'transaction');
        sendJson(
          response,
          202,
          await node.submitTransaction(transaction, {
            broadcast: Number(relay.ttl || 0) > 1,
            excludePeerUrls: [relay.sourceUrl].filter(Boolean),
            source: 'peer',
            ttl: Math.max(0, Number(relay.ttl || 0) - 1)
          })
        );
        return;
      }

      if (request.method === 'POST' && url.pathname === '/sync/blocks') {
        if (!requireApiToken(request, response, node, 'peer')) {
          return;
        }

        const body = await readRequestBody(request);
        const { payload: block, relay } = parseRelayEnvelope(body, 'block');
        sendJson(
          response,
          201,
          await node.acceptBlock(block, {
            broadcast: Number(relay.ttl || 0) > 1,
            excludePeerUrls: [relay.sourceUrl].filter(Boolean),
            ttl: Math.max(0, Number(relay.ttl || 0) - 1)
          })
        );
        return;
      }

      if (request.method === 'POST' && url.pathname === '/sync/peers') {
        if (!requireApiToken(request, response, node, 'peer')) {
          return;
        }

        const body = await readRequestBody(request);
        sendJson(
          response,
          202,
          await node.receivePeerAnnouncements(body.peers || [], {
            broadcast: Number(body.relay?.ttl || 0) > 1,
            sourceUrl: body.relay?.sourceUrl || null,
            ttl: Math.max(0, Number(body.relay?.ttl || 0) - 1)
          })
        );
        return;
      }

      sendJson(response, 404, {
        error: `Unknown route: ${request.method} ${url.pathname}`
      });
    } catch (error) {
      sendJson(response, 400, {
        error: error.message
      });
    }
  });

  return {
    listen(port, host = '0.0.0.0') {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          const address = server.address();
          resolve({
            host: typeof address === 'object' && address ? address.address : host,
            port: typeof address === 'object' && address ? address.port : port
          });
        });
      });
    },
    server
  };
}
