import type { SyncQueueItem } from '../../types';
import { getDb } from './connection';
import { mapSyncQueueRow } from './rowMapping';
import type { SyncQueueRow } from './rowMapping';

/**
 * Inserts (or replaces) a standalone sync_queue row. See schema.ts for why
 * observation_id has no FOREIGN KEY constraint -- the real production path
 * (insertObservationWithDetections) always creates this row transactionally
 * alongside its parent observation; this function exists for the store's
 * addToSyncQueue action, kept as a general standalone primitive.
 */
export async function upsertSyncQueueItem(item: SyncQueueItem): Promise<void> {
  const database = getDb();
  await database.execute(
    `INSERT OR REPLACE INTO sync_queue
      (observation_id, status, wildbook_instance_url, retry_count, last_error, last_attempt, synced_at, wildbook_encounter_ids_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.observationId,
      item.status,
      item.wildbookInstanceUrl,
      item.retryCount,
      item.lastError,
      item.lastAttempt,
      item.syncedAt,
      JSON.stringify(item.wildbookEncounterIds),
    ],
  );
}

/** Loads every sync queue item, by observation id. */
export async function listSyncQueue(): Promise<SyncQueueItem[]> {
  const database = getDb();
  const { rows } = await database.execute('SELECT * FROM sync_queue ORDER BY observation_id ASC;');
  return (rows as unknown as SyncQueueRow[]).map(mapSyncQueueRow);
}

/** Applies a partial update to one sync queue row, identified by observationId. */
export async function updateSyncQueueFields(
  observationId: string,
  updates: Partial<SyncQueueItem>,
): Promise<void> {
  const database = getDb();
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) {
    setClauses.push('status = ?');
    params.push(updates.status);
  }
  if (updates.wildbookInstanceUrl !== undefined) {
    setClauses.push('wildbook_instance_url = ?');
    params.push(updates.wildbookInstanceUrl);
  }
  if (updates.retryCount !== undefined) {
    setClauses.push('retry_count = ?');
    params.push(updates.retryCount);
  }
  if (updates.lastError !== undefined) {
    setClauses.push('last_error = ?');
    params.push(updates.lastError);
  }
  if (updates.lastAttempt !== undefined) {
    setClauses.push('last_attempt = ?');
    params.push(updates.lastAttempt);
  }
  if (updates.syncedAt !== undefined) {
    setClauses.push('synced_at = ?');
    params.push(updates.syncedAt);
  }
  if (updates.wildbookEncounterIds !== undefined) {
    setClauses.push('wildbook_encounter_ids_json = ?');
    params.push(JSON.stringify(updates.wildbookEncounterIds));
  }

  if (setClauses.length === 0) {
    return;
  }

  params.push(observationId);
  await database.execute(`UPDATE sync_queue SET ${setClauses.join(', ')} WHERE observation_id = ?;`, params as never[]);
}

/** Deletes every observation, detection, and sync queue row. Does not touch packs/model/local individuals. */
export async function clearAllObservationData(): Promise<void> {
  const database = getDb();
  await database.transaction(async (tx) => {
    await tx.execute('DELETE FROM sync_queue;');
    await tx.execute('DELETE FROM detections;');
    await tx.execute('DELETE FROM observations;');
  });
}
