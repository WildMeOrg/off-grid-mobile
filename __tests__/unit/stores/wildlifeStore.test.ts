/**
 * Wildlife Store Unit Tests
 *
 * Tests for wildlife re-ID state management: packs, observations,
 * local individuals, sync queue, and MiewID model path.
 * Priority: P1 - Core wildlife re-ID functionality.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWildlifeStore } from '../../../src/stores/wildlifeStore';
import { initDatabase } from '../../../src/services/database';
import * as database from '../../../src/services/database';
import type {
  EmbeddingPack,
  Observation,
  Detection,
  LocalIndividual,
  MiewIDModelRecord,
  SyncQueueItem,
} from '../../../src/types';

// The mutating actions are wrapped in jest.fn() that pass through to
// the real (op-sqlite-mocked) implementation by default -- this lets the
// "rollback on SQLite write failure" tests below override one call with
// mockRejectedValueOnce, while every other test in this file keeps
// exercising the real repository logic unchanged.
jest.mock('../../../src/services/database', () => {
  const actual = jest.requireActual('../../../src/services/database');
  return {
    ...actual,
    insertObservationWithDetections: jest.fn(actual.insertObservationWithDetections),
    updateObservationNotes: jest.fn(actual.updateObservationNotes),
    updateDetectionFields: jest.fn(actual.updateDetectionFields),
    upsertSyncQueueItem: jest.fn(actual.upsertSyncQueueItem),
    updateSyncQueueFields: jest.fn(actual.updateSyncQueueFields),
  };
});

// ---------------------------------------------------------------------------
// Factory helpers (local to this test file)
// ---------------------------------------------------------------------------

const makePack = (overrides: Partial<EmbeddingPack> = {}): EmbeddingPack => ({
  id: 'pack-1',
  packVersion: '2025-06-01T00:00:00Z',
  species: 'whale_shark',
  featureClass: 'right_dorsal_fin',
  displayName: 'Whale Shark - Right Dorsal Fin',
  wildbookInstanceUrl: 'https://sharkbook.ai',
  exportDate: '2025-06-01T00:00:00Z',
  individualCount: 100,
  embeddingDim: 256,
  embeddingModelVersion: '1.0.0',
  detectorModelFile: '/packs/ws/detector.onnx',
  embeddingsFile: '/packs/ws/embeddings.bin',
  indexFile: '/packs/ws/index.json',
  referencePhotosDir: '/packs/ws/photos',
  packDir: '/packs/ws',
  downloadedAt: '2025-06-15T12:00:00Z',
  sizeBytes: 50_000_000,
  ...overrides,
});

const makeDetection = (overrides: Partial<Detection> = {}): Detection => ({
  id: 'det-1',
  observationId: 'obs-1',
  boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  species: 'whale_shark',
  speciesConfidence: 0.95,
  croppedImageUri: 'file:///crop1.jpg',
  embedding: [0.1, 0.2, 0.3],
  matchResult: {
    topCandidates: [],
    approvedIndividual: null,
    reviewStatus: 'pending',
  },
  encounterFields: {
    locationId: null,
    sex: null,
    lifeStage: null,
    behavior: null,
    submitterId: null,
    projectId: null,
  },
  ganeshaSubmissionId: null,
  ...overrides,
});

const makeObservation = (overrides: Partial<Observation> = {}): Observation => ({
  id: 'obs-1',
  photoUri: 'file:///photo1.jpg',
  gps: { lat: -8.5, lon: 115.5, accuracy: 10 },
  timestamp: '2025-06-15T10:30:00Z',
  deviceInfo: { model: 'Pixel 8', os: 'Android 14' },
  fieldNotes: null,
  detections: [makeDetection()],
  createdAt: '2025-06-15T10:30:00Z',
  ...overrides,
});

const makeLocalIndividual = (overrides: Partial<LocalIndividual> = {}): LocalIndividual => ({
  localId: 'FIELD-001',
  userLabel: null,
  species: 'whale_shark',
  embeddings: [[0.1, 0.2, 0.3]],
  referencePhotos: ['file:///ref1.jpg'],
  firstSeen: '2025-06-15T10:30:00Z',
  encounterCount: 1,
  syncStatus: 'pending',
  wildbookId: null,
  ...overrides,
});

const makeSyncQueueItem = (overrides: Partial<SyncQueueItem> = {}): SyncQueueItem => ({
  observationId: 'obs-1',
  status: 'pending',
  wildbookInstanceUrl: 'https://sharkbook.ai',
  retryCount: 0,
  lastError: null,
  lastAttempt: null,
  syncedAt: null,
  wildbookEncounterIds: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wildlifeStore', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    useWildlifeStore.getState().reset();
  });

  // ========================================================================
  // Packs
  // ========================================================================
  describe('packs', () => {
    it('starts with an empty packs array', () => {
      expect(useWildlifeStore.getState().packs).toEqual([]);
    });

    it('addPack appends a pack', () => {
      const pack = makePack();
      useWildlifeStore.getState().addPack(pack);

      expect(useWildlifeStore.getState().packs).toHaveLength(1);
      expect(useWildlifeStore.getState().packs[0]).toEqual(pack);
    });

    it('addPack replaces a pack with the same id', () => {
      const pack = makePack({ displayName: 'Original' });
      useWildlifeStore.getState().addPack(pack);

      const updated = makePack({ displayName: 'Updated' });
      useWildlifeStore.getState().addPack(updated);

      expect(useWildlifeStore.getState().packs).toHaveLength(1);
      expect(useWildlifeStore.getState().packs[0].displayName).toBe('Updated');
    });

    it('removePack removes a pack by id', () => {
      const pack1 = makePack({ id: 'pack-1' });
      const pack2 = makePack({ id: 'pack-2', species: 'manta_ray' });
      useWildlifeStore.getState().addPack(pack1);
      useWildlifeStore.getState().addPack(pack2);

      useWildlifeStore.getState().removePack('pack-1');

      const { packs } = useWildlifeStore.getState();
      expect(packs).toHaveLength(1);
      expect(packs[0].id).toBe('pack-2');
    });

    it('removePack is a no-op for unknown id', () => {
      useWildlifeStore.getState().addPack(makePack());
      useWildlifeStore.getState().removePack('nonexistent');

      expect(useWildlifeStore.getState().packs).toHaveLength(1);
    });

    it('setPacks replaces the entire pack list in one update', () => {
      useWildlifeStore.getState().addPack(makePack({ id: 'stale' }));

      useWildlifeStore.getState().setPacks([
        makePack({ id: 'pack-a', status: 'ready' }),
        makePack({ id: 'pack-b', status: 'quarantined' }),
      ]);

      const { packs } = useWildlifeStore.getState();
      expect(packs.map((p) => p.id)).toEqual(['pack-a', 'pack-b']);
      expect(packs[1].status).toBe('quarantined');
    });
  });

  // ========================================================================
  // Observations
  // ========================================================================
  describe('observations', () => {
    it('starts with an empty observations array', () => {
      expect(useWildlifeStore.getState().observations).toEqual([]);
    });

    it('addObservation appends an observation', () => {
      const obs = makeObservation();
      useWildlifeStore.getState().addObservation(obs);

      expect(useWildlifeStore.getState().observations).toHaveLength(1);
      expect(useWildlifeStore.getState().observations[0]).toEqual(obs);
    });

    it('addObservation appends multiple observations', () => {
      useWildlifeStore.getState().addObservation(makeObservation({ id: 'obs-1' }));
      useWildlifeStore.getState().addObservation(makeObservation({ id: 'obs-2' }));

      expect(useWildlifeStore.getState().observations).toHaveLength(2);
    });

    it('updates observation notes in memory and SQLite', async () => {
      await useWildlifeStore
        .getState()
        .addObservation(makeObservation({ id: 'obs-1', fieldNotes: null }));

      await useWildlifeStore
        .getState()
        .updateObservationNotes('obs-1', 'Herd moving north');

      expect(useWildlifeStore.getState().observations[0].fieldNotes).toBe(
        'Herd moving north',
      );
      expect(database.updateObservationNotes).toHaveBeenCalledWith(
        'obs-1',
        'Herd moving north',
      );
    });
  });

  // ========================================================================
  // updateDetection (nested update)
  // ========================================================================
  describe('updateDetection', () => {
    it('updates a detection within an observation', () => {
      const obs = makeObservation({
        id: 'obs-1',
        detections: [makeDetection({ id: 'det-1', observationId: 'obs-1' })],
      });
      useWildlifeStore.getState().addObservation(obs);

      useWildlifeStore.getState().updateDetection('obs-1', 'det-1', {
        speciesConfidence: 0.99,
      });

      const updated = useWildlifeStore.getState().observations[0].detections[0];
      expect(updated.speciesConfidence).toBe(0.99);
    });

    it('updates matchResult inside a detection', () => {
      const obs = makeObservation({
        id: 'obs-1',
        detections: [makeDetection({ id: 'det-1', observationId: 'obs-1' })],
      });
      useWildlifeStore.getState().addObservation(obs);

      useWildlifeStore.getState().updateDetection('obs-1', 'det-1', {
        matchResult: {
          topCandidates: [{ individualId: 'ind-42', score: 0.97, source: 'pack', refPhotoIndex: 0 }],
          approvedIndividual: 'ind-42',
          reviewStatus: 'approved',
        },
      });

      const result = useWildlifeStore.getState().observations[0].detections[0].matchResult;
      expect(result.approvedIndividual).toBe('ind-42');
      expect(result.reviewStatus).toBe('approved');
      expect(result.topCandidates).toHaveLength(1);
    });

    it('does not affect other detections in the same observation', () => {
      const obs = makeObservation({
        id: 'obs-1',
        detections: [
          makeDetection({ id: 'det-1', observationId: 'obs-1', speciesConfidence: 0.9 }),
          makeDetection({ id: 'det-2', observationId: 'obs-1', speciesConfidence: 0.8 }),
        ],
      });
      useWildlifeStore.getState().addObservation(obs);

      useWildlifeStore.getState().updateDetection('obs-1', 'det-1', {
        speciesConfidence: 0.99,
      });

      const dets = useWildlifeStore.getState().observations[0].detections;
      expect(dets[0].speciesConfidence).toBe(0.99);
      expect(dets[1].speciesConfidence).toBe(0.8);
    });

    it('is a no-op when observation not found', () => {
      const obs = makeObservation({ id: 'obs-1' });
      useWildlifeStore.getState().addObservation(obs);

      useWildlifeStore.getState().updateDetection('obs-999', 'det-1', {
        speciesConfidence: 0.99,
      });

      // Original unchanged
      expect(useWildlifeStore.getState().observations[0].detections[0].speciesConfidence).toBe(0.95);
    });
  });

  // ========================================================================
  // Local Individuals
  // ========================================================================
  describe('localIndividuals', () => {
    it('starts with an empty localIndividuals array', () => {
      expect(useWildlifeStore.getState().localIndividuals).toEqual([]);
    });

    it('addLocalIndividual appends an individual', () => {
      const ind = makeLocalIndividual();
      useWildlifeStore.getState().addLocalIndividual(ind);

      expect(useWildlifeStore.getState().localIndividuals).toHaveLength(1);
      expect(useWildlifeStore.getState().localIndividuals[0]).toEqual(ind);
    });
  });

  // ========================================================================
  // addEmbeddingToLocalIndividual
  // ========================================================================
  describe('addEmbeddingToLocalIndividual', () => {
    it('appends embedding, photo, and increments encounterCount', () => {
      const ind = makeLocalIndividual({
        localId: 'FIELD-001',
        embeddings: [[0.1, 0.2]],
        referencePhotos: ['file:///ref1.jpg'],
        encounterCount: 1,
      });
      useWildlifeStore.getState().addLocalIndividual(ind);

      useWildlifeStore.getState().addEmbeddingToLocalIndividual(
        'FIELD-001',
        [0.3, 0.4],
        'file:///ref2.jpg',
      );

      const updated = useWildlifeStore.getState().localIndividuals[0];
      expect(updated.embeddings).toHaveLength(2);
      expect(updated.embeddings[1]).toEqual([0.3, 0.4]);
      expect(updated.referencePhotos).toHaveLength(2);
      expect(updated.referencePhotos[1]).toBe('file:///ref2.jpg');
      expect(updated.encounterCount).toBe(2);
    });

    it('does not affect other individuals', () => {
      useWildlifeStore.getState().addLocalIndividual(
        makeLocalIndividual({ localId: 'FIELD-001', encounterCount: 1 }),
      );
      useWildlifeStore.getState().addLocalIndividual(
        makeLocalIndividual({ localId: 'FIELD-002', encounterCount: 3 }),
      );

      useWildlifeStore.getState().addEmbeddingToLocalIndividual(
        'FIELD-001',
        [0.5, 0.6],
        'file:///new.jpg',
      );

      expect(useWildlifeStore.getState().localIndividuals[0].encounterCount).toBe(2);
      expect(useWildlifeStore.getState().localIndividuals[1].encounterCount).toBe(3);
    });
  });

  // ========================================================================
  // getNextFieldId
  // ========================================================================
  describe('getNextFieldId', () => {
    it('returns FIELD-001 on first call', () => {
      const id = useWildlifeStore.getState().getNextFieldId();
      expect(id).toBe('FIELD-001');
    });

    it('returns FIELD-002, FIELD-003, etc. on subsequent calls', () => {
      const { getNextFieldId } = useWildlifeStore.getState();
      expect(getNextFieldId()).toBe('FIELD-001');
      expect(getNextFieldId()).toBe('FIELD-002');
      expect(getNextFieldId()).toBe('FIELD-003');
    });

    it('persists the counter (nextFieldId increments in state)', () => {
      useWildlifeStore.getState().getNextFieldId(); // FIELD-001
      useWildlifeStore.getState().getNextFieldId(); // FIELD-002

      expect(useWildlifeStore.getState().nextFieldId).toBe(3);
    });
  });

  // ========================================================================
  // Sync Queue
  // ========================================================================
  describe('syncQueue', () => {
    it('starts with an empty syncQueue', () => {
      expect(useWildlifeStore.getState().syncQueue).toEqual([]);
    });

    it('addToSyncQueue appends an item', () => {
      const item = makeSyncQueueItem();
      useWildlifeStore.getState().addToSyncQueue(item);

      expect(useWildlifeStore.getState().syncQueue).toHaveLength(1);
      expect(useWildlifeStore.getState().syncQueue[0]).toEqual(item);
    });

    it('addToSyncQueue appends multiple items', () => {
      useWildlifeStore.getState().addToSyncQueue(makeSyncQueueItem({ observationId: 'obs-1' }));
      useWildlifeStore.getState().addToSyncQueue(makeSyncQueueItem({ observationId: 'obs-2' }));

      expect(useWildlifeStore.getState().syncQueue).toHaveLength(2);
    });
  });

  // ========================================================================
  // updateSyncStatus
  // ========================================================================
  describe('updateSyncStatus', () => {
    it('updates sync status fields by observationId', () => {
      useWildlifeStore.getState().addToSyncQueue(makeSyncQueueItem({ observationId: 'obs-1' }));

      useWildlifeStore.getState().updateSyncStatus('obs-1', {
        status: 'uploading',
        lastAttempt: '2025-06-15T11:00:00Z',
      });

      const item = useWildlifeStore.getState().syncQueue[0];
      expect(item.status).toBe('uploading');
      expect(item.lastAttempt).toBe('2025-06-15T11:00:00Z');
    });

    it('does not affect other sync queue items', () => {
      useWildlifeStore.getState().addToSyncQueue(makeSyncQueueItem({ observationId: 'obs-1' }));
      useWildlifeStore.getState().addToSyncQueue(makeSyncQueueItem({ observationId: 'obs-2' }));

      useWildlifeStore.getState().updateSyncStatus('obs-1', { status: 'synced' });

      expect(useWildlifeStore.getState().syncQueue[0].status).toBe('synced');
      expect(useWildlifeStore.getState().syncQueue[1].status).toBe('pending');
    });

    it('updates retryCount and lastError on failure', () => {
      useWildlifeStore.getState().addToSyncQueue(makeSyncQueueItem({ observationId: 'obs-1' }));

      useWildlifeStore.getState().updateSyncStatus('obs-1', {
        status: 'failed',
        retryCount: 1,
        lastError: 'Network timeout',
      });

      const item = useWildlifeStore.getState().syncQueue[0];
      expect(item.status).toBe('failed');
      expect(item.retryCount).toBe(1);
      expect(item.lastError).toBe('Network timeout');
    });
  });

  // ========================================================================
  // MiewID Model Record
  // ========================================================================
  describe('miewidModel', () => {
    const makeModelRecord = (
      overrides: Partial<MiewIDModelRecord> = {},
    ): MiewIDModelRecord => ({
      path: '/models/miewid-4.1.0.onnx',
      name: 'miewid',
      version: '4.1.0',
      sha256: 'abc123',
      sizeBytes: 103_859_027,
      status: 'ready',
      verifiedAt: '2026-08-01T00:00:00.000Z',
      format: 'onnx',
      ...overrides,
    });

    it('starts as null', () => {
      expect(useWildlifeStore.getState().miewidModel).toBeNull();
    });

    it('setMiewidModel stores a full record', () => {
      const record = makeModelRecord();

      useWildlifeStore.getState().setMiewidModel(record);

      expect(useWildlifeStore.getState().miewidModel).toEqual(record);
    });

    it('setMiewidModel can clear the record', () => {
      useWildlifeStore.getState().setMiewidModel(makeModelRecord());
      useWildlifeStore.getState().setMiewidModel(null);

      expect(useWildlifeStore.getState().miewidModel).toBeNull();
    });

    it('updateMiewidModelStatus updates only the status', () => {
      const record = makeModelRecord({ status: 'missing' });
      useWildlifeStore.getState().setMiewidModel(record);

      useWildlifeStore.getState().updateMiewidModelStatus('downloading');

      const updated = useWildlifeStore.getState().miewidModel;
      expect(updated?.status).toBe('downloading');
      expect(updated?.path).toBe(record.path);
      expect(updated?.sha256).toBe(record.sha256);
    });

    it('updateMiewidModelStatus is a no-op when no record exists', () => {
      useWildlifeStore.getState().updateMiewidModelStatus('ready');

      expect(useWildlifeStore.getState().miewidModel).toBeNull();
    });
  });

  // ========================================================================
  // Persist migration
  // ========================================================================
  describe('persist migration', () => {
    it('migrates a legacy miewidModelPath string into a model record', async () => {
      await AsyncStorage.setItem(
        'wildlife-store',
        JSON.stringify({
          state: { miewidModelPath: '/old/models/miewid.onnx' },
          version: 0,
        }),
      );

      await useWildlifeStore.persist.rehydrate();

      const state = useWildlifeStore.getState();
      expect(state.miewidModel).toEqual({
        path: '/old/models/miewid.onnx',
        name: 'miewid',
        version: 'unknown',
        sha256: null,
        sizeBytes: null,
        status: 'missing',
        verifiedAt: null,
        format: 'onnx',
      });
      expect(
        (state as unknown as { miewidModelPath?: unknown }).miewidModelPath,
      ).toBeUndefined();
    });

    it('migrates a legacy null miewidModelPath to a null record', async () => {
      await AsyncStorage.setItem(
        'wildlife-store',
        JSON.stringify({
          state: { miewidModelPath: null },
          version: 0,
        }),
      );

      await useWildlifeStore.persist.rehydrate();

      expect(useWildlifeStore.getState().miewidModel).toBeNull();
    });

    it('adds an unknown artifact version to legacy packs', async () => {
      const legacyPack = makePack();
      const { packVersion: _packVersion, ...packWithoutVersion } = legacyPack;
      await AsyncStorage.setItem(
        'wildlife-store',
        JSON.stringify({
          state: { packs: [packWithoutVersion] },
          version: 1,
        }),
      );

      await useWildlifeStore.persist.rehydrate();

      expect(useWildlifeStore.getState().packs[0].packVersion).toBe('unknown');
    });

    it('rehydrates a current-version record unchanged', async () => {
      const record = {
        path: '/models/miewid-4.1.0.onnx',
        name: 'miewid',
        version: '4.1.0',
        sha256: 'abc123',
        sizeBytes: 103_859_027,
        status: 'ready',
        verifiedAt: '2026-08-01T00:00:00.000Z',
        format: 'onnx',
      };
      await AsyncStorage.setItem(
        'wildlife-store',
        JSON.stringify({ state: { miewidModel: record }, version: 3 }),
      );

      await useWildlifeStore.persist.rehydrate();

      expect(useWildlifeStore.getState().miewidModel).toEqual(record);
    });

    it('backfills format onnx for a pre-format-field (version 2) record', async () => {
      const legacyRecord = {
        path: '/models/miewid-4.1.0.onnx',
        name: 'miewid',
        version: '4.1.0',
        sha256: 'abc123',
        sizeBytes: 103_859_027,
        status: 'ready',
        verifiedAt: '2026-08-01T00:00:00.000Z',
      };
      await AsyncStorage.setItem(
        'wildlife-store',
        JSON.stringify({ state: { miewidModel: legacyRecord }, version: 2 }),
      );

      await useWildlifeStore.persist.rehydrate();

      expect(useWildlifeStore.getState().miewidModel).toEqual({
        ...legacyRecord,
        format: 'onnx',
      });
    });
  });

  // ========================================================================
  // Reset
  // ========================================================================
  describe('reset', () => {
    it('clears all state back to initial values', () => {
      // Populate every slice
      useWildlifeStore.getState().addPack(makePack());
      useWildlifeStore.getState().addObservation(makeObservation());
      useWildlifeStore.getState().addLocalIndividual(makeLocalIndividual());
      useWildlifeStore.getState().addToSyncQueue(makeSyncQueueItem());
      useWildlifeStore.getState().setMiewidModel({
        path: '/models/miewid.onnx',
        name: 'miewid',
        version: '4.1.0',
        sha256: 'abc123',
        sizeBytes: 1000,
        status: 'ready',
        verifiedAt: '2026-08-01T00:00:00.000Z',
        format: 'onnx',
      });
      useWildlifeStore.getState().getNextFieldId(); // bumps counter to 2

      useWildlifeStore.getState().reset();

      const state = useWildlifeStore.getState();
      expect(state.packs).toEqual([]);
      expect(state.observations).toEqual([]);
      expect(state.localIndividuals).toEqual([]);
      expect(state.syncQueue).toEqual([]);
      expect(state.miewidModel).toBeNull();
      expect(state.nextFieldId).toBe(1);
    });
  });

  // ========================================================================
  // Rollback on SQLite write failure
  //
  // These four actions optimistically update in-memory state before the
  // SQLite write resolves (so existing synchronous call sites keep working).
  // If the write fails, the in-memory state must be rolled back -- otherwise
  // the UI would show data that was never durably saved and silently
  // vanishes on the next app restart.
  // ========================================================================
  describe('rollback on SQLite write failure', () => {
    it('addObservation rolls back the observation if the SQLite write fails', async () => {
      (database.insertObservationWithDetections as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
      const obs = makeObservation();

      await expect(useWildlifeStore.getState().addObservation(obs)).rejects.toThrow('disk full');

      expect(useWildlifeStore.getState().observations).toHaveLength(0);
    });

    it('updateDetection restores the previous observation if the SQLite write fails', async () => {
      const obs = makeObservation({
        id: 'obs-1',
        detections: [makeDetection({ id: 'det-1', observationId: 'obs-1', speciesConfidence: 0.5 })],
      });
      await useWildlifeStore.getState().addObservation(obs);

      (database.updateDetectionFields as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

      await expect(
        useWildlifeStore.getState().updateDetection('obs-1', 'det-1', { speciesConfidence: 0.99 }),
      ).rejects.toThrow('disk full');

      expect(useWildlifeStore.getState().observations[0].detections[0].speciesConfidence).toBe(0.5);
    });

    it('updateObservationNotes restores previous notes if the SQLite write fails', async () => {
      await useWildlifeStore
        .getState()
        .addObservation(makeObservation({ id: 'obs-1', fieldNotes: 'Original' }));
      (database.updateObservationNotes as jest.Mock).mockRejectedValueOnce(
        new Error('disk full'),
      );

      await expect(
        useWildlifeStore
          .getState()
          .updateObservationNotes('obs-1', 'Replacement'),
      ).rejects.toThrow('disk full');

      expect(useWildlifeStore.getState().observations[0].fieldNotes).toBe(
        'Original',
      );
    });

    it('addToSyncQueue rolls back the item if the SQLite write fails', async () => {
      (database.upsertSyncQueueItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
      const item = makeSyncQueueItem();

      await expect(useWildlifeStore.getState().addToSyncQueue(item)).rejects.toThrow('disk full');

      expect(useWildlifeStore.getState().syncQueue).toHaveLength(0);
    });

    it('updateSyncStatus restores the previous item if the SQLite write fails', async () => {
      const item = makeSyncQueueItem({ observationId: 'obs-1', status: 'pending' });
      await useWildlifeStore.getState().addToSyncQueue(item);

      (database.updateSyncQueueFields as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

      await expect(
        useWildlifeStore.getState().updateSyncStatus('obs-1', { status: 'synced' }),
      ).rejects.toThrow('disk full');

      expect(useWildlifeStore.getState().syncQueue[0].status).toBe('pending');
    });
  });
});
