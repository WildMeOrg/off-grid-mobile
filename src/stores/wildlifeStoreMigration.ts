import type { EmbeddingPack, MiewIDModelRecord } from '../types';

export function migrateWildlifeState(persisted: unknown, fromVersion: number): Record<string, unknown> {
  const state = persisted as Record<string, unknown>;
  if (fromVersion < 1) {
    const legacyPath = state.miewidModelPath as string | null | undefined;
    state.miewidModel = legacyPath
      ? ({
          path: legacyPath,
          name: 'miewid',
          version: 'unknown',
          sha256: null,
          sizeBytes: null,
          status: 'missing',
          verifiedAt: null,
          format: 'onnx',
        } satisfies MiewIDModelRecord)
      : null;
    delete state.miewidModelPath;
  }
  if (fromVersion < 2) {
    const legacyPacks = Array.isArray(state.packs) ? (state.packs as EmbeddingPack[]) : [];
    state.packs = legacyPacks.map((pack) => ({
      ...pack,
      packVersion: pack.packVersion ?? 'unknown',
    }));
  }
  if (fromVersion < 3) {
    const legacyModel = state.miewidModel as (MiewIDModelRecord & { format?: unknown }) | null | undefined;
    if (legacyModel && !legacyModel.format) {
      state.miewidModel = { ...legacyModel, format: 'onnx' };
    }
  }
  if (fromVersion < 4) {
    const observations = Array.isArray(state.observations) ? state.observations : [];
    const syncQueue = Array.isArray(state.syncQueue) ? state.syncQueue : [];
    state.legacyObservationData = observations.length || syncQueue.length
      ? { observations, syncQueue }
      : null;
    delete state.observations;
    delete state.syncQueue;
  }
  return state;
}