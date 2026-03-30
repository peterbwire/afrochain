import { fileURLToPath } from 'node:url';

import { saveSnapshotFile } from '../persistence.js';
import { AfroChainNode } from '../node.js';

const snapshotPath =
  process.env.AFC_SNAPSHOT_PATH || fileURLToPath(new URL('../../../data/node-snapshot.json', import.meta.url));
const databasePath =
  process.env.AFC_DB_PATH || fileURLToPath(new URL('../../../data/node-state.sqlite', import.meta.url));
const exportPath =
  process.env.AFC_EXPORT_PATH || fileURLToPath(new URL('../../../data/exported-snapshot.json', import.meta.url));

const node = await AfroChainNode.createFromDisk({
  databasePath,
  snapshotPath
});

await saveSnapshotFile(exportPath, node.createSnapshot());
console.log(`AfroChain snapshot exported to ${exportPath}`);
