import { createServer, createConnection } from 'node:net';

import { nowIso, sha256Hex, stableStringify } from './utils.js';

const DEFAULT_PING_INTERVAL_MS = 10_000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 4_000;
const DEFAULT_SOCKET_GOSSIP_TTL = 2;

function parseSocketUrl(socketUrl) {
  const url = new URL(socketUrl);
  if (url.protocol !== 'tcp:') {
    throw new Error(`Unsupported socket peer URL: ${socketUrl}`);
  }

  return {
    host: url.hostname,
    port: Number(url.port || 0),
    url: socketUrl
  };
}

function createHandshakeProof(sharedSecret, payload) {
  return sha256Hex(`${sharedSecret}:${stableStringify(payload)}`);
}

function createMessageEnvelope(type, payload) {
  return `${JSON.stringify({ type, ...payload })}\n`;
}

export class AfroChainSocketTransport {
  constructor(node, options = {}) {
    this.node = node;
    this.host = options.host || '0.0.0.0';
    this.port = Number(options.port || 0);
    this.publicUrl = options.publicUrl || null;
    this.sharedSecret = options.sharedSecret || null;
    this.handshakeTimeoutMs = Number(options.handshakeTimeoutMs || DEFAULT_HANDSHAKE_TIMEOUT_MS);
    this.pingIntervalMs = Number(options.pingIntervalMs || DEFAULT_PING_INTERVAL_MS);
    this.server = null;
    this.connections = new Map();
    this.connectionByPeerUrl = new Map();
    this.pingInterval = null;
    this.node.registerRelayTransport(this);

    if (!this.sharedSecret) {
      throw new Error('Socket transport requires AFC_TRANSPORT_SHARED_SECRET.');
    }
  }

  createHelloPayload() {
    return {
      chainId: this.node.state.chainId,
      httpUrl: this.node.nodeMetadata.publicUrl,
      label: this.node.nodeMetadata.label,
      network: this.node.state.network,
      region: this.node.nodeMetadata.region,
      role: this.node.nodeMetadata.role,
      socketUrl: this.node.nodeMetadata.socketUrl || this.publicUrl,
      timestamp: nowIso()
    };
  }

  buildAuthenticatedHello() {
    const payload = {
      ...this.createHelloPayload(),
      nonce: sha256Hex(`${nowIso()}:${Math.random()}`)
    };

    return {
      auth: {
        mode: 'shared_secret',
        proof: createHandshakeProof(this.sharedSecret, payload)
      },
      payload
    };
  }

  async start() {
    if (this.server) {
      return {
        host: this.host,
        port: this.port,
        url: this.node.nodeMetadata.socketUrl
      };
    }

    this.server = createServer((socket) => {
      this.attachSocket(socket, {
        outbound: false
      });
    });

    const binding = await new Promise((resolve) => {
      this.server.listen(this.port, this.host, () => {
        const address = this.server.address();
        resolve({
          host: typeof address === 'object' && address ? address.address : this.host,
          port: typeof address === 'object' && address ? address.port : this.port
        });
      });
    });

    if (!this.publicUrl) {
      this.publicUrl = `tcp://${binding.host}:${binding.port}`;
    }

    this.node.nodeMetadata.socketUrl = this.publicUrl;
    this.pingInterval = setInterval(() => {
      for (const connection of this.connections.values()) {
        if (!connection.authenticated || connection.socket.destroyed) {
          continue;
        }

        connection.socket.write(
          createMessageEnvelope('ping', {
            timestamp: nowIso()
          })
        );
      }
    }, this.pingIntervalMs);

    return {
      ...binding,
      url: this.publicUrl
    };
  }

