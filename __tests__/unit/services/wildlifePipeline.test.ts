import { wildlifePipeline } from '../../../src/services/wildlifePipeline';
import { onnxInferenceService } from '../../../src/services/onnxInferenceService';
import { embeddingMatchService } from '../../../src/services/embeddingMatchService';
import type { SpeciesConfig } from '../../../src/services/wildlifePipeline/types';
import type { DetectorConfig } from '../../../src/types';

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/documents',
  CachesDirectoryPath: '/mock/caches',
  exists: jest.fn().mockResolvedValue(true),
  mkdir: jest.fn().mockResolvedValue(undefined),
  copyFile: jest.fn(),
}));

jest.mock('onnxruntime-react-native', () => ({
  InferenceSession: { create: jest.fn() },
  Tensor: jest.fn(),
}));

jest.mock('../../../src/services/onnxInferenceService', () => ({
  onnxInferenceService: {
    loadModel: jest.fn().mockResolvedValue(undefined),
    runDetection: jest.fn().mockResolvedValue({ results: [], inferenceTimeMs: 0 }),
    extractEmbedding: jest.fn().mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      inferenceTimeMs: 0,
    }),
    isModelLoaded: jest.fn().mockReturnValue(false),
  },
}));

jest.mock('../../../src/services/embeddingMatchService', () => ({
  embeddingMatchService: {
    matchEmbedding: jest.fn().mockReturnValue([]),
  },
}));

jest.mock('../../../src/utils/generateId', () => ({
  generateId: jest
    .fn()
    .mockReturnValueOnce('obs-001')
    .mockReturnValue('det-001'),
}));

const mockLoadModel = onnxInferenceService.loadModel as jest.Mock;
const mockRunDetection = onnxInferenceService.runDetection as jest.Mock;
const mockExtractEmbedding = onnxInferenceService.extractEmbedding as jest.Mock;
const mockIsModelLoaded = onnxInferenceService.isModelLoaded as jest.Mock;
const mockMatchEmbedding = embeddingMatchService.matchEmbedding as jest.Mock;

const makeDetectorConfig = (
  overrides: Partial<DetectorConfig> = {},
): DetectorConfig => ({
  modelFile: 'detector.onnx',
  architecture: 'yolov8',
  inputSize: [640, 640],
  inputChannels: 3,
  channelOrder: 'RGB',
  normalize: { mean: [0, 0, 0], std: [1, 1, 1], scale: 1.0 / 255 },
  confidenceThreshold: 0.5,
  nmsThreshold: 0.45,
  maxDetections: 100,
  outputFormat: 'yolov8',
  classLabels: ['zebra_plains'],
  outputSpec: {
    boxFormat: 'cxcywh',
    coordinateType: 'absolute',
    layout: '1x5xN',
  },
  ...overrides,
});

const makeSpeciesConfig = (
  overrides: Partial<SpeciesConfig> = {},
): SpeciesConfig => ({
  packId: 'pack-zebra',
  species: 'zebra_plains',
  detectorModelPath: '/models/zebra_detector.onnx',
  detectorConfig: makeDetectorConfig(),
  embeddingDatabase: [
    {
      individualId: 'zebra-A',
      source: 'pack',
      embeddings: [[0.1, 0.2, 0.3]],
      refPhotoIndex: 0,
    },
  ],
  ...overrides,
});

