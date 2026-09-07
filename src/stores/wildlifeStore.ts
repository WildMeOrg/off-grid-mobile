import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  EmbeddingPack,
  Observation,
  Detection,
  LocalIndividual,
  MiewIDModelRecord,
  MiewIDModelStatus,
  SyncQueueItem,
} from '../types';
import {
  insertObservationWithDetections,
  updateObservationNotes,
  updateDetectionFields,
  upsertSyncQueueItem,
  updateSyncQueueFields,
  listObservationsWithDetections,
  listSyncQueue,
  clearAllObservationData,
} from '../services/database';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------
//
// `observations` and `syncQueue` are durably persisted in SQLite (see
// services/database), not in this store's AsyncStorage-backed `persist`
// blob -- every write below updates in-memory state synchronously (so
// existing synchronous call sites and selectors keep working unchanged) AND
// returns a promise that resolves once the SQLite write actually commits,
// for the one call site (capture flow) that needs to know a save is durable
// before telling the user it's safe. `packs`, `localIndividuals`,
// `miewidModel`, and `nextFieldId` are unaffected by this migration --
// small, non-relational, and fine as a persisted JSON blob.

interface WildlifeState {
  // Data slices
  packs: EmbeddingPack[];
  observations: Observation[];
  localIndividuals: LocalIndividual[];
  syncQueue: SyncQueueItem[];
  miewidModel: MiewIDModelRecord | null;
  nextFieldId: number;

  // Pack actions
  addPack: (pack: EmbeddingPack) => void;
  removePack: (packId: string) => void;
  setPacks: (packs: EmbeddingPack[]) => void;

  // Observation actions (durably persisted to SQLite -- see above)
  addObservation: (observation: Observation) => Promise<void>;
  updateObservationNotes: (
    observationId: string,
    fieldNotes: string | null,
  ) => Promise<void>;
  updateDetection: (
    observationId: string,
    detectionId: string,
    updates: Partial<Detection>,
  ) => Promise<void>;

  // Local individual actions
  addLocalIndividual: (individual: LocalIndividual) => void;
  addEmbeddingToLocalIndividual: (
    localId: string,
    embedding: number[],
    refPhotoUri: string,
  ) => void;

  // Field ID generator
  getNextFieldId: () => string;

  // Sync queue actions (durably persisted to SQLite -- see above)
  addToSyncQueue: (item: SyncQueueItem) => Promise<void>;
  updateSyncStatus: (
    observationId: string,
    updates: Partial<SyncQueueItem>,
  ) => Promise<void>;

  // MiewID model record
  setMiewidModel: (record: MiewIDModelRecord | null) => void;
  updateMiewidModelStatus: (status: MiewIDModelStatus) => void;

