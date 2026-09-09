import type { Detection, EmbeddingPack, Observation, PackIndividual } from '../../src/types';

export const makePack = (overrides: Partial<EmbeddingPack> = {}): EmbeddingPack => ({
  id: 'project-1',
  packVersion: 'version-1',
  artifactSha256: 'archive-1',
  species: 'elephant',
  featureClass: 'elephant+head',
  displayName: 'Test pack',
  wildbookInstanceUrl: 'https://example.invalid',
  exportDate: '2026-09-08T00:00:00Z',
  individualCount: 2,
  embeddingDim: 2152,
  embeddingModelVersion: '4.1.0',
  detectorModelFile: '/mock/documents/embedding_packs/test/models/detector.onnx',
  embeddingsFile: '/mock/documents/embedding_packs/test/embeddings/embeddings.bin',
  indexFile: '/mock/documents/embedding_packs/test/embeddings/index.json',
  referencePhotosDir: '/mock/documents/embedding_packs/test/reference_photos',
  packDir: '/mock/documents/embedding_packs/test',
  downloadedAt: '2026-09-08T00:00:00Z',
  sizeBytes: 1024,
  status: 'ready',
  validatedAt: '2026-09-08T00:00:00Z',
  ...overrides,
});

export const makeIndividual = (overrides: Partial<PackIndividual> = {}): PackIndividual => ({
  id: 'individual-1',
  name: 'Button',
  alternateId: 'Alias One',
  sex: 'female',
  lifeStage: null,
  firstSeen: null,
  lastSeen: null,
  encounterCount: 0,
  embeddingCount: 1,
  embeddingOffset: 0,
  referencePhotos: ['ref.jpg'],
  notes: null,
  ...overrides,
});

export const makeDetection = (overrides: Partial<Detection> = {}): Detection => ({
  id: 'detection-1',
  observationId: 'observation-1',
  boundingBox: { x: 0, y: 0, width: 10, height: 10 },
  species: 'elephant',
  speciesConfidence: 0.9,
  croppedImageUri: '/mock/documents/observations/observation-1/crop_detection-1.jpg',
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

export const makeObservation = (
  detections: Detection[] = [makeDetection()],
  overrides: Partial<Observation> = {},
): Observation => ({
  id: 'observation-1',
  photoUri: '/mock/documents/observations/observation-1/original.jpg',
  gps: null,
  timestamp: '2026-09-08T00:00:00Z',
  deviceInfo: { model: 'test', os: 'test' },
  fieldNotes: null,
  detections,
  createdAt: '2026-09-08T00:00:00Z',
  ...overrides,
});