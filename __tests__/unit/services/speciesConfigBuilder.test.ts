jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/documents',
  readFile: jest.fn(),
  stat: jest.fn(),
}));

jest.mock('../../../src/services/packManager', () => ({
  packManager: {
    loadManifest: jest.fn(),
  },
}));

jest.mock('../../../src/services/embeddingDatabaseBuilder', () => ({
  buildEmbeddingDatabase: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../src/services/miewidModelManager', () => ({
  checkEmbeddingModelCompatibility: jest.fn(),
}));

import RNFS from 'react-native-fs';
import { packManager } from '../../../src/services/packManager';
import { buildEmbeddingDatabase } from '../../../src/services/embeddingDatabaseBuilder';
import { checkEmbeddingModelCompatibility } from '../../../src/services/miewidModelManager';
import { buildActiveSpeciesConfigs } from '../../../src/services/speciesConfigBuilder';
import type { EmbeddingPack, MiewIDModelRecord } from '../../../src/types';

const mockLoadManifest = packManager.loadManifest as jest.Mock;
const mockBuildEmbeddingDatabase = buildEmbeddingDatabase as jest.Mock;
const mockCheckCompat = checkEmbeddingModelCompatibility as jest.Mock;

function makePack(overrides: Partial<EmbeddingPack> = {}): EmbeddingPack {
  return {
    id: 'pack-elephant-001',
    packVersion: '2026-03-01T00:00:00Z',
    species: 'elephant',
    featureClass: 'elephant+ear',
    displayName: 'Test Elephants',
    wildbookInstanceUrl: 'https://elephants.wildbook.org',
    exportDate: '2026-03-01T00:00:00Z',
    individualCount: 6,
    embeddingDim: 2152,
    embeddingModelVersion: '4.1.0',
    detectorModelFile: '/mock/detector.onnx',
    embeddingsFile: '/mock/pack/embeddings.bin',
    indexFile: '/mock/pack/index.json',
    referencePhotosDir: '/mock/pack/photos',
    packDir: '/mock/pack',
    downloadedAt: '2026-03-01T00:00:00Z',
    sizeBytes: 1024,
    status: 'ready',
    ...overrides,
  };
}

function makeModel(overrides: Partial<MiewIDModelRecord> = {}): MiewIDModelRecord {
  return {
    path: '/mock/miewid.onnx',
    name: 'miewid',
    version: '4.1.0',
    sha256: 'abc',
    sizeBytes: 1000,
    status: 'ready',
    verifiedAt: '2026-03-01T00:00:00Z',
    format: 'onnx',
    ...overrides,
  };
}

