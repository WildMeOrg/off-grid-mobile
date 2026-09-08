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
  migrateLegacyObservationData,
  type LegacyObservationData,
} from '../services/database';
import logger from '../utils/logger';
import { migrateWildlifeState } from './wildlifeStoreMigration';

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
  legacyObservationData: LegacyObservationData | null;

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
  legacyObservationData: null as LegacyObservationData | null,
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
      version: 4,
      migrate: migrateWildlifeState,
      // observations/syncQueue are deliberately excluded: they now live in
      // SQLite (see hydrateObservationsFromDb), not this AsyncStorage blob.
      partialize: (state) => ({
        packs: state.packs,
        localIndividuals: state.localIndividuals,
        miewidModel: state.miewidModel,
        nextFieldId: state.nextFieldId,
        legacyObservationData: state.legacyObservationData,
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
  const { legacyObservationData } = useWildlifeStore.getState();
  if (legacyObservationData) {
    await migrateLegacyObservationData(legacyObservationData);
  }
  const [observations, syncQueue] = await Promise.all([
    listObservationsWithDetections(),
    listSyncQueue(),
  ]);
  for (const item of syncQueue) {
    if (item.status !== 'uploading') continue;
    const recovery = {
      status: 'failed' as const,
      lastError: 'Upload interrupted. Please retry.',
    };
    await updateSyncQueueFields(item.observationId, recovery);
    Object.assign(item, recovery);
  }
  useWildlifeStore.setState({ observations, syncQueue, legacyObservationData: null });
}