  // Reset
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Initial data (actions excluded -- they are functions, not persisted)
// ---------------------------------------------------------------------------

const INITIAL_STATE = {
  packs: [] as EmbeddingPack[],
  observations: [] as Observation[],
  localIndividuals: [] as LocalIndividual[],
  syncQueue: [] as SyncQueueItem[],
  miewidModel: null as MiewIDModelRecord | null,
  nextFieldId: 1,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWildlifeStore = create<WildlifeState>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      // ---- Pack actions ---------------------------------------------------
      addPack: (pack) =>
        set((state) => ({
          packs: [
            ...state.packs.filter((p) => p.id !== pack.id),
            pack,
          ],
        })),

      removePack: (packId) =>
        set((state) => ({
          packs: state.packs.filter((p) => p.id !== packId),
        })),

      setPacks: (packs) => set({ packs }),

      // ---- Observation actions --------------------------------------------
      addObservation: (observation) => {
        set((state) => ({
          observations: [...state.observations, observation],
        }));
        return insertObservationWithDetections(observation).catch((error) => {
          logger.error('[wildlifeStore] Failed to persist observation to SQLite -- rolling back in-memory state:', error);
          set((state) => ({
            observations: state.observations.filter((obs) => obs.id !== observation.id),
          }));
          throw error;
        });
      },

      updateObservationNotes: (observationId, fieldNotes) => {
        const previousObservation = get().observations.find(
          (observation) => observation.id === observationId,
        );
        set((state) => ({
          observations: state.observations.map((observation) =>
            observation.id === observationId
              ? { ...observation, fieldNotes }
              : observation,
          ),
        }));
        return updateObservationNotes(observationId, fieldNotes).catch(
          (error) => {
            logger.error(
              '[wildlifeStore] Failed to persist observation notes to SQLite -- rolling back in-memory state:',
              error,
            );
            if (previousObservation) {
              set((state) => ({
                observations: state.observations.map((observation) =>
                  observation.id === observationId
                    ? previousObservation
                    : observation,
                ),
              }));
            }
            throw error;
          },
        );
      },

      updateDetection: (observationId, detectionId, updates) => {
        const previousObservation = get().observations.find((obs) => obs.id === observationId);
        set((state) => ({
          observations: state.observations.map((obs) =>
            obs.id === observationId
              ? {
                  ...obs,
                  detections: obs.detections.map((det) =>
                    det.id === detectionId ? { ...det, ...updates } : det,
                  ),
                }
              : obs,
          ),
        }));
        return updateDetectionFields(observationId, detectionId, updates).catch((error) => {
          logger.error('[wildlifeStore] Failed to persist detection update to SQLite -- rolling back in-memory state:', error);
          if (previousObservation) {
            set((state) => ({
              observations: state.observations.map((obs) =>
                obs.id === observationId ? previousObservation : obs,
              ),
            }));
          }
          throw error;
        });
      },

      // ---- Local individual actions ---------------------------------------
      addLocalIndividual: (individual) =>
        set((state) => ({
          localIndividuals: [...state.localIndividuals, individual],
        })),

      addEmbeddingToLocalIndividual: (localId, embedding, refPhotoUri) =>
        set((state) => ({
          localIndividuals: state.localIndividuals.map((ind) =>
            ind.localId === localId
              ? {
                  ...ind,
                  embeddings: [...ind.embeddings, embedding],
                  referencePhotos: [...ind.referencePhotos, refPhotoUri],
                  encounterCount: ind.encounterCount + 1,
                }
              : ind,
          ),
        })),

      // ---- Field ID generator ---------------------------------------------
      getNextFieldId: () => {
        const { nextFieldId } = get();
        const id = `FIELD-${String(nextFieldId).padStart(3, '0')}`;
        set({ nextFieldId: nextFieldId + 1 });
        return id;
      },

      // ---- Sync queue actions ---------------------------------------------
      addToSyncQueue: (item) => {
        set((state) => ({
          syncQueue: [...state.syncQueue, item],
        }));
        return upsertSyncQueueItem(item).catch((error) => {
          logger.error('[wildlifeStore] Failed to persist sync queue item to SQLite -- rolling back in-memory state:', error);
          set((state) => ({
            syncQueue: state.syncQueue.filter((i) => i.observationId !== item.observationId),
          }));
          throw error;
        });
      },

      updateSyncStatus: (observationId, updates) => {
        const previousItem = get().syncQueue.find((item) => item.observationId === observationId);
        set((state) => ({
          syncQueue: state.syncQueue.map((item) =>
            item.observationId === observationId
              ? { ...item, ...updates }
              : item,
          ),
        }));
        return updateSyncQueueFields(observationId, updates).catch((error) => {
          logger.error('[wildlifeStore] Failed to persist sync status to SQLite -- rolling back in-memory state:', error);
          if (previousItem) {
            set((state) => ({
              syncQueue: state.syncQueue.map((item) =>
                item.observationId === observationId ? previousItem : item,
              ),
            }));
          }
          throw error;
        });
      },

      // ---- MiewID model record ---------------------------------------------
      setMiewidModel: (record) => set({ miewidModel: record }),

      updateMiewidModelStatus: (status) =>
        set((state) =>
          state.miewidModel
            ? { miewidModel: { ...state.miewidModel, status } }
            : {},
        ),

      // ---- Reset ------------------------------------------------------------
      reset: () => {
        set({ ...INITIAL_STATE });
        clearAllObservationData().catch((error) => {
          logger.error('[wildlifeStore] Failed to clear SQLite observation data on reset:', error);
        });
      },
    }),
    {
      name: 'wildlife-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 3,
      migrate: (persisted, fromVersion) => {
        const state = persisted as Record<string, unknown>;
        if (fromVersion < 1) {
          // v0 persisted a bare `miewidModelPath: string | null`. Wrap it in
          // a MiewIDModelRecord with status 'missing'; startup reconciliation
          // promotes it to 'ready' if the file checks out on disk.
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
          const legacyPacks = Array.isArray(state.packs)
            ? (state.packs as EmbeddingPack[])
            : [];
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
        return state;
      },
      // observations/syncQueue are deliberately excluded: they now live in
      // SQLite (see hydrateObservationsFromDb), not this AsyncStorage blob.
      partialize: (state) => ({
        packs: state.packs,
        localIndividuals: state.localIndividuals,
        miewidModel: state.miewidModel,
        nextFieldId: state.nextFieldId,
      }),
    },
  ),
);

/**
 * Loads observations and the sync queue from SQLite into the store's
 * in-memory state. Call once during app startup, after initDatabase() and
 * after the AsyncStorage-backed slice has rehydrated -- see App.tsx.
 */
export async function hydrateObservationsFromDb(): Promise<void> {
  const [observations, syncQueue] = await Promise.all([
    listObservationsWithDetections(),
    listSyncQueue(),
  ]);
  useWildlifeStore.setState({ observations, syncQueue });
}
