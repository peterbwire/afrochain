import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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

export async function saveSnapshotFile(filePath, snapshot) {
  if (!filePath) {
    throw new Error('A snapshot file path is required.');
  }

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
  return filePath;
}
