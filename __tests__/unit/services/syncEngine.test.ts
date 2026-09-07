import type { Detection, MatchCandidate, Observation, SyncQueueItem } from '../../../src/types';

jest.mock('../../../src/stores/wildlifeStore', () => ({
  useWildlifeStore: { getState: jest.fn() },
}));

jest.mock('../../../src/services/ganeshaApiClient', () => ({
  ganeshaApiClient: { getUploadUrl: jest.fn(), submitObservation: jest.fn() },
}));

jest.mock('../../../src/services/packManager', () => ({
  packManager: { loadPackIndex: jest.fn() },
}));

jest.mock('react-native-fs', () => ({
  uploadFiles: jest.fn(),
}));

import { syncObservation, syncAllObservations } from '../../../src/services/syncEngine';
import { useWildlifeStore } from '../../../src/stores/wildlifeStore';
import { ganeshaApiClient } from '../../../src/services/ganeshaApiClient';
import { packManager } from '../../../src/services/packManager';
import RNFS from 'react-native-fs';

const mockGetState = useWildlifeStore.getState as jest.Mock;
const mockGetUploadUrl = ganeshaApiClient.getUploadUrl as jest.Mock;
const mockSubmitObservation = ganeshaApiClient.submitObservation as jest.Mock;
const mockLoadPackIndex = packManager.loadPackIndex as jest.Mock;
const mockUploadFiles = RNFS.uploadFiles as jest.Mock;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

const makeCandidate = (overrides: Partial<MatchCandidate> = {}): MatchCandidate => ({
  individualId: 'elephant-thomas',
  score: 0.95,
  source: 'pack',
  refPhotoIndex: 0,
  ...overrides,
});