  async stop() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    for (const connection of this.connections.values()) {
      connection.socket.destroy();
    }
    this.connections.clear();
    this.connectionByPeerUrl.clear();

    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = null;
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  attachSocket(socket, options = {}) {
    const connectionId = sha256Hex(`${Date.now()}:${Math.random()}`).slice(0, 24);
    const connection = {
      authenticated: false,
      buffer: '',
      connectionId,
      outbound: Boolean(options.outbound),
      peerUrl: options.peerUrl || null,
      ready: null,
      readyReject: null,
      readyResolve: null,
      socket
    };
    connection.ready = new Promise((resolve, reject) => {
      connection.readyResolve = resolve;
      connection.readyReject = reject;
    });
    connection.ready.catch(() => {});
    this.connections.set(connectionId, connection);

    const handshakeTimer = setTimeout(() => {
      if (!connection.authenticated) {
        socket.destroy(new Error('Socket handshake timed out.'));
      }
    }, this.handshakeTimeoutMs);

    socket.setEncoding('utf8');
    socket.on('data', async (chunk) => {
      connection.buffer += chunk;
      const lines = connection.buffer.split('\n');
      connection.buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        try {
          const message = JSON.parse(line);
          await this.handleMessage(connection, message);
          if (connection.authenticated) {
            clearTimeout(handshakeTimer);
          }
        } catch (error) {
          if (connection.outbound) {
            connection.readyReject?.(error);
          }
          this.node.recordPeerFailure(connection.peerUrl || options.peerUrl || `socket:${connectionId}`, error, {
            status: 'failed'
          });
          socket.destroy();
          return;
        }
      }
    });

    socket.on('error', (error) => {
      if (connection.outbound) {
        connection.readyReject?.(error);
      }
      if (connection.peerUrl) {
        this.node.recordPeerFailure(connection.peerUrl, error, {
          status: 'failed'
        });
      }
    });

    socket.on('close', () => {
      clearTimeout(handshakeTimer);
      if (!connection.authenticated && connection.outbound) {
        connection.readyReject?.(new Error('Socket connection closed before handshake completed.'));
      }
      this.connections.delete(connectionId);
      if (connection.peerUrl) {
        this.connectionByPeerUrl.delete(connection.peerUrl);
      }
    });

    if (connection.outbound) {
      socket.on('connect', () => {
        this.sendHello(connection);
      });
    }