describe('buildActiveSpeciesConfigs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckCompat.mockReturnValue('compatible');
    mockLoadManifest.mockRejectedValue(new Error('no manifest'));
    (RNFS.stat as jest.Mock).mockImplementation(async (filepath: string) => ({
      canonicalPath: filepath,
      isFile: () => filepath !== '/mock/pack',
      isDirectory: () => filepath === '/mock/pack',
    }));
  });

  it('returns no configs and no exclusions for an empty pack list', async () => {
    const result = await buildActiveSpeciesConfigs([], makeModel(), []);
    expect(result.speciesConfigs).toEqual([]);
    expect(result.excludedPacks).toEqual([]);
  });

  it('excludes quarantined packs', async () => {
    const packs = [makePack({ id: 'q1', status: 'quarantined' })];
    const result = await buildActiveSpeciesConfigs(packs, makeModel(), []);
    expect(result.speciesConfigs).toEqual([]);
    expect(result.excludedPacks).toEqual([
      { packId: 'q1', reason: 'quarantined' },
    ]);
    // Quarantined packs are filtered before the compatibility check runs.
    expect(mockCheckCompat).not.toHaveBeenCalled();
  });

  it('excludes packs whose embedding model is incompatible', async () => {
    mockCheckCompat.mockReturnValue('incompatible');
    const packs = [makePack({ id: 'p1', embeddingModelVersion: '1.0.0' })];
    const result = await buildActiveSpeciesConfigs(
      packs,
      makeModel({ version: '4.1.0' }),
      [],
    );
    expect(result.speciesConfigs).toEqual([]);
    expect(result.excludedPacks).toEqual([
      {
        packId: 'p1',
        reason:
          'embedding model 1.0.0 incompatible with installed 4.1.0',
      },
    ]);
  });

  it('builds one species config per healthy, compatible pack', async () => {
    const pack = makePack();
    const result = await buildActiveSpeciesConfigs(
      [pack],
      makeModel(),
      [],
    );
    expect(result.speciesConfigs).toHaveLength(1);
    expect(result.speciesConfigs[0]).toMatchObject({
      packId: 'pack-elephant-001',
      species: 'elephant',
      detectorModelPath: '/mock/detector.onnx',
    });
    expect(mockBuildEmbeddingDatabase).toHaveBeenCalledWith(
      'elephant',
      [pack],
      [],
    );
  });

  it('merges packs that share species/featureClass/detector/model version into one group', async () => {
    const packA = makePack({ id: 'a' });
    const packB = makePack({ id: 'b' });
    const result = await buildActiveSpeciesConfigs(
      [packA, packB],
      makeModel(),
      [],
    );
    expect(result.speciesConfigs).toHaveLength(1);
    expect(mockBuildEmbeddingDatabase).toHaveBeenCalledWith(
      'elephant',
      [packA, packB],
      [],
    );
  });

  it('keeps packs with different feature classes in separate groups', async () => {
    const packA = makePack({ id: 'a', featureClass: 'elephant+ear' });
    const packB = makePack({ id: 'b', featureClass: 'elephant+flank' });
    const result = await buildActiveSpeciesConfigs(
      [packA, packB],
      makeModel(),
      [],
    );
    expect(result.speciesConfigs).toHaveLength(2);
  });

  it("uses the pack manifest's embedding input config when available", async () => {
    mockLoadManifest.mockResolvedValue({
      embeddingModel: {
        name: 'miewid-v4',
        version: '4.1.0',
        inputSize: [440, 440],
        normalize: { mean: [0.5, 0.5, 0.5], std: [0.25, 0.25, 0.25] },
      },
      detectorModel: { filename: 'detector.onnx', configFile: 'config/detector.json' },
    });
    (RNFS.readFile as jest.Mock).mockResolvedValue(
      JSON.stringify({ confidenceThreshold: 0.6 }),
    );

    const result = await buildActiveSpeciesConfigs(
      [makePack()],
      makeModel(),
      [],
    );

    expect(result.speciesConfigs[0].embeddingInputSize).toEqual([440, 440]);
    expect(result.speciesConfigs[0].embeddingNormalize).toEqual({
      mean: [0.5, 0.5, 0.5],
      std: [0.25, 0.25, 0.25],
    });
    expect(result.speciesConfigs[0].detectorConfig).toEqual({
      confidenceThreshold: 0.6,
    });
  });

  it('falls back to the default detector config when the manifest is unreadable', async () => {
    const result = await buildActiveSpeciesConfigs(
      [makePack()],
      makeModel(),
      [],
    );
    expect(result.speciesConfigs[0].detectorConfig.architecture).toBe(
      'yolov5',
    );
    expect(result.speciesConfigs[0].embeddingInputSize).toBeUndefined();
  });

  it('does not read a detector configuration outside the pack', async () => {
    mockLoadManifest.mockResolvedValue({
      embeddingModel: { inputSize: [440, 440] },
      detectorModel: { configFile: '../outside.json' },
    });
    await buildActiveSpeciesConfigs([makePack()], makeModel(), []);
    expect(RNFS.readFile).not.toHaveBeenCalled();
  });

  it('does not load a manifest symlink outside the pack', async () => {
    (RNFS.stat as jest.Mock).mockImplementation(async (filepath: string) => ({
      canonicalPath: filepath === '/mock/pack/manifest.json' ? '/outside/manifest.json' : filepath,
      isFile: () => filepath !== '/mock/pack',
      isDirectory: () => filepath === '/mock/pack',
    }));
    await buildActiveSpeciesConfigs([makePack()], makeModel(), []);
    expect(mockLoadManifest).not.toHaveBeenCalled();
  });
});
