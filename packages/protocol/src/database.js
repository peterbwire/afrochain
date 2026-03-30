import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class AfroChainDatabase {
  constructor(filePath) {
    this.filePath = filePath;
    this.db = new DatabaseSync(filePath);
    this.initialize();
  }

  initialize() {
    this.db.exec(`
      create table if not exists snapshots (
        id integer primary key autoincrement,
        exported_at text not null,
        height integer not null,
        tip_hash text not null,
        payload text not null
      );

      create table if not exists sync_runs (
        id integer primary key autoincrement,
        completed_at text not null,
        peer_count integer not null,
        payload text not null
      );
    `);
  }

  saveSnapshot(snapshot) {
    const tip = snapshot.chain.at(-1);
    this.db
      .prepare('insert into snapshots (exported_at, height, tip_hash, payload) values (?, ?, ?, ?)')
      .run(snapshot.exportedAt, tip.height, tip.hash, JSON.stringify(snapshot));
    this.db.exec(`
      delete from snapshots
      where id not in (
        select id from snapshots order by id desc limit 10
      );
    `);

    return {
      height: tip.height,
      tipHash: tip.hash
    };
  }

  loadLatestSnapshot() {
    const row = this.db.prepare('select payload from snapshots order by id desc limit 1').get();
    return row ? JSON.parse(row.payload) : null;
  }

  recordSyncRun(summary) {
    this.db
      .prepare('insert into sync_runs (completed_at, peer_count, payload) values (?, ?, ?)')
      .run(summary.completedAt, summary.peers.length, JSON.stringify(summary));
    this.db.exec(`
      delete from sync_runs
      where id not in (
        select id from sync_runs order by id desc limit 25
      );
    `);
  }

  getStatus() {
    const latestSnapshot = this.db
      .prepare('select exported_at, height, tip_hash from snapshots order by id desc limit 1')
      .get();
    const latestSync = this.db
      .prepare('select completed_at, peer_count from sync_runs order by id desc limit 1')
      .get();
    const snapshotCount = this.db.prepare('select count(*) as count from snapshots').get().count;
    const syncRunCount = this.db.prepare('select count(*) as count from sync_runs').get().count;

    return {
      enabled: true,
      filePath: this.filePath,
      latestSnapshot: latestSnapshot
        ? {
            exportedAt: latestSnapshot.exported_at,
            height: latestSnapshot.height,
            tipHash: latestSnapshot.tip_hash
          }
        : null,
      latestSync: latestSync
        ? {
            completedAt: latestSync.completed_at,
            peerCount: latestSync.peer_count
          }
        : null,
      snapshotCount,
      syncRunCount
    };
  }

  close() {
    this.db.close();
  }
}

export async function createDatabase(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
  return new AfroChainDatabase(filePath);
}
