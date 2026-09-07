jest.mock('../../../../src/services/packManager', () => ({
  packManager: {
    loadPackIndex: jest.fn(),
  },
}));

import { packManager } from '../../../../src/services/packManager';
import { buildIndividualNameIndex } from '../../../../src/services/goldenBatchEvaluator/packNameIndex';
import type { EmbeddingPack, PackIndividual } from '../../../../src/types';

function makePack(overrides: Partial<EmbeddingPack> = {}): EmbeddingPack {
  return {
    id: 'pack-1',
    packVersion: '2026-03-01T00:00:00Z',
    species: 'elephant',
    featureClass: 'elephant+ear',
    displayName: 'Test Elephants',
    wildbookInstanceUrl: 'https://elephants.wildbook.org',
    exportDate: '2026-03-01T00:00:00Z',
    individualCount: 1,
    embeddingDim: 2152,
    embeddingModelVersion: '4.1.0',
    detectorModelFile: '/mock/detector.onnx',
    embeddingsFile: '/mock/pack/embeddings.bin',
    indexFile: '/mock/pack/index.json',
    referencePhotosDir: '/mock/pack/photos',
    packDir: '/mock/pack',
    downloadedAt: '2026-03-01T00:00:00Z',
    sizeBytes: 1024,
    ...overrides,
  };
}

function makeIndividual(overrides: Partial<PackIndividual> = {}): PackIndividual {
  return {
    id: 'WB-ELE-001',
    name: 'Belle',
    alternateId: null,
    sex: 'female',
    lifeStage: 'adult',
    firstSeen: null,
    lastSeen: null,
    encounterCount: 1,
    embeddingCount: 1,
    embeddingOffset: 0,
    referencePhotos: [],
    notes: null,
    ...overrides,
  };
}

describe('buildIndividualNameIndex', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps individual stable IDs to their individual display name', async () => {
    (packManager.loadPackIndex as jest.Mock).mockResolvedValue([
      makeIndividual({ id: 'WB-ELE-001' }),
      makeIndividual({ id: 'WB-ELE-002' }),
    ]);

    const index = await buildIndividualNameIndex([
      makePack({ displayName: 'Test Elephants' }),
    ]);

    expect(index.get('WB-ELE-001')).toBe('Belle');
    expect(index.get('WB-ELE-002')).toBe('Belle');
    expect(index.get('unknown-id')).toBeUndefined();
  });

  it('merges individuals across multiple packs', async () => {
    (packManager.loadPackIndex as jest.Mock)
      .mockResolvedValueOnce([makeIndividual({ id: 'A' })])
      .mockResolvedValueOnce([makeIndividual({ id: 'B' })]);

    const index = await buildIndividualNameIndex([
      makePack({ id: 'p1', displayName: 'Pack One', indexFile: '/p1/index.json' }),
      makePack({ id: 'p2', displayName: 'Pack Two', indexFile: '/p2/index.json' }),
    ]);

    expect(index.get('A')).toBe('Belle');
    expect(index.get('B')).toBe('Belle');
  });

  it('does not throw and skips a pack whose index fails to load', async () => {
    (packManager.loadPackIndex as jest.Mock)
      .mockRejectedValueOnce(new Error('corrupt index'))
      .mockResolvedValueOnce([makeIndividual({ id: 'B' })]);

    const index = await buildIndividualNameIndex([
      makePack({ id: 'broken', indexFile: '/broken/index.json' }),
      makePack({ id: 'good', displayName: 'Good Pack', indexFile: '/good/index.json' }),
    ]);

    expect(index.has('B')).toBe(true);
    expect(index.get('B')).toBe('Belle');
  });

  it('returns an empty map for an empty pack list', async () => {
    const index = await buildIndividualNameIndex([]);
    expect(index.size).toBe(0);
  });
});
