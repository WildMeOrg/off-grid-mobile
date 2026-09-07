import type { Detection, MatchCandidate, Observation, SyncQueueItem } from '../../../src/types';
import {
  deriveObservationStatus,
  getObservationStatusPresentation,
  OBSERVATION_STATUS_COPY,
} from '../../../src/services/observationStatus';

// ---------------------------------------------------------------------------
// Factory helpers (mirrors __tests__/unit/services/syncEngine.test.ts)
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

describe('deriveObservationStatus', () => {
  it('returns needs-review when any detection is still pending, regardless of sync state', () => {
    const observation = makeObservation({
      detections: [makeDetection({ matchResult: { topCandidates: [], approvedIndividual: null, reviewStatus: 'pending' } })],
    });
    expect(deriveObservationStatus(observation, undefined)).toBe('needs-review');
    expect(deriveObservationStatus(observation, makeSyncItem({ status: 'synced' }))).toBe('needs-review');
  });

  it('returns ready-to-upload when reviewed with eligible evidence and no queue item exists yet (legacy data)', () => {
    const observation = makeObservation();
    expect(deriveObservationStatus(observation, undefined)).toBe('ready-to-upload');
  });

  it('returns ready-to-upload when reviewed, eligible, and queue status is pending', () => {
    const observation = makeObservation();
    expect(deriveObservationStatus(observation, makeSyncItem({ status: 'pending' }))).toBe('ready-to-upload');
  });

  it('returns uploading while a transfer is in flight', () => {
    const observation = makeObservation();
    expect(deriveObservationStatus(observation, makeSyncItem({ status: 'uploading' }))).toBe('uploading');
  });

  it('returns upload-failed on a retryable failure', () => {
    const observation = makeObservation();
    expect(deriveObservationStatus(observation, makeSyncItem({ status: 'failed', lastError: 'network error' }))).toBe(
      'upload-failed',
    );
  });

  it('returns needs-attention once the retry policy is exhausted', () => {
    const observation = makeObservation();
    expect(
      deriveObservationStatus(observation, makeSyncItem({ status: 'failedPermanent', retryCount: 5 })),
    ).toBe('needs-attention');
  });

  it('returns received-by-elebook once every eligible detection has a real Ganesha submission id', () => {
    const observation = makeObservation({
      detections: [makeDetection({ ganeshaSubmissionId: 'sub-1' })],
    });
    expect(
      deriveObservationStatus(
        observation,
        makeSyncItem({ status: 'synced', syncedAt: '2026-08-23T11:00:00Z', wildbookEncounterIds: ['sub-1'] }),
      ),
    ).toBe('received-by-elebook');
  });

  it('returns complete-locally when every detection was reviewed but none were ever eligible to submit (e.g. all rejected)', () => {
    const observation = makeObservation({
      detections: [
        makeDetection({
          matchResult: { topCandidates: [], approvedIndividual: null, reviewStatus: 'rejected' },
        }),
      ],
    });
    expect(deriveObservationStatus(observation, makeSyncItem({ status: 'synced' }))).toBe('complete-locally');
    // Also true even before any sync attempt has flipped the raw status --
    // "no eligible evidence" is a fact about the observation, not the queue.
    expect(deriveObservationStatus(observation, makeSyncItem({ status: 'pending' }))).toBe('complete-locally');
    expect(deriveObservationStatus(observation, undefined)).toBe('complete-locally');
  });

  it('prioritizes a real receipt over a stale failed/pending queue status', () => {
    const observation = makeObservation({
      detections: [makeDetection({ ganeshaSubmissionId: 'sub-1' })],
    });
    // Defensive: if a submission id is already recorded, that fact wins even
    // if the queue row's coarse status has not caught up yet.
    expect(deriveObservationStatus(observation, makeSyncItem({ status: 'pending' }))).toBe('received-by-elebook');
  });
});

describe('getObservationStatusPresentation', () => {
  it('includes the shared copy for the derived status', () => {
    const observation = makeObservation();
    const presentation = getObservationStatusPresentation(observation, undefined);
    expect(presentation.status).toBe('ready-to-upload');
    expect(presentation.label).toBe(OBSERVATION_STATUS_COPY['ready-to-upload'].label);
    expect(presentation.action).toBe(OBSERVATION_STATUS_COPY['ready-to-upload'].action);
    expect(presentation.severity).toBe('action');
  });

  it('surfaces receipt time and submission count for received-by-elebook', () => {
    const observation = makeObservation({
      detections: [
        makeDetection({ id: 'det-1', ganeshaSubmissionId: 'sub-1' }),
        makeDetection({ id: 'det-2', ganeshaSubmissionId: 'sub-2' }),
      ],
    });
    const syncItem = makeSyncItem({
      status: 'synced',
      syncedAt: '2026-08-23T11:00:00Z',
      wildbookEncounterIds: ['sub-1', 'sub-2'],
    });
    const presentation = getObservationStatusPresentation(observation, syncItem);
    expect(presentation.status).toBe('received-by-elebook');
    expect(presentation.receiptTime).toBe('2026-08-23T11:00:00Z');
    expect(presentation.submissionCount).toBe(2);
    expect(presentation.submissionSummary).toBe('2 elephants confirmed received');
  });

  it('uses singular wording in submissionSummary for exactly one confirmed elephant', () => {
    const observation = makeObservation({
      detections: [makeDetection({ id: 'det-1', ganeshaSubmissionId: 'sub-1' })],
    });
    const syncItem = makeSyncItem({ status: 'synced', wildbookEncounterIds: ['sub-1'] });
    const presentation = getObservationStatusPresentation(observation, syncItem);
    expect(presentation.submissionSummary).toBe('1 elephant confirmed received');
  });

  it('reports zero submission count and null receipt time/summary outside received-by-elebook', () => {
    const observation = makeObservation();
    const presentation = getObservationStatusPresentation(observation, undefined);
    expect(presentation.submissionCount).toBe(0);
    expect(presentation.receiptTime).toBeNull();
    expect(presentation.submissionSummary).toBeNull();
  });
});
