jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/documents',
  readFile: jest.fn(),
  exists: jest.fn(),
  mkdir: jest.fn(),
  unlink: jest.fn(),
}));

jest.mock('../../../src/services/packManager', () => ({
  packManager: {
    loadPackIndex: jest.fn(),
    getEmbeddingsForIndividual: jest.fn(),
  },
}));

import RNFS from 'react-native-fs';
import { packManager } from '../../../src/services/packManager';
import { buildEmbeddingDatabase } from '../../../src/services/embeddingDatabaseBuilder';
import type { EmbeddingPack, LocalIndividual, PackIndividual } from '../../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePack(overrides: Partial<EmbeddingPack> = {}): EmbeddingPack {
  return {
    id: 'pack-horse-001',
    packVersion: '2026-03-01T00:00:00Z',
    species: 'horse',
    featureClass: 'horse+face',
    displayName: 'Test Horses',
    wildbookInstanceUrl: 'https://horses.wildbook.org',
    exportDate: '2026-03-01T00:00:00Z',
    individualCount: 2,
    embeddingDim: 3,
    embeddingModelVersion: '4.0.0',
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

function makeLocalIndividual(
  overrides: Partial<LocalIndividual> = {},
): LocalIndividual {
  return {
    localId: 'FIELD-001',
    userLabel: null,
    species: 'horse',
    embeddings: [[0.1, 0.2, 0.3]],
    referencePhotos: ['photo1.jpg'],
    firstSeen: '2026-03-01T00:00:00Z',
    encounterCount: 1,
    syncStatus: 'pending',
    wildbookId: null,
    ...overrides,
  };
}

function makePackIndividual(
  overrides: Partial<PackIndividual> = {},
): PackIndividual {
  return {
    id: 'WB-HORSE-001',
    name: 'Butterscotch',
    alternateId: null,
    sex: 'female',
    lifeStage: 'adult',
    firstSeen: '2024-06-15',
    lastSeen: '2026-02-10',
    encounterCount: 12,
    embeddingCount: 2,
    embeddingOffset: 0,
    referencePhotos: ['ref_01.jpg'],
    notes: null,
    ...overrides,
  };
}

/**
 * Create a fake base64-encoded Float32Array.
 * This simulates what RNFS.readFile(path, 'base64') would return
 * for a binary embeddings file.
 */
function floatArrayToBase64(values: number[]): string {
  const float32 = new Float32Array(values);
  const uint8 = new Uint8Array(float32.buffer);
  let binaryString = '';
  for (let i = 0; i < uint8.length; i++) {
    binaryString += String.fromCharCode(uint8[i]);
  }
  return btoa(binaryString);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildEmbeddingDatabase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty array when no packs and no locals match species', async () => {
    const result = await buildEmbeddingDatabase('zebra', [], []);
    expect(result).toEqual([]);
  });

  it('returns empty array when packs and locals are for a different species', async () => {
    const pack = makePack({ species: 'horse' });
    const local = makeLocalIndividual({ species: 'horse' });

    const result = await buildEmbeddingDatabase('zebra', [pack], [local]);
    expect(result).toEqual([]);
    // Should not have attempted to load pack data for non-matching species
    expect(packManager.loadPackIndex).not.toHaveBeenCalled();
  });

  // ---- Local individual tests -----------------------------------------------

  it('returns local individual entries for matching species', async () => {
    const local = makeLocalIndividual({
      localId: 'FIELD-042',
      species: 'horse',
      embeddings: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
    });

    const result = await buildEmbeddingDatabase('horse', [], [local]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      individualId: 'FIELD-042',
      source: 'local',
      embeddings: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
      refPhotoIndex: 0,
    });
  });

  it('filters local individuals by species', async () => {
    const horse = makeLocalIndividual({ localId: 'H-001', species: 'horse' });
    const zebra = makeLocalIndividual({ localId: 'Z-001', species: 'zebra' });

    const result = await buildEmbeddingDatabase(
      'horse',
      [],
      [horse, zebra],
    );

    expect(result).toHaveLength(1);
    expect(result[0].individualId).toBe('H-001');
  });

  it('skips local individuals with empty embeddings', async () => {
    const noEmbeddings = makeLocalIndividual({
      localId: 'FIELD-EMPTY',
      species: 'horse',
      embeddings: [],
    });
    const withEmbeddings = makeLocalIndividual({
      localId: 'FIELD-HAS',
      species: 'horse',
      embeddings: [[1, 2, 3]],
    });

    const result = await buildEmbeddingDatabase(
      'horse',
      [],
      [noEmbeddings, withEmbeddings],
    );

    expect(result).toHaveLength(1);
    expect(result[0].individualId).toBe('FIELD-HAS');
  });

  // ---- Pack individual tests ------------------------------------------------

  it('returns pack individual entries with mocked binary loading', async () => {
    const pack = makePack({ embeddingDim: 3 });
    const individual1 = makePackIndividual({
      id: 'WB-HORSE-001',
      embeddingCount: 2,
      embeddingOffset: 0,
    });
    const individual2 = makePackIndividual({
      id: 'WB-HORSE-002',
      embeddingCount: 1,
      embeddingOffset: 2,
    });

    (packManager.loadPackIndex as jest.Mock).mockResolvedValue([
      individual1,
      individual2,
    ]);

    // 3 vectors of dim 3: [1,2,3], [4,5,6], [7,8,9]
    const base64Data = floatArrayToBase64([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    (RNFS.readFile as jest.Mock).mockResolvedValue(base64Data);

    (packManager.getEmbeddingsForIndividual as jest.Mock)
      .mockReturnValueOnce([
        [1, 2, 3],
        [4, 5, 6],
      ])
      .mockReturnValueOnce([[7, 8, 9]]);

    const result = await buildEmbeddingDatabase('horse', [pack], []);

    expect(packManager.loadPackIndex).toHaveBeenCalledWith(pack.indexFile);
    expect(RNFS.readFile).toHaveBeenCalledWith(pack.embeddingsFile, 'base64');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      individualId: 'WB-HORSE-001',
      source: 'pack',
      embeddings: [
        [1, 2, 3],
        [4, 5, 6],
      ],
      refPhotoIndex: 0,
    });
    expect(result[1]).toEqual({
      individualId: 'WB-HORSE-002',
      source: 'pack',
      embeddings: [[7, 8, 9]],
      refPhotoIndex: 0,
    });
  });

  it('skips pack individuals with zero embeddings', async () => {
    const pack = makePack({ embeddingDim: 3 });
    const individual = makePackIndividual({
      id: 'WB-HORSE-EMPTY',
      embeddingCount: 0,
      embeddingOffset: 0,
    });

    (packManager.loadPackIndex as jest.Mock).mockResolvedValue([individual]);
    const base64Data = floatArrayToBase64([1, 2, 3]);
    (RNFS.readFile as jest.Mock).mockResolvedValue(base64Data);
    (packManager.getEmbeddingsForIndividual as jest.Mock).mockReturnValue([]);

    const result = await buildEmbeddingDatabase('horse', [pack], []);

    expect(result).toHaveLength(0);
  });

  it('handles pack loading errors gracefully', async () => {
    const pack = makePack();
    (packManager.loadPackIndex as jest.Mock).mockRejectedValue(
      new Error('File not found'),
    );

    // Should not throw
    const result = await buildEmbeddingDatabase('horse', [pack], []);
    expect(result).toEqual([]);
  });

  it('continues loading other packs when one fails', async () => {
    const brokenPack = makePack({ id: 'broken', indexFile: '/broken/index.json' });
    const goodPack = makePack({
      id: 'good',
      indexFile: '/good/index.json',
      embeddingsFile: '/good/embeddings.bin',
      embeddingDim: 2,
    });

    const individual = makePackIndividual({
      id: 'WB-HORSE-010',
      embeddingCount: 1,
      embeddingOffset: 0,
    });

    (packManager.loadPackIndex as jest.Mock)
      .mockRejectedValueOnce(new Error('corrupt'))
      .mockResolvedValueOnce([individual]);

    const base64Data = floatArrayToBase64([0.5, 0.6]);
    (RNFS.readFile as jest.Mock).mockResolvedValue(base64Data);
    (packManager.getEmbeddingsForIndividual as jest.Mock).mockReturnValue([
      [0.5, 0.6],
    ]);

    const result = await buildEmbeddingDatabase(
      'horse',
      [brokenPack, goodPack],
      [],
    );

    expect(result).toHaveLength(1);
    expect(result[0].individualId).toBe('WB-HORSE-010');
    expect(result[0].source).toBe('pack');
  });

  // ---- Combined tests -------------------------------------------------------

  it('combines pack and local entries', async () => {
    const pack = makePack({ embeddingDim: 3 });
    const packIndividual = makePackIndividual({
      id: 'WB-HORSE-001',
      embeddingCount: 1,
      embeddingOffset: 0,
    });

    (packManager.loadPackIndex as jest.Mock).mockResolvedValue([
      packIndividual,
    ]);
    const base64Data = floatArrayToBase64([10, 20, 30]);
    (RNFS.readFile as jest.Mock).mockResolvedValue(base64Data);
    (packManager.getEmbeddingsForIndividual as jest.Mock).mockReturnValue([
      [10, 20, 30],
    ]);

    const local = makeLocalIndividual({
      localId: 'FIELD-007',
      species: 'horse',
      embeddings: [[0.7, 0.8, 0.9]],
    });

    const result = await buildEmbeddingDatabase('horse', [pack], [local]);

    expect(result).toHaveLength(2);

    const packEntry = result.find((e) => e.source === 'pack');
    const localEntry = result.find((e) => e.source === 'local');

    expect(packEntry).toBeDefined();
    expect(packEntry!.individualId).toBe('WB-HORSE-001');

    expect(localEntry).toBeDefined();
    expect(localEntry!.individualId).toBe('FIELD-007');
  });

  it('handles multiple packs for the same species', async () => {
    const pack1 = makePack({
      id: 'pack-1',
      indexFile: '/pack1/index.json',
      embeddingsFile: '/pack1/embeddings.bin',
      embeddingDim: 2,
    });
    const pack2 = makePack({
      id: 'pack-2',
      indexFile: '/pack2/index.json',
      embeddingsFile: '/pack2/embeddings.bin',
      embeddingDim: 2,
    });

    const ind1 = makePackIndividual({ id: 'IND-A', embeddingCount: 1, embeddingOffset: 0 });
    const ind2 = makePackIndividual({ id: 'IND-B', embeddingCount: 1, embeddingOffset: 0 });

    (packManager.loadPackIndex as jest.Mock)
      .mockResolvedValueOnce([ind1])
      .mockResolvedValueOnce([ind2]);

    (RNFS.readFile as jest.Mock)
      .mockResolvedValueOnce(floatArrayToBase64([1, 2]))
      .mockResolvedValueOnce(floatArrayToBase64([3, 4]));

    (packManager.getEmbeddingsForIndividual as jest.Mock)
      .mockReturnValueOnce([[1, 2]])
      .mockReturnValueOnce([[3, 4]]);

    const result = await buildEmbeddingDatabase('horse', [pack1, pack2], []);

    expect(result).toHaveLength(2);
    expect(result[0].individualId).toBe('IND-A');
    expect(result[1].individualId).toBe('IND-B');
  });
});
