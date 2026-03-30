export const AFC_DECIMALS = 6;
export const AFC_UNIT = 10 ** AFC_DECIMALS;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = sortValue(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

export function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

export function bufferToBase64(buffer) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }

  const bytes = new Uint8Array(buffer);
  let encoded = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = ((bytes[index] || 0) << 16) | ((bytes[index + 1] || 0) << 8) | (bytes[index + 2] || 0);
    encoded += BASE64_ALPHABET[(chunk >> 18) & 63];
    encoded += BASE64_ALPHABET[(chunk >> 12) & 63];
    encoded += index + 1 < bytes.length ? BASE64_ALPHABET[(chunk >> 6) & 63] : '=';
    encoded += index + 2 < bytes.length ? BASE64_ALPHABET[chunk & 63] : '=';
  }

  return encoded;
}

export function base64ToArrayBuffer(base64) {
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(base64, 'base64')).buffer;
  }

  const sanitized = base64.replace(/=+$/, '');
  const bytes = [];

  for (let index = 0; index < sanitized.length; index += 4) {
    const chunk =
      (BASE64_ALPHABET.indexOf(sanitized[index] || 'A') << 18) |
      (BASE64_ALPHABET.indexOf(sanitized[index + 1] || 'A') << 12) |
      (BASE64_ALPHABET.indexOf(sanitized[index + 2] || 'A') << 6) |
      BASE64_ALPHABET.indexOf(sanitized[index + 3] || 'A');
    bytes.push((chunk >> 16) & 255);
    if (sanitized[index + 2]) {
      bytes.push((chunk >> 8) & 255);
    }
    if (sanitized[index + 3]) {
      bytes.push(chunk & 255);
    }
  }

  return new Uint8Array(bytes).buffer;
}

export async function sha256Hex(value) {
  const payload = typeof value === 'string' ? value : stableStringify(value);
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function deriveAddress(publicKey) {
  return `afc_${(await sha256Hex(publicKey)).slice(0, 40)}`;
}

export function formatUnits(amount) {
  return amount / AFC_UNIT;
}

export function parseUnits(value) {
  return Math.round(Number(value || 0) * AFC_UNIT);
}

export function requireSubtleCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required to use the AfroChain SDK.');
  }

  return globalThis.crypto.subtle;
}