    return connection;
  }

  async connectToPeer(peerUrl) {
    if (this.connectionByPeerUrl.has(peerUrl)) {
      return this.connectionByPeerUrl.get(peerUrl);
    }

    const target = parseSocketUrl(peerUrl);
    const socket = createConnection({
      host: target.host,
      port: target.port
    });
    const connection = this.attachSocket(socket, {
      outbound: true,
      peerUrl
    });

    return connection.ready;
  }

  async connectToPeers(peerUrls = []) {
    const results = [];

    for (const peerUrl of peerUrls) {
      try {
        await this.connectToPeer(peerUrl);
        results.push({
          status: 'connected',
          url: peerUrl
        });
      } catch (error) {
        results.push({
          error: error.message,
          status: 'failed',
          url: peerUrl
        });
      }
    }

    return results;
  }

  sendHello(connection) {
    const hello = this.buildAuthenticatedHello();
    connection.socket.write(createMessageEnvelope('hello', hello));
  }

  async authenticatePeer(connection, payload, auth) {
    if (auth?.mode !== 'shared_secret') {
      throw new Error('Socket peer handshake requires shared secret authentication.');
    }

    const expectedProof = createHandshakeProof(this.sharedSecret, payload);
    if (auth.proof !== expectedProof) {
      throw new Error('Socket peer handshake proof did not match the shared transport secret.');
    }

    if (payload.chainId !== this.node.state.chainId) {
      throw new Error(`Peer is on chain ${payload.chainId}, expected ${this.node.state.chainId}.`);
    }

    if (payload.network !== this.node.state.network) {
      throw new Error(`Peer is on network ${payload.network}, expected ${this.node.state.network}.`);
    }

    if (!payload.socketUrl) {
      throw new Error('Socket peer handshake must include a socketUrl.');
    }

    connection.authenticated = true;
    connection.peerUrl = payload.socketUrl;
    this.connectionByPeerUrl.set(payload.socketUrl, connection);
    this.node.addPeer(
      {
        label: payload.label,
        region: payload.region,
        transport: 'socket',
        url: payload.socketUrl
      },
      {
        persist: false
      }
    );

    if (payload.httpUrl) {
      this.node.addPeer(
        {
          label: payload.label,
          region: payload.region,
          transport: 'http',
          url: payload.httpUrl
        },
        {
          persist: false
        }
      );
    }

    this.node.recordPeerSuccess(payload.socketUrl, {
      chainId: payload.chainId,
      network: payload.network,
      seenAt: nowIso(),
      status: 'reachable'
    });
    connection.readyResolve?.(connection);

    if (!connection.outbound || !connection.acknowledged) {
      connection.acknowledged = true;
      connection.socket.write(
        createMessageEnvelope('hello_ack', this.buildAuthenticatedHello())
      );
    }
  }

  async handleMessage(connection, message) {
    if (message.type === 'hello') {
      await this.authenticatePeer(connection, message.payload, message.auth);
      return;
    }

    if (message.type === 'hello_ack') {
      await this.authenticatePeer(connection, message.payload, message.auth);
      return;
    }

    if (!connection.authenticated) {
      throw new Error('Socket peer sent a relay payload before completing the handshake.');
    }

    if (message.type === 'ping') {
      connection.socket.write(
        createMessageEnvelope('pong', {
          timestamp: nowIso()
        })
      );
      return;
    }

    if (message.type === 'pong') {
      this.node.recordPeerSuccess(connection.peerUrl, {
        seenAt: nowIso(),
        status: 'reachable'
      });
      return;
    }

    if (message.type === 'transaction') {
      await this.node.submitTransaction(message.transaction, {
        broadcast: false,
        source: 'socket-peer'
      });
      await this.broadcastTransaction(message.transaction, {
        excludePeerUrls: [connection.peerUrl],
        ttl: Math.max(0, Number(message.relay?.ttl || 0) - 1)
      });
      return;
    }

    if (message.type === 'block') {
      await this.node.acceptBlock(message.block, {
        broadcast: false
      });
      await this.broadcastBlock(message.block, {
        excludePeerUrls: [connection.peerUrl],
        ttl: Math.max(0, Number(message.relay?.ttl || 0) - 1)
      });
      return;
    }

    if (message.type === 'peers') {
      await this.node.receivePeerAnnouncements(message.peers || [], {
        broadcast: false,
        persist: false,
        sourceUrl: connection.peerUrl,
        ttl: 0
      });
      await this.broadcastPeers(message.peers || [], {
        excludePeerUrls: [connection.peerUrl],
        ttl: Math.max(0, Number(message.relay?.ttl || 0) - 1)
      });
      return;
    }

    throw new Error(`Unsupported socket message type: ${message.type}`);
  }

  getConnectedPeerUrls() {
    return [...this.connectionByPeerUrl.keys()].sort();
  }

  async broadcastEnvelope(type, payload, options = {}) {
    const ttl = Math.max(0, Number(options.ttl ?? DEFAULT_SOCKET_GOSSIP_TTL));
    if (ttl <= 0) {
      return [];
    }

    const peers = this.node.getBroadcastPeers({
      excludePeerUrls: options.excludePeerUrls,
      fanout: options.fanout,
      transport: 'socket'
    });
    const envelopes = [];

    for (const peer of peers) {
      let connection = this.connectionByPeerUrl.get(peer.url);
      if (!connection) {
        try {
          connection = await this.connectToPeer(peer.url);
        } catch {
          continue;
        }
      }

      if (!connection?.authenticated) {
        continue;
      }

      connection.socket.write(
        createMessageEnvelope(type, {
          ...payload,
          relay: {
            sourceUrl: this.node.nodeMetadata.socketUrl || this.publicUrl,
            ttl
          }
        })
      );
      envelopes.push(peer.url);
    }

    return envelopes;
  }

  broadcastTransaction(transaction, options = {}) {
    return this.broadcastEnvelope('transaction', { transaction }, options);
  }

  broadcastBlock(block, options = {}) {
    return this.broadcastEnvelope('block', { block }, options);
  }

  broadcastPeers(peers, options = {}) {
    return this.broadcastEnvelope('peers', { peers }, options);
  }
}

export async function createSocketTransport(node, options = {}) {
  const transport = new AfroChainSocketTransport(node, options);
  await transport.start();
  if (options.peers?.length) {
    await transport.connectToPeers(options.peers);
  }

  return transport;
}
