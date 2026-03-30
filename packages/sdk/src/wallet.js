import {
  base64ToArrayBuffer,
  bufferToBase64,
  deriveAddress,
  requireSubtleCrypto,
  sha256Hex,
  stableStringify
} from './helpers.js';

export function buildSignableTransaction(transaction) {
  return {
    fee: Number(transaction.fee || 0),
    nonce: Number(transaction.nonce || 0),
    payload: transaction.payload || {},
    publicKey: transaction.publicKey,
    sender: transaction.sender,
    timestamp: transaction.timestamp,
    type: transaction.type
  };
}

export function createUnsignedTransaction(config) {
  return {
    fee: Number(config.fee || 500),
    nonce: Number(config.nonce || 0),
    payload: config.payload || {},
    publicKey: config.publicKey,
    sender: config.sender,
    timestamp: config.timestamp || new Date().toISOString(),
    type: config.type
  };
}

export async function createWallet(label = 'AfroChain Wallet') {
  const subtle = requireSubtleCrypto();
  const keyPair = await subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256'
    },
    true,
    ['sign', 'verify']
  );

  const publicKey = bufferToBase64(await subtle.exportKey('spki', keyPair.publicKey));
  const privateKey = bufferToBase64(await subtle.exportKey('pkcs8', keyPair.privateKey));

  return {
    address: await deriveAddress(publicKey),
    createdAt: new Date().toISOString(),
    label,
    privateKey,
    publicKey
  };
}

export async function signTransaction(unsignedTransaction, privateKeyBase64) {
  const subtle = requireSubtleCrypto();
  const transaction = createUnsignedTransaction(unsignedTransaction);
  const privateKey = await subtle.importKey(
    'pkcs8',
    base64ToArrayBuffer(privateKeyBase64),
    {
      name: 'ECDSA',
      namedCurve: 'P-256'
    },
    false,
    ['sign']
  );

  const payload = stableStringify(buildSignableTransaction(transaction));
  const signatureBuffer = await subtle.sign(
    {
      hash: 'SHA-256',
      name: 'ECDSA'
    },
    privateKey,
    new TextEncoder().encode(payload)
  );
  const signature = bufferToBase64(signatureBuffer);

  return {
    ...transaction,
    id: `tx_${(await sha256Hex(`${payload}:${signature}`)).slice(0, 24)}`,
    signature
  };
}
