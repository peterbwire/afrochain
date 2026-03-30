import { base64ToArrayBuffer, bufferToBase64, requireSubtleCrypto } from './helpers.js';

const KEYSTORE_TYPE = 'afrochain-keystore';
const KEYSTORE_VERSION = 1;
const DEFAULT_PBKDF2_ITERATIONS = 210_000;
const AES_GCM_IV_BYTES = 12;
const PBKDF2_SALT_BYTES = 16;

function assertPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 8) {
    throw new Error('Wallet passphrase must be at least 8 characters long.');
  }
}

function randomBytes(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveEncryptionKey(passphrase, saltBase64, iterations) {
  const subtle = requireSubtleCrypto();
  const passphraseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return subtle.deriveKey(
    {
      hash: 'SHA-256',
      iterations,
      name: 'PBKDF2',
      salt: base64ToArrayBuffer(saltBase64)
    },
    passphraseKey,
    {
      length: 256,
      name: 'AES-GCM'
    },
    false,
    ['encrypt', 'decrypt']
  );
}

export function isWalletKeystore(candidate) {
  return (
    candidate?.type === KEYSTORE_TYPE &&
    Number(candidate?.version) === KEYSTORE_VERSION &&
    typeof candidate?.crypto?.ciphertext === 'string' &&
    typeof candidate?.crypto?.iv === 'string' &&
    typeof candidate?.kdf?.salt === 'string'
  );
}

export function parseWalletKeystore(serializedKeystore) {
  const parsedKeystore =
    typeof serializedKeystore === 'string' ? JSON.parse(serializedKeystore) : serializedKeystore;

  if (!isWalletKeystore(parsedKeystore)) {
    throw new Error('Keystore payload is not valid AfroChain wallet storage.');
  }

  return parsedKeystore;
}

export function serializeWalletKeystore(keystore) {
  return JSON.stringify(parseWalletKeystore(keystore));
}

export async function encryptWallet(wallet, passphrase, options = {}) {
  if (!wallet?.privateKey || !wallet?.publicKey || !wallet?.address) {
    throw new Error('A complete wallet is required before it can be encrypted.');
  }

  assertPassphrase(passphrase);

  const subtle = requireSubtleCrypto();
  const iterations = Number(options.iterations || DEFAULT_PBKDF2_ITERATIONS);
  const salt = bufferToBase64(randomBytes(PBKDF2_SALT_BYTES));
  const iv = bufferToBase64(randomBytes(AES_GCM_IV_BYTES));
  const encryptionKey = await deriveEncryptionKey(passphrase, salt, iterations);
  const plaintext = new TextEncoder().encode(JSON.stringify(wallet));
  const ciphertext = await subtle.encrypt(
    {
      iv: base64ToArrayBuffer(iv),
      name: 'AES-GCM'
    },
    encryptionKey,
    plaintext
  );

  return {
    address: wallet.address,
    createdAt: wallet.createdAt,
    crypto: {
      cipher: 'AES-GCM',
      ciphertext: bufferToBase64(ciphertext),
      iv
    },
    kdf: {
      hash: 'SHA-256',
      iterations,
      name: 'PBKDF2',
      salt
    },
    label: wallet.label,
    publicKey: wallet.publicKey,
    type: KEYSTORE_TYPE,
    updatedAt: new Date().toISOString(),
    version: KEYSTORE_VERSION
  };
}

export async function decryptWallet(keystore, passphrase) {
  const parsedKeystore = parseWalletKeystore(keystore);

  assertPassphrase(passphrase);

  try {
    const subtle = requireSubtleCrypto();
    const decryptionKey = await deriveEncryptionKey(
      passphrase,
      parsedKeystore.kdf.salt,
      Number(parsedKeystore.kdf.iterations || DEFAULT_PBKDF2_ITERATIONS)
    );
    const plaintext = await subtle.decrypt(
      {
        iv: base64ToArrayBuffer(parsedKeystore.crypto.iv),
        name: 'AES-GCM'
      },
      decryptionKey,
      base64ToArrayBuffer(parsedKeystore.crypto.ciphertext)
    );
    const wallet = JSON.parse(new TextDecoder().decode(plaintext));

    if (wallet.address !== parsedKeystore.address || wallet.publicKey !== parsedKeystore.publicKey) {
      throw new Error('Keystore integrity check failed.');
    }

    return wallet;
  } catch (error) {
    if (error.message === 'Keystore integrity check failed.') {
      throw error;
    }

    throw new Error('Wallet unlock failed. Check the passphrase and try again.');
  }
}

export async function changeWalletPassphrase(keystore, currentPassphrase, nextPassphrase, options = {}) {
  const wallet = await decryptWallet(keystore, currentPassphrase);
  return encryptWallet(wallet, nextPassphrase, options);
}
