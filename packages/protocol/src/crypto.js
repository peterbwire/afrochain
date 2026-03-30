import { createPublicKey, verify } from 'node:crypto';

import { sha256Hex, stableStringify } from './utils.js';

export function deriveAddress(publicKey) {
  return `afc_${sha256Hex(publicKey).slice(0, 40)}`;
}

export function isValidAddress(address) {
  return /^afc_[a-z0-9_]{4,64}$/i.test(address);
}

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

export function serializeTransaction(transaction) {
  return stableStringify(buildSignableTransaction(transaction));
}

export function createTransactionId(transaction) {
  return `tx_${sha256Hex(`${serializeTransaction(transaction)}:${transaction.signature || ''}`).slice(0, 24)}`;
}

export function verifyTransactionSignature(transaction) {
  if (!transaction?.sender || !transaction.publicKey || !transaction.signature) {
    return false;
  }

  if (deriveAddress(transaction.publicKey) !== transaction.sender) {
    return false;
  }

  try {
    const key = createPublicKey({
      key: Buffer.from(transaction.publicKey, 'base64'),
      format: 'der',
      type: 'spki'
    });

    return verify(
      'sha256',
      Buffer.from(serializeTransaction(transaction)),
      key,
      Buffer.from(transaction.signature, 'base64')
    );
  } catch {
    return false;
  }
}