describe('WildlifePipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset generateId mock for each test
    const { generateId } = require('../../../src/utils/generateId');
    generateId
      .mockReset()
      .mockReturnValueOnce('obs-001')
      .mockReturnValue('det-001');
  });

  it('should export a singleton instance with processPhoto', () => {
    expect(wildlifePipeline).toBeDefined();
    expect(typeof wildlifePipeline.processPhoto).toBe('function');
  });

  it.each([undefined, 'project-1', null])('returns matches and preserves explicit or ambiguous project scope: %s', async projectId => {
    const detectionResult = {
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      species: 'zebra_plains',
      confidence: 0.95,
    };
    mockRunDetection.mockResolvedValueOnce({
      results: [detectionResult],
      inferenceTimeMs: 50,
    });
    mockExtractEmbedding.mockResolvedValueOnce({
      embedding: [0.1, 0.2, 0.3],
      inferenceTimeMs: 30,
    });
    mockMatchEmbedding.mockReturnValueOnce([
      { individualId: 'zebra-A', score: 0.92, source: 'pack', refPhotoIndex: 0 },
    ]);

    const config = makeSpeciesConfig({ projectId });
    const result = await wildlifePipeline.processPhoto({
      photoUri: 'file:///photos/zebra.jpg',

      speciesConfigs: [config],
      miewidModelPath: '/models/miewid.onnx',
    });

    expect(result.observationId).toBe('obs-001');
    expect(result.photoUri).toBe('file:///photos/zebra.jpg');
    expect(result.detections).toHaveLength(1);

    const detection = result.detections[0];
    expect(detection.id).toBe('det-001');
    expect(detection.observationId).toBe('obs-001');
    expect(detection.boundingBox).toEqual(detectionResult.boundingBox);
    expect(detection.species).toBe('zebra_plains');
    expect(detection.speciesConfidence).toBe(0.95);
    expect(detection.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(detection.matchResult.topCandidates).toHaveLength(1);
    expect(detection.matchResult.topCandidates[0].individualId).toBe('zebra-A');
    expect(detection.matchResult.approvedIndividual).toBeNull();
    expect(detection.matchResult.reviewStatus).toBe('pending');
    expect(detection.encounterFields.projectId).toBe(projectId === undefined ? config.packId : projectId);
  });

  it('should load detector model when not already loaded', async () => {
    mockIsModelLoaded.mockReturnValue(false);
    mockRunDetection.mockResolvedValueOnce({
      results: [],
      inferenceTimeMs: 10,
    });

    const config = makeSpeciesConfig();
    await wildlifePipeline.processPhoto({
      photoUri: 'file:///photos/test.jpg',

      speciesConfigs: [config],
      miewidModelPath: '/models/miewid.onnx',
    });

    expect(mockLoadModel).toHaveBeenCalledWith(
      '/models/zebra_detector.onnx',
      'detector',
    );
  });

  it('should skip detector load when already loaded', async () => {
    mockIsModelLoaded.mockReturnValue(true);
    mockRunDetection.mockResolvedValueOnce({
      results: [],
      inferenceTimeMs: 10,
    });

    const config = makeSpeciesConfig();
    await wildlifePipeline.processPhoto({
      photoUri: 'file:///photos/test.jpg',

      speciesConfigs: [config],
      miewidModelPath: '/models/miewid.onnx',
    });

    // loadModel should not be called for detector since it's already loaded
    expect(mockLoadModel).not.toHaveBeenCalledWith(
      '/models/zebra_detector.onnx',
      'detector',
    );
  });

  it('should load MiewID model when not already loaded', async () => {
    mockIsModelLoaded.mockReturnValue(false);
    const detectionResult = {
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      species: 'zebra_plains',
      confidence: 0.9,
    };
    mockRunDetection.mockResolvedValueOnce({
      results: [detectionResult],
      inferenceTimeMs: 50,
    });

    const config = makeSpeciesConfig();
    await wildlifePipeline.processPhoto({
      photoUri: 'file:///photos/test.jpg',

      speciesConfigs: [config],
      miewidModelPath: '/models/miewid.onnx',
    });

    expect(mockLoadModel).toHaveBeenCalledWith(
      '/models/miewid.onnx',
      'embedding',
    );
  });

  it('should handle empty detections scenario', async () => {
    mockRunDetection.mockResolvedValueOnce({
      results: [],
      inferenceTimeMs: 15,
    });

    const config = makeSpeciesConfig();
    const result = await wildlifePipeline.processPhoto({
      photoUri: 'file:///photos/empty.jpg',

      speciesConfigs: [config],
      miewidModelPath: '/models/miewid.onnx',
    });

    expect(result.detections).toHaveLength(0);
    expect(mockExtractEmbedding).not.toHaveBeenCalled();
    expect(mockMatchEmbedding).not.toHaveBeenCalled();
  });

  it('should handle multiple species configs', async () => {
    const { generateId } = require('../../../src/utils/generateId');
    generateId
      .mockReset()
      .mockReturnValueOnce('obs-002')
      .mockReturnValueOnce('det-z1')
      .mockReturnValueOnce('det-g1');

    const zebraDetection = {
      boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      species: 'zebra_plains',
      confidence: 0.9,
    };
    const giraffeDetection = {
      boundingBox: { x: 0.5, y: 0.5, width: 0.3, height: 0.3 },
      species: 'giraffe',
      confidence: 0.85,
    };

    mockRunDetection
      .mockResolvedValueOnce({ results: [zebraDetection], inferenceTimeMs: 40 })
      .mockResolvedValueOnce({ results: [giraffeDetection], inferenceTimeMs: 35 });

    mockExtractEmbedding
      .mockResolvedValueOnce({ embedding: [0.1, 0.2], inferenceTimeMs: 20 })
      .mockResolvedValueOnce({ embedding: [0.3, 0.4], inferenceTimeMs: 25 });

    mockMatchEmbedding
      .mockReturnValueOnce([{ individualId: 'z-1', score: 0.9, source: 'pack', refPhotoIndex: 0 }])
      .mockReturnValueOnce([{ individualId: 'g-1', score: 0.8, source: 'local', refPhotoIndex: 1 }]);

    const zebraConfig = makeSpeciesConfig({
      packId: 'pack-zebra',
      species: 'zebra_plains',
      detectorModelPath: '/models/zebra_detector.onnx',
    });
    const giraffeConfig = makeSpeciesConfig({
      packId: 'pack-giraffe',
      species: 'giraffe',
      detectorModelPath: '/models/giraffe_detector.onnx',
      embeddingDatabase: [
        {
          individualId: 'g-1',
          source: 'local',
          embeddings: [[0.3, 0.4]],
          refPhotoIndex: 1,
        },
      ],
    });

    const result = await wildlifePipeline.processPhoto({
      photoUri: 'file:///photos/multi.jpg',

      speciesConfigs: [zebraConfig, giraffeConfig],
      miewidModelPath: '/models/miewid.onnx',
    });

    expect(result.detections).toHaveLength(2);
    expect(result.detections[0].species).toBe('zebra_plains');
    expect(result.detections[1].species).toBe('giraffe');
    expect(mockRunDetection).toHaveBeenCalledTimes(2);
    expect(mockExtractEmbedding).toHaveBeenCalledTimes(2);
  });

  it('should record a detector failure as an error and keep other species results', async () => {
    const detectionResult = {
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      species: 'giraffe',
      confidence: 0.9,
    };
    mockRunDetection
      .mockRejectedValueOnce(new Error('Detector ONNX error'))
      .mockResolvedValueOnce({ results: [detectionResult], inferenceTimeMs: 100 });
    mockExtractEmbedding.mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      inferenceTimeMs: 50,
    });
    mockMatchEmbedding.mockReturnValue([]);

    const result = await wildlifePipeline.processPhoto({
      photoUri: 'file:///photos/partial.jpg',
      speciesConfigs: [
        makeSpeciesConfig({ species: 'zebra_plains' }),
        makeSpeciesConfig({
          packId: 'pack-giraffe',
          species: 'giraffe',
          detectorModelPath: '/models/giraffe_detector.onnx',
        }),
      ],
      miewidModelPath: '/models/miewid.onnx',
    });

    expect(result.detections).toHaveLength(1);
    expect(result.detections[0].species).toBe('giraffe');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      species: 'zebra_plains',
      stage: 'detector',
      message: expect.stringContaining('Detector ONNX error'),
    });
  });

  it('should record a per-detection failure and keep the remaining detections', async () => {
    const makeDetection = (x: number) => ({
      boundingBox: { x, y: 0.2, width: 0.3, height: 0.4 },
      species: 'zebra_plains',
      confidence: 0.9,
    });
    mockRunDetection.mockResolvedValueOnce({
      results: [makeDetection(0.1), makeDetection(0.5)],
      inferenceTimeMs: 100,
    });
    mockExtractEmbedding
      .mockRejectedValueOnce(new Error('embedding blew up'))
      .mockResolvedValueOnce({ embedding: [0.1, 0.2, 0.3], inferenceTimeMs: 50 });
    mockMatchEmbedding.mockReturnValue([]);

    const result = await wildlifePipeline.processPhoto({
      photoUri: 'file:///photos/two-animals.jpg',
      speciesConfigs: [makeSpeciesConfig()],
      miewidModelPath: '/models/miewid.onnx',
    });

    expect(result.detections).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      species: 'zebra_plains',
      stage: 'embedding',
      message: expect.stringContaining('embedding blew up'),
    });
  });

  it('should fail fast with an embedding-model error when MiewID cannot load', async () => {
    // MiewID is the first load attempt (fail-fast contract)
    mockIsModelLoaded.mockReturnValueOnce(false);
    mockLoadModel.mockRejectedValueOnce(new Error('MiewID file corrupt'));

    const result = await wildlifePipeline.processPhoto({
      photoUri: 'file:///photos/test.jpg',
      speciesConfigs: [makeSpeciesConfig()],
      miewidModelPath: '/models/miewid.onnx',
    });

    expect(result.detections).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      species: null,
      stage: 'embedding-model',
      message: expect.stringContaining('MiewID file corrupt'),
    });
    // No detector work is wasted when embeddings are impossible
    expect(mockRunDetection).not.toHaveBeenCalled();
  });

  it("should use the species config's embedding input settings when provided", async () => {
    mockRunDetection.mockResolvedValueOnce({
      results: [
        {
          boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
          species: 'zebra_plains',
          confidence: 0.9,
        },
      ],
      inferenceTimeMs: 100,
    });
    mockExtractEmbedding.mockResolvedValueOnce({
      embedding: [0.1, 0.2, 0.3],
      inferenceTimeMs: 50,
    });
    mockMatchEmbedding.mockReturnValue([]);

    await wildlifePipeline.processPhoto({
      photoUri: 'file:///photos/test.jpg',
      speciesConfigs: [
        makeSpeciesConfig({
          embeddingInputSize: [416, 416],
          embeddingNormalize: {
            mean: [0.5, 0.5, 0.5],
            std: [0.25, 0.25, 0.25],
          },
        }),
      ],
      miewidModelPath: '/models/miewid.onnx',
    });

    expect(mockExtractEmbedding).toHaveBeenCalledWith(
      expect.any(String),
      '/models/miewid.onnx',
      {
        inputSize: [416, 416],
        normalize: { mean: [0.5, 0.5, 0.5], std: [0.25, 0.25, 0.25] },
      },
    );
  });

  it('should return an empty errors array on full success', async () => {
    mockRunDetection.mockResolvedValueOnce({
      results: [
        {
          boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
          species: 'zebra_plains',
          confidence: 0.9,
        },
      ],
      inferenceTimeMs: 100,
    });
    mockExtractEmbedding.mockResolvedValueOnce({
      embedding: [0.1, 0.2, 0.3],
      inferenceTimeMs: 50,
    });
    mockMatchEmbedding.mockReturnValue([]);

    const result = await wildlifePipeline.processPhoto({
      photoUri: 'file:///photos/test.jpg',
      speciesConfigs: [makeSpeciesConfig()],
      miewidModelPath: '/models/miewid.onnx',
    });

    expect(result.errors).toEqual([]);
    expect(result.detections).toHaveLength(1);
  });

  it('should accumulate inference time from detection and embedding', async () => {
    const detectionResult = {
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      species: 'zebra_plains',
      confidence: 0.9,
    };
    mockRunDetection.mockResolvedValueOnce({
      results: [detectionResult],
      inferenceTimeMs: 100,
    });
    mockExtractEmbedding.mockResolvedValueOnce({
      embedding: [0.1, 0.2, 0.3],
      inferenceTimeMs: 50,
    });

    const config = makeSpeciesConfig();
    const result = await wildlifePipeline.processPhoto({
      photoUri: 'file:///photos/test.jpg',

      speciesConfigs: [config],
      miewidModelPath: '/models/miewid.onnx',
    });

    expect(result.totalInferenceTimeMs).toBe(150);
  });
});