const makeDetection = (overrides: Partial<Detection> = {}): Detection => ({
  id: 'det-1',
  observationId: 'obs-1',
  boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  species: 'elephant',
  speciesConfidence: 0.95,
  croppedImageUri: '/data/crops/det-1.jpg',
  embedding: [0.1, 0.2, 0.3],
  matchResult: {
    topCandidates: [makeCandidate()],
    approvedIndividual: 'elephant-thomas',
    reviewStatus: 'approved',
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
  photoUri: '/data/photos/obs-1.jpg',
  gps: { lat: -33.5, lon: 26.9, accuracy: 5 },
  timestamp: '2026-08-23T10:00:00Z',
  deviceInfo: { model: 'Pixel 9a', os: 'Android 16' },
  fieldNotes: null,
  detections: [makeDetection()],
  createdAt: '2026-08-23T10:00:00Z',
  ...overrides,
});

const makeSyncItem = (overrides: Partial<SyncQueueItem> = {}): SyncQueueItem => ({
  observationId: 'obs-1',
  status: 'pending',
  wildbookInstanceUrl: '',
  retryCount: 0,
  lastError: null,
  lastAttempt: null,
  syncedAt: null,
  wildbookEncounterIds: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Test harness -- a minimal in-memory stand-in for the wildlifeStore, kept
// in sync the same way the real store keeps SQLite in sync: updateDetection/
// updateSyncStatus mutate the arrays these getters close over, so a
// subsequent getState() call inside syncEngine reflects prior writes within
// the same test, exactly like the real store does.
// ---------------------------------------------------------------------------

let observations: Observation[];
let syncQueue: SyncQueueItem[];
let updateSyncStatus: jest.Mock;
let updateDetection: jest.Mock;

function installStore(initialObservations: Observation[], initialSyncQueue: SyncQueueItem[]): void {
  observations = initialObservations;
  syncQueue = initialSyncQueue;
  updateSyncStatus = jest.fn(async (observationId: string, updates: Partial<SyncQueueItem>) => {
    syncQueue = syncQueue.map((item) => (item.observationId === observationId ? { ...item, ...updates } : item));
  });
  updateDetection = jest.fn(async (observationId: string, detectionId: string, updates: Partial<Detection>) => {
    observations = observations.map((obs) =>
      obs.id === observationId
        ? { ...obs, detections: obs.detections.map((d) => (d.id === detectionId ? { ...d, ...updates } : d)) }
        : obs,
    );
  });
  mockGetState.mockImplementation(() => ({
    get observations() {
      return observations;
    },
    get syncQueue() {
      return syncQueue;
    },
    updateSyncStatus,
    updateDetection,
    packs: [
      {
        id: 'example-project',
        indexFile: '/data/packs/example-project/embeddings/index.json',
      },
    ],
  }));
}

/** Default RNFS.uploadFiles mock: the blob PUT succeeds with HTTP 200. */
function installHappyUpload(): void {
  mockUploadFiles.mockImplementation(() => ({
    jobId: 1,
    promise: Promise.resolve({ jobId: 1, statusCode: 200, headers: {}, body: '' }),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  installHappyUpload();
  mockGetUploadUrl.mockImplementation(async (_projectId: string, filename: string) => ({
    ok: true,
    data: {
      uploadUrl: `https://blob.example/upload/${filename}?sig=x`,
      blobUrl: `https://blob.example/${filename}`,
    },
  }));
  mockSubmitObservation.mockResolvedValue({
    ok: true,
    data: { submissionId: 'sub-1', status: 'reviewing', imageUrl: 'https://blob.example/signed.jpg' },
  });
  mockLoadPackIndex.mockResolvedValue([
    {
      id: 'elephant-thomas',
      name: 'Thomas',
      referencePhotos: ['ref_01.jpg'],
    },
  ]);
});

// ---------------------------------------------------------------------------
// syncObservation
// ---------------------------------------------------------------------------

describe('syncObservation', () => {
  it('leaves the observation untouched when a detection is still pending review', async () => {
    installStore(
      [makeObservation({ detections: [makeDetection({ matchResult: { topCandidates: [], approvedIndividual: null, reviewStatus: 'pending' } })] })],
      [makeSyncItem()],
    );

    const result = await syncObservation(observations[0]);

    expect(result).toEqual({ observationId: 'obs-1', status: 'waiting-for-review' });
    expect(updateSyncStatus).not.toHaveBeenCalled();
    expect(mockGetUploadUrl).not.toHaveBeenCalled();
  });

  it('uploads the photo and submits an approved pack-matched detection', async () => {
    installStore([makeObservation()], [makeSyncItem()]);

    const result = await syncObservation(observations[0]);

    expect(result).toEqual({ observationId: 'obs-1', status: 'synced', submittedCount: 1 });
    expect(mockGetUploadUrl).toHaveBeenCalledWith('example-project', 'det-1.jpg');
    expect(mockUploadFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        toUrl: 'https://blob.example/upload/det-1.jpg?sig=x',
        method: 'PUT',
        binaryStreamOnly: true,
        files: [
          expect.objectContaining({
            filepath: '/data/crops/det-1.jpg',
            filetype: 'image/jpeg',
          }),
        ],
        headers: expect.objectContaining({ 'x-ms-blob-type': 'BlockBlob' }),
      }),
    );
    expect(mockSubmitObservation).toHaveBeenCalledWith(
      'example-project',
      expect.objectContaining({
        imageUrl: 'https://blob.example/det-1.jpg',
        elephantId: 'elephant-thomas',
        elephantName: 'Thomas',
        confidence: 0.95,
        lat: -33.5,
        long: 26.9,
      }),
    );
    expect(updateDetection).toHaveBeenCalledWith('obs-1', 'det-1', { ganeshaSubmissionId: 'sub-1' });
    const finalQueueItem = syncQueue.find((i) => i.observationId === 'obs-1');
    expect(finalQueueItem?.status).toBe('synced');
    expect(finalQueueItem?.wildbookEncounterIds).toEqual(['sub-1']);
  });

  it('still submits when pack display-name resolution fails', async () => {
    mockLoadPackIndex.mockRejectedValueOnce(new Error('pack index unreadable'));
    installStore([makeObservation()], [makeSyncItem()]);

    const result = await syncObservation(observations[0]);

    expect(result.status).toBe('synced');
    expect(mockSubmitObservation).toHaveBeenCalledWith(
      'example-project',
      expect.objectContaining({ elephantName: null }),
    );
  });

  it('fails when the blob upload itself throws (e.g. a network error)', async () => {
    mockUploadFiles.mockImplementation(() => ({
      jobId: 1,
      promise: Promise.reject(new Error('Network request failed')),
    }));
    installStore([makeObservation()], [makeSyncItem()]);

    const result = await syncObservation(observations[0]);

    expect(result.status).toBe('failed');
    expect((result as { message: string }).message).toContain('blob upload failed');
    expect(mockSubmitObservation).not.toHaveBeenCalled();
  });

  it('fails when the blob upload returns a non-2xx status code', async () => {
    mockUploadFiles.mockImplementation(() => ({
      jobId: 1,
      promise: Promise.resolve({ jobId: 1, statusCode: 403, headers: {}, body: 'Forbidden' }),
    }));
    installStore([makeObservation()], [makeSyncItem()]);

    const result = await syncObservation(observations[0]);

    expect(result.status).toBe('failed');
    expect((result as { message: string }).message).toContain('HTTP 403');
  });

  it('uploads full evidence for a provisional local individual before marking it synced', async () => {
    installStore(
      [
        makeObservation({
          detections: [
            makeDetection({
              matchResult: {
                topCandidates: [makeCandidate()],
                approvedIndividual: 'FIELD-001',
                reviewStatus: 'approved',
              },
            }),
          ],
        }),
      ],
      [makeSyncItem()],
    );

    const result = await syncObservation(observations[0]);

    expect(result).toEqual({ observationId: 'obs-1', status: 'synced', submittedCount: 1 });
    expect(mockGetUploadUrl).toHaveBeenNthCalledWith(1, 'example-project', 'obs-1-source.jpg');
    expect(mockGetUploadUrl).toHaveBeenNthCalledWith(2, 'example-project', 'det-1.jpg');
    expect(mockSubmitObservation).toHaveBeenCalledWith(
      'example-project',
      expect.objectContaining({
        imageUrl: 'https://blob.example/det-1.jpg',
        sourceImageUrl: 'https://blob.example/obs-1-source.jpg',
        elephantId: null,
        provisionalId: 'FIELD-001',
        reviewDecision: 'unknown',
        detectedSpecies: 'elephant',
        detectorConfidence: 0.95,
        boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        alternatives: [makeCandidate()],
        lat: -33.5,
        long: 26.9,
        captureTimestamp: '2026-08-23T10:00:00Z',
      }),
    );
    expect(updateDetection).toHaveBeenCalledWith('obs-1', 'det-1', { ganeshaSubmissionId: 'sub-1' });
    expect(syncQueue[0].wildbookEncounterIds).toEqual(['sub-1']);
  });

  it('skips a detection that was already submitted on a prior attempt (idempotent retry)', async () => {
    installStore(
      [makeObservation({ detections: [makeDetection({ ganeshaSubmissionId: 'sub-existing' })] })],
      [makeSyncItem({ status: 'failed', retryCount: 1 })],
    );

    const result = await syncObservation(observations[0]);

    expect(result).toEqual({ observationId: 'obs-1', status: 'synced', submittedCount: 0 });
    expect(mockGetUploadUrl).not.toHaveBeenCalled();
    expect(syncQueue[0].wildbookEncounterIds).toEqual(['sub-existing']);
  });

  it('marks the observation failed with an incremented retry count when the upload URL request fails', async () => {
    mockGetUploadUrl.mockResolvedValue({ ok: false, code: 'http-error', message: 'HTTP 500' });
    installStore([makeObservation()], [makeSyncItem({ retryCount: 1 })]);

    const result = await syncObservation(observations[0]);

    expect(result.status).toBe('failed');
    expect(updateDetection).not.toHaveBeenCalled();
    const finalQueueItem = syncQueue.find((i) => i.observationId === 'obs-1');
    expect(finalQueueItem?.status).toBe('failed');
    expect(finalQueueItem?.retryCount).toBe(2);
    expect(finalQueueItem?.lastError).toContain('upload-url request failed');
  });

  it('marks the observation failedPermanent once the retry count reaches the threshold', async () => {
    mockSubmitObservation.mockResolvedValue({ ok: false, code: 'http-error', message: 'HTTP 500' });
    installStore([makeObservation()], [makeSyncItem({ retryCount: 4 })]);

    await syncObservation(observations[0]);

    const finalQueueItem = syncQueue.find((i) => i.observationId === 'obs-1');
    expect(finalQueueItem?.status).toBe('failedPermanent');
    expect(finalQueueItem?.retryCount).toBe(5);
  });

  it('marks the observation synced with no submissions when every detection was rejected', async () => {
    installStore(
      [
        makeObservation({
          detections: [makeDetection({ matchResult: { topCandidates: [makeCandidate()], approvedIndividual: null, reviewStatus: 'rejected' } })],
        }),
      ],
      [makeSyncItem()],
    );

    const result = await syncObservation(observations[0]);

    expect(result).toEqual({ observationId: 'obs-1', status: 'synced', submittedCount: 0 });
    expect(mockSubmitObservation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// syncAllObservations
// ---------------------------------------------------------------------------

describe('syncAllObservations', () => {
  it('syncs pending/failed queue items and aggregates outcomes, skipping synced/uploading ones', async () => {
    const pendingReviewObs = makeObservation({
      id: 'obs-waiting',
      detections: [makeDetection({ id: 'det-waiting', matchResult: { topCandidates: [], approvedIndividual: null, reviewStatus: 'pending' } })],
    });
    const readyObs = makeObservation({ id: 'obs-ready', detections: [makeDetection({ id: 'det-ready' })] });
    const alreadySyncedObs = makeObservation({ id: 'obs-synced' });

    installStore(
      [pendingReviewObs, readyObs, alreadySyncedObs],
      [
        makeSyncItem({ observationId: 'obs-waiting', status: 'pending' }),
        makeSyncItem({ observationId: 'obs-ready', status: 'failed', retryCount: 0 }),
        makeSyncItem({ observationId: 'obs-synced', status: 'synced' }),
      ],
    );

    const result = await syncAllObservations();

    expect(result).toEqual({ synced: 1, uploaded: 1, waitingForReview: 1, failed: 0 });
    // The already-synced observation was never touched (no re-submit call for it).
    expect(mockSubmitObservation).toHaveBeenCalledTimes(1);
  });
});
