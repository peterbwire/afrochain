import { createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { sha256Hex, stableStringify } from './utils.js';

function normalizeRoots(allowedRoots = []) {
  return [...new Set((allowedRoots || []).filter(Boolean).map((root) => resolve(root)))];
}

function isPathInsideRoot(targetPath, rootPath) {
  const normalizedTarget = resolve(targetPath);
  const normalizedRoot = resolve(rootPath);
  const relativePath = relative(normalizedRoot, normalizedTarget);

  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function signManifest(manifest, signingSecret) {
  return createHmac('sha256', signingSecret).update(stableStringify(manifest)).digest('hex');
}

function stripSnapshotMetadata(snapshot = {}) {
  const { manifest, manifestSignature, ...snapshotBody } = snapshot;
  return snapshotBody;
}

export function buildSnapshotManifest(snapshot) {
  const snapshotBody = stripSnapshotMetadata(snapshot);
  const tip = snapshotBody.chain?.at(-1) || null;

  return {
    chainId: snapshotBody.state?.chainId || null,
    exportedAt: snapshotBody.exportedAt || null,
    height: Number(tip?.height ?? -1),
    network: snapshotBody.state?.network || null,
    snapshotHash: sha256Hex(snapshotBody),
    snapshotVersion: Number(snapshotBody.snapshotVersion || 0),
    stateRoot: tip?.stateRoot || null,
    tipHash: tip?.hash || null
  };
}

export function finalizeSnapshot(snapshot, options = {}) {
  const manifest = buildSnapshotManifest(snapshot);
  const finalizedSnapshot = {
    ...stripSnapshotMetadata(snapshot),
    manifest
  };

  if (options.signingSecret) {
    finalizedSnapshot.manifestSignature = signManifest(manifest, options.signingSecret);
  }

  return finalizedSnapshot;
}

export function verifySnapshotEnvelope(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Snapshot payload must be a JSON object.');
  }

  const expectedManifest = buildSnapshotManifest(snapshot);
  const hasManifest = Boolean(snapshot.manifest);
  const requireManifest = options.requireManifest !== false;

  if (requireManifest && !hasManifest) {
    throw new Error('Snapshot is missing a manifest.');
  }

  if (hasManifest && stableStringify(snapshot.manifest) !== stableStringify(expectedManifest)) {
    throw new Error('Snapshot manifest does not match the snapshot payload.');
  }

  const requireSignature = Boolean(options.requireSignature);
  const hasSignature = Boolean(snapshot.manifestSignature);

  if (requireSignature && !hasSignature) {
    throw new Error('Snapshot signature is required for import on this node.');
  }

  if (hasSignature) {
    if (!options.signingSecret) {
      if (requireSignature) {
        throw new Error('Snapshot signature could not be verified because no signing secret is configured.');
      }

      return {
        manifest: snapshot.manifest || expectedManifest,
        signatureVerified: false,
        signed: true
      };
    }

    const expectedSignature = signManifest(expectedManifest, options.signingSecret);
    if (snapshot.manifestSignature !== expectedSignature) {
      throw new Error('Snapshot signature verification failed.');
    }
  }

  return {
    manifest: snapshot.manifest || expectedManifest,
    signatureVerified: hasSignature,
    signed: hasSignature
  };
}

export function resolveSnapshotWritePath(filePath, options = {}) {
  if (!filePath) {
    throw new Error('A snapshot file path is required.');
  }

  const targetPath = resolve(filePath);
  const allowedRoots = normalizeRoots(options.allowedRoots);

  if (allowedRoots.length && !allowedRoots.some((rootPath) => isPathInsideRoot(targetPath, rootPath))) {
    throw new Error(`Snapshot path ${targetPath} is outside the allowed snapshot roots.`);
  }

  return targetPath;
}

export async function loadSnapshotFile(filePath) {
  if (!filePath) {
    return null;
  }

  try {
    const snapshot = await readFile(filePath, 'utf8');
    return JSON.parse(snapshot);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function saveSnapshotFile(filePath, snapshot, options = {}) {
  const targetPath = resolveSnapshotWritePath(filePath, {
    allowedRoots: options.allowedRoots
  });

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(snapshot, null, 2), 'utf8');
  return targetPath;
}
