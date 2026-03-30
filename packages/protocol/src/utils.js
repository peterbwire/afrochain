import { createHash } from 'node:crypto';

export const AFC_DECIMALS = 6;
export const AFC_UNIT = 10 ** AFC_DECIMALS;
export const AFC_SYMBOL = 'AFC';

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

export function sha256Hex(value) {
  const input = typeof value === 'string' ? value : stableStringify(value);
  return createHash('sha256').update(input).digest('hex');
}

export function deepClone(value) {
  return structuredClone(value);
}

export function sumRecord(record = {}) {
  return Object.values(record).reduce((total, value) => total + Number(value || 0), 0);
}

export function createId(prefix, payload) {
  return `${prefix}_${sha256Hex(payload).slice(0, 24)}`;
}

export function corridorKey(origin = 'Local', destination = 'Local') {
  return `${origin} -> ${destination}`;
}

export function pickWeighted(items, seedHex) {
  const weightedItems = items.filter((item) => item.weight > 0);
  const totalWeight = weightedItems.reduce((sum, item) => sum + item.weight, 0);

  if (!weightedItems.length || totalWeight <= 0) {
    return null;
  }

  const pivot = Number.parseInt(seedHex.slice(0, 12), 16) % totalWeight;
  let cursor = 0;

  for (const item of weightedItems) {
    cursor += item.weight;
    if (pivot < cursor) {
      return item.key;
    }
  }

  return weightedItems.at(-1)?.key ?? null;
}

export function clampNumber(value, min, max) {
  return Math.min(Math.max(Number(value), min), max);
}

export function formatUnits(amount) {
  return amount / AFC_UNIT;
}

export function nowIso() {
  return new Date().toISOString();
}
