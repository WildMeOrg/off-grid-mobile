import type { Observation, SyncQueueItem } from '../../types';
import {
  insertObservationWithDetections,
  listObservationsWithDetections,
} from './observationsRepository';
import { listSyncQueue, upsertSyncQueueItem } from './syncQueueRepository';

export interface LegacyObservationData {
  observations: Observation[];
  syncQueue: SyncQueueItem[];
}

export async function migrateLegacyObservationData(data: LegacyObservationData): Promise<void> {
  const observations = await listObservationsWithDetections();
  const syncQueue = await listSyncQueue();
  const observationIds = new Set(observations.map((observation) => observation.id));
  const queueById = new Map(syncQueue.map((item) => [item.observationId, item]));
  const legacyQueueById = new Map(data.syncQueue.map((item) => [item.observationId, item]));

  for (const observation of data.observations) {
    if (observationIds.has(observation.id)) continue;
    const queueItem = queueById.get(observation.id) ?? legacyQueueById.get(observation.id);
    await insertObservationWithDetections(observation, queueItem);
    observationIds.add(observation.id);
    if (queueItem) queueById.set(observation.id, queueItem);
  }

  for (const item of data.syncQueue) {
    if (queueById.has(item.observationId)) continue;
    await upsertSyncQueueItem(item);
    queueById.set(item.observationId, item);
  }
}