import type { Detection, Observation } from '../../../src/types';
import { composeLocalEvidence } from '../../../src/services/individualBrowser/model';

const makeDetection = (overrides: Partial<Detection> = {}): Detection => ({
  id: 'detection-1',
  observationId: 'observation-1',
  boundingBox: { x: 0, y: 0, width: 10, height: 10 },
  species: 'elephant',
  speciesConfidence: 0.9,
  croppedImageUri: '/mock/documents/crops/detection-1.jpg',
  embedding: [],
  matchResult: {
    topCandidates: [{ individualId: 'individual-1', score: 0.99, source: 'pack', refPhotoIndex: 0 }],
    approvedIndividual: 'individual-1',
    reviewStatus: 'approved',
  },
  encounterFields: {
    locationId: null, sex: null, lifeStage: null, behavior: null,
    submitterId: null, projectId: 'project-1',
  },
  ganeshaSubmissionId: null,
  ...overrides,
});

const makeObservation = (detections: Detection[]): Observation => ({
  id: 'observation-1',
  photoUri: '/mock/documents/photos/source.jpg',
  gps: null,
  timestamp: '2026-09-08T00:00:00Z',
  deviceInfo: { model: 'test', os: 'test' },
  fieldNotes: null,
  detections,
  createdAt: '2026-09-08T00:00:00Z',
});

const evidenceFor = (observations: Observation[], individualId = 'individual-1') =>
  composeLocalEvidence({ observations, packId: 'project-1', individualId });

describe('individual browser local evidence', () => {
  it('includes approved unsynced evidence, deduplicates sources, and retains distinct crops', () => {
    const observations = [makeObservation([
      makeDetection(),
      makeDetection({ id: 'detection-2', croppedImageUri: '/mock/documents/crops/detection-2.jpg' }),
    ])];

    expect(evidenceFor(observations)).toEqual([
      expect.objectContaining({ kind: 'source', uri: observations[0].photoUri }),
      expect.objectContaining({ kind: 'crop', detectionId: 'detection-1' }),
      expect.objectContaining({ kind: 'crop', detectionId: 'detection-2' }),
    ]);
  });

  it('excludes candidates, rejected decisions, other IDs, other projects, and ambiguous legacy scope', () => {
    const base = makeDetection();
    const detections = [
      makeDetection({ matchResult: { ...base.matchResult, reviewStatus: 'pending' }, ganeshaSubmissionId: 'receipt' }),
      makeDetection({ matchResult: { ...base.matchResult, reviewStatus: 'rejected' } }),
      makeDetection({ matchResult: { ...base.matchResult, approvedIndividual: 'individual-2' } }),
      makeDetection({ encounterFields: { ...base.encounterFields, projectId: 'project-2' } }),
      makeDetection({ encounterFields: { ...base.encounterFields, projectId: null } }),
    ];

    expect(evidenceFor([makeObservation(detections)])).toEqual([]);
  });

  it('derives corrected and removed associations from current observations', () => {
    const original = makeDetection();
    const corrected = makeDetection({
      matchResult: { ...original.matchResult, approvedIndividual: 'individual-2' },
    });

    expect(evidenceFor([makeObservation([original])])).toHaveLength(2);
    expect(evidenceFor([makeObservation([corrected])])).toEqual([]);
    expect(evidenceFor([makeObservation([corrected])], 'individual-2')).toHaveLength(2);
    expect(evidenceFor([])).toEqual([]);
  });

  it('never promotes provisional FIELD identities into pack evidence', () => {
    const detection = makeDetection({
      matchResult: { topCandidates: [], approvedIndividual: 'FIELD-001', reviewStatus: 'approved' },
    });

    expect(evidenceFor([makeObservation([detection])], 'FIELD-001')).toEqual([]);
  });

  it('deduplicates bare and file URI representations of one source photo', () => {
    const first = makeObservation([makeDetection()]);
    const second = {
      ...makeObservation([makeDetection({ id: 'detection-2', observationId: 'observation-2' })]),
      id: 'observation-2', photoUri: `file://${first.photoUri}`,
    };
    const evidence = evidenceFor([first, second]);
    expect(evidence.filter(photo => photo.kind === 'source')).toHaveLength(1);
    expect(evidence.filter(photo => photo.kind === 'crop')).toHaveLength(2);
  });
});