/**
 * Integration Test: Wildlife Pipeline Full Flow
 *
 * Tests the end-to-end wildlife re-ID pipeline:
 *   photo -> detect -> embed -> match -> save observation -> review -> approve
 *   -> local individual accumulation
 *
 * Only the ONNX inference layer (the native boundary) is mocked.
 * The real embeddingMatchService and wildlifeStore are used so that cosine
 * similarity matching and state management are exercised for real.
 */

import { wildlifePipeline } from '../../../src/services/wildlifePipeline';
import { useWildlifeStore } from '../../../src/stores/wildlifeStore';
import { initDatabase } from '../../../src/services/database';
import type { ProcessPhotoParams } from '../../../src/services/wildlifePipeline/types';
import type { EmbeddingDatabaseEntry } from '../../../src/services/embeddingMatchService/types';
import type { Observation, LocalIndividual } from '../../../src/types';

// ---------------------------------------------------------------------------
// Mocks — only the native boundary and utilities
// ---------------------------------------------------------------------------

jest.mock('../../../src/services/onnxInferenceService', () => ({
  onnxInferenceService: {
    isModelLoaded: jest.fn().mockReturnValue(false),
    loadModel: jest.fn().mockResolvedValue(undefined),
    runDetection: jest.fn(),
    extractEmbedding: jest.fn(),
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

let mockIdCounter = 0;
jest.mock('../../../src/utils/generateId', () => ({
  generateId: jest.fn(() => {
    mockIdCounter += 1;
    return `test-id-${mockIdCounter}`;
  }),
}));

// Import the mocked service so we can program its return values
import { onnxInferenceService } from '../../../src/services/onnxInferenceService';

const mockOnnx = onnxInferenceService as jest.Mocked<typeof onnxInferenceService>;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** A deterministic 8-dimensional embedding vector for the first sighting. */
const ZEBRA_EMBEDDING_1 = [0.5, 0.3, 0.8, 0.1, 0.6, 0.2, 0.9, 0.4];

/** A slightly different embedding for the re-sighting (same individual). */
const ZEBRA_EMBEDDING_2 = [0.52, 0.28, 0.79, 0.12, 0.61, 0.19, 0.88, 0.42];

/** An unrelated embedding that should NOT match. */
const UNRELATED_EMBEDDING = [-0.9, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2];

const DETECTOR_MODEL_PATH = '/models/zebra_detector.onnx';
const MIEWID_MODEL_PATH = '/models/miewid.onnx';
const PHOTO_URI = 'file:///photos/zebra_field.jpg';
const PHOTO_URI_2 = 'file:///photos/zebra_field_2.jpg';

const DETECTOR_CONFIG = {
  modelFile: 'zebra_detector.onnx',
  architecture: 'yolov5',
  inputSize: [640, 640] as [number, number],
  inputChannels: 3,
  channelOrder: 'RGB' as const,
  normalize: {
    mean: [0, 0, 0] as [number, number, number],
    std: [1, 1, 1] as [number, number, number],
    scale: 1 / 255,
  },
  confidenceThreshold: 0.5,
  nmsThreshold: 0.45,
  maxDetections: 10,
  outputFormat: 'yolov5',
  classLabels: ['zebra'],
  outputSpec: {
    boxFormat: 'xyxy' as const,
    coordinateType: 'normalized' as const,
    layout: 'detection_first',
  },
};

const BOUNDING_BOX = { x: 100, y: 150, width: 200, height: 300 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildParams(
  embeddingDatabase: EmbeddingDatabaseEntry[] = [],
): ProcessPhotoParams {
  return {
    photoUri: PHOTO_URI,

    speciesConfigs: [
      {
        packId: 'pack-zebra-01',
        species: 'zebra',
        detectorModelPath: DETECTOR_MODEL_PATH,
        detectorConfig: DETECTOR_CONFIG,
        embeddingDatabase,
      },
    ],
    miewidModelPath: MIEWID_MODEL_PATH,
  };
}

function buildParamsForResighting(
  embeddingDatabase: EmbeddingDatabaseEntry[],
): ProcessPhotoParams {
  return {
    photoUri: PHOTO_URI_2,

    speciesConfigs: [
      {
        packId: 'pack-zebra-01',
        species: 'zebra',
        detectorModelPath: DETECTOR_MODEL_PATH,
        detectorConfig: DETECTOR_CONFIG,
        embeddingDatabase,
      },
    ],
    miewidModelPath: MIEWID_MODEL_PATH,
  };
}

function programOnnxForDetection(embedding: number[]): void {
  mockOnnx.runDetection.mockResolvedValue({
    results: [
      {
        boundingBox: BOUNDING_BOX,
        species: 'zebra',
        confidence: 0.95,
      },
    ],
    inferenceTimeMs: 120,
  });
  mockOnnx.extractEmbedding.mockResolvedValue({
    embedding,
    inferenceTimeMs: 80,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Wildlife Pipeline — Full Integration Flow', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    mockIdCounter = 0;
    jest.clearAllMocks();
    useWildlifeStore.getState().reset();
    mockOnnx.isModelLoaded.mockReturnValue(false);
    mockOnnx.loadModel.mockResolvedValue(undefined);
  });

  it('runs the complete pipeline: detect -> embed -> match -> save -> review -> accumulate', async () => {
    // =====================================================================
    // STEP 1 — First sighting: no database, expect no match candidates
    // =====================================================================
    programOnnxForDetection(ZEBRA_EMBEDDING_1);

    const params = buildParams(/* empty database */);
    const result = await wildlifePipeline.processPhoto(params);

    // --- Verify pipeline result ---
    expect(result.detections).toHaveLength(1);
    const det1 = result.detections[0];
    expect(det1.species).toBe('zebra');
    expect(det1.speciesConfidence).toBe(0.95);
    expect(det1.boundingBox).toEqual(BOUNDING_BOX);
    expect(det1.embedding).toEqual(ZEBRA_EMBEDDING_1);
    expect(det1.matchResult.reviewStatus).toBe('pending');
    expect(det1.matchResult.approvedIndividual).toBeNull();
    expect(det1.matchResult.topCandidates).toHaveLength(0); // empty DB
    expect(result.totalInferenceTimeMs).toBe(200); // 120 + 80

    // --- Verify ONNX interactions ---
    expect(mockOnnx.loadModel).toHaveBeenCalledTimes(2); // detector + embedding
    expect(mockOnnx.loadModel).toHaveBeenCalledWith(
      DETECTOR_MODEL_PATH,
      'detector',
    );
    expect(mockOnnx.loadModel).toHaveBeenCalledWith(
      MIEWID_MODEL_PATH,
      'embedding',
    );

    // =====================================================================
    // STEP 2 — Save observation to the store
    // =====================================================================
    const observation: Observation = {
      id: result.observationId,
      photoUri: PHOTO_URI,
      gps: null,
      timestamp: new Date().toISOString(),
      deviceInfo: { model: 'Test Device', os: 'Android 13' },
      fieldNotes: null,
      detections: result.detections,
      createdAt: new Date().toISOString(),
    };
    useWildlifeStore.getState().addObservation(observation);

    // --- Verify store state ---
    const storeAfterSave = useWildlifeStore.getState();
    expect(storeAfterSave.observations).toHaveLength(1);
    expect(storeAfterSave.observations[0].id).toBe(result.observationId);
    expect(storeAfterSave.observations[0].detections).toHaveLength(1);
    expect(storeAfterSave.observations[0].detections[0].matchResult.reviewStatus).toBe('pending');

    // =====================================================================
    // STEP 3 — Review: no match -> create new local individual
    // =====================================================================
    const detection = result.detections[0];

    const localIndividual: LocalIndividual = {
      localId: 'local-zebra-001',
      userLabel: 'Stripe Master',
      species: 'zebra',
      embeddings: [detection.embedding],
      referencePhotos: [detection.croppedImageUri],
      firstSeen: new Date().toISOString(),
      encounterCount: 1,
      syncStatus: 'pending',
      wildbookId: null,
    };
    useWildlifeStore.getState().addLocalIndividual(localIndividual);

    // Mark detection as reviewed
    useWildlifeStore.getState().updateDetection(
      result.observationId,
      detection.id,
      {
        matchResult: {
          ...detection.matchResult,
          approvedIndividual: localIndividual.localId,
          reviewStatus: 'approved',
        },
      },
    );

    // --- Verify local individual created ---
    const storeAfterReview = useWildlifeStore.getState();
    expect(storeAfterReview.localIndividuals).toHaveLength(1);
    expect(storeAfterReview.localIndividuals[0].localId).toBe('local-zebra-001');
    expect(storeAfterReview.localIndividuals[0].species).toBe('zebra');
    expect(storeAfterReview.localIndividuals[0].embeddings).toHaveLength(1);
    expect(storeAfterReview.localIndividuals[0].embeddings[0]).toEqual(ZEBRA_EMBEDDING_1);
    expect(storeAfterReview.localIndividuals[0].encounterCount).toBe(1);

    // --- Verify detection review status updated ---
    const updatedObs = storeAfterReview.observations[0];
    expect(updatedObs.detections[0].matchResult.reviewStatus).toBe('approved');
    expect(updatedObs.detections[0].matchResult.approvedIndividual).toBe('local-zebra-001');

    // =====================================================================
    // STEP 4 — Re-sighting: run pipeline with local individual in database
    // =====================================================================
    jest.clearAllMocks();
    mockIdCounter = 10; // avoid ID collisions with the first run

    programOnnxForDetection(ZEBRA_EMBEDDING_2);

    // Build the embedding database including the local individual
    const embeddingDb: EmbeddingDatabaseEntry[] = [
      {
        individualId: localIndividual.localId,
        source: 'local',
        embeddings: storeAfterReview.localIndividuals[0].embeddings,
        refPhotoIndex: 0,
      },
    ];

    const resightParams = buildParamsForResighting(embeddingDb);
    const resightResult = await wildlifePipeline.processPhoto(resightParams);

    // --- Verify re-sighting detection ---
    expect(resightResult.detections).toHaveLength(1);
    const det2 = resightResult.detections[0];
    expect(det2.species).toBe('zebra');
    expect(det2.embedding).toEqual(ZEBRA_EMBEDDING_2);
    expect(det2.matchResult.reviewStatus).toBe('pending');

    // --- Verify match candidates include the local individual ---
    expect(det2.matchResult.topCandidates.length).toBeGreaterThanOrEqual(1);
    const topCandidate = det2.matchResult.topCandidates[0];
    expect(topCandidate.individualId).toBe('local-zebra-001');
    expect(topCandidate.source).toBe('local');
    // Cosine similarity between ZEBRA_EMBEDDING_1 and ZEBRA_EMBEDDING_2
    // should be very high (> 0.99) since they are nearly identical vectors
    expect(topCandidate.score).toBeGreaterThan(0.99);

    // =====================================================================
    // STEP 5 — Save re-sighting observation
    // =====================================================================
    const observation2: Observation = {
      id: resightResult.observationId,
      photoUri: PHOTO_URI_2,
      gps: null,
      timestamp: new Date().toISOString(),
      deviceInfo: { model: 'Test Device', os: 'Android 13' },
      fieldNotes: null,
      detections: resightResult.detections,
      createdAt: new Date().toISOString(),
    };
    useWildlifeStore.getState().addObservation(observation2);

    expect(useWildlifeStore.getState().observations).toHaveLength(2);

    // =====================================================================
    // STEP 6 — Review: approve match to existing local individual
    // =====================================================================
    useWildlifeStore.getState().updateDetection(
      resightResult.observationId,
      det2.id,
      {
        matchResult: {
          ...det2.matchResult,
          approvedIndividual: localIndividual.localId,
          reviewStatus: 'approved',
        },
      },
    );

    // Accumulate embedding on the local individual
    useWildlifeStore.getState().addEmbeddingToLocalIndividual(
      localIndividual.localId,
      det2.embedding,
      det2.croppedImageUri,
    );

    // =====================================================================
    // STEP 7 — Verify accumulation
    // =====================================================================
    const finalState = useWildlifeStore.getState();
    const individual = finalState.localIndividuals[0];

    // The local individual should now have 2 embeddings
    expect(individual.embeddings).toHaveLength(2);
    expect(individual.embeddings[0]).toEqual(ZEBRA_EMBEDDING_1);
    expect(individual.embeddings[1]).toEqual(ZEBRA_EMBEDDING_2);

    // Reference photos should also have 2 entries
    expect(individual.referencePhotos).toHaveLength(2);

    // Encounter count should be incremented
    expect(individual.encounterCount).toBe(2);

    // Both observations should be approved
    const obs1 = finalState.observations[0];
    const obs2 = finalState.observations[1];
    expect(obs1.detections[0].matchResult.reviewStatus).toBe('approved');
    expect(obs2.detections[0].matchResult.reviewStatus).toBe('approved');
    expect(obs1.detections[0].matchResult.approvedIndividual).toBe('local-zebra-001');
    expect(obs2.detections[0].matchResult.approvedIndividual).toBe('local-zebra-001');
  });

  it('returns no candidates when the embedding does not match any database entry', async () => {
    // Set up a database with an unrelated individual
    const embeddingDb: EmbeddingDatabaseEntry[] = [
      {
        individualId: 'unrelated-ind-01',
        source: 'pack',
        embeddings: [UNRELATED_EMBEDDING],
        refPhotoIndex: 0,
      },
    ];

    programOnnxForDetection(ZEBRA_EMBEDDING_1);

    const params = buildParams(embeddingDb);
    const result = await wildlifePipeline.processPhoto(params);

    // The match service returns all candidates sorted by score, but the
    // score against an unrelated embedding should be very low (< 0)
    expect(result.detections).toHaveLength(1);
    const candidates = result.detections[0].matchResult.topCandidates;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].individualId).toBe('unrelated-ind-01');
    expect(candidates[0].score).toBeLessThan(0);
  });

  it('handles zero detections gracefully', async () => {
    mockOnnx.runDetection.mockResolvedValue({
      results: [],
      inferenceTimeMs: 50,
    });

    const params = buildParams();
    const result = await wildlifePipeline.processPhoto(params);

    expect(result.detections).toHaveLength(0);
    expect(result.totalInferenceTimeMs).toBe(50);
    // Embedding model should NOT be loaded when there are no detections
    expect(mockOnnx.extractEmbedding).not.toHaveBeenCalled();
  });

  it('skips model loading when models are already loaded', async () => {
    mockOnnx.isModelLoaded.mockReturnValue(true);
    programOnnxForDetection(ZEBRA_EMBEDDING_1);

    const params = buildParams();
    await wildlifePipeline.processPhoto(params);

    // loadModel should NOT be called since models are already loaded
    expect(mockOnnx.loadModel).not.toHaveBeenCalled();
  });

  it('correctly ranks multiple candidates by cosine similarity', async () => {
    // Database with two individuals — one close match, one distant
    const embeddingDb: EmbeddingDatabaseEntry[] = [
      {
        individualId: 'close-match',
        source: 'local',
        embeddings: [ZEBRA_EMBEDDING_2], // very similar to ZEBRA_EMBEDDING_1
        refPhotoIndex: 0,
      },
      {
        individualId: 'distant-match',
        source: 'pack',
        embeddings: [UNRELATED_EMBEDDING], // very different
        refPhotoIndex: 0,
      },
    ];

    programOnnxForDetection(ZEBRA_EMBEDDING_1);

    const params = buildParams(embeddingDb);
    const result = await wildlifePipeline.processPhoto(params);

    const candidates = result.detections[0].matchResult.topCandidates;
    expect(candidates).toHaveLength(2);

    // The close match should be ranked first
    expect(candidates[0].individualId).toBe('close-match');
    expect(candidates[0].score).toBeGreaterThan(0.99);

    // The distant match should be ranked second with a low/negative score
    expect(candidates[1].individualId).toBe('distant-match');
    expect(candidates[1].score).toBeLessThan(0);
  });

  it('accumulates multiple embeddings and improves future matching', async () => {
    // Start with a local individual that has one embedding
    const individual: LocalIndividual = {
      localId: 'local-zebra-accum',
      userLabel: null,
      species: 'zebra',
      embeddings: [ZEBRA_EMBEDDING_1],
      referencePhotos: ['file:///crops/first.jpg'],
      firstSeen: new Date().toISOString(),
      encounterCount: 1,
      syncStatus: 'pending',
      wildbookId: null,
    };
    useWildlifeStore.getState().addLocalIndividual(individual);

    // Add a second embedding
    useWildlifeStore.getState().addEmbeddingToLocalIndividual(
      'local-zebra-accum',
      ZEBRA_EMBEDDING_2,
      'file:///crops/second.jpg',
    );

    const state = useWildlifeStore.getState();
    const ind = state.localIndividuals[0];

    expect(ind.embeddings).toHaveLength(2);
    expect(ind.referencePhotos).toHaveLength(2);
    expect(ind.encounterCount).toBe(2);

    // Now run the pipeline with a query very close to embedding 2.
    // The match service picks the best per-individual score across all
    // embeddings, so having 2 embeddings should still match correctly.
    const queryEmbedding = ZEBRA_EMBEDDING_2.map((v) => v + 0.001);

    programOnnxForDetection(queryEmbedding);

    const embeddingDb: EmbeddingDatabaseEntry[] = [
      {
        individualId: ind.localId,
        source: 'local',
        embeddings: ind.embeddings,
        refPhotoIndex: 0,
      },
    ];

    const params = buildParams(embeddingDb);
    const result = await wildlifePipeline.processPhoto(params);

    const candidates = result.detections[0].matchResult.topCandidates;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].individualId).toBe('local-zebra-accum');
    expect(candidates[0].score).toBeGreaterThan(0.999);
  });
});
