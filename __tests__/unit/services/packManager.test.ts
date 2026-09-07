jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/documents',
  exists: jest.fn(),
  mkdir: jest.fn(),
  readFile: jest.fn(),
  readDir: jest.fn(),
  unlink: jest.fn(),
  stat: jest.fn(),
}));

jest.mock('../../../src/services/packManager/validator', () => ({
  validatePack: jest.fn(),
}));

import RNFS from 'react-native-fs';
import { packManager } from '../../../src/services/packManager';

describe('PackManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should export a singleton instance', () => {
    expect(packManager).toBeDefined();
    expect(typeof packManager.initialize).toBe('function');
    expect(typeof packManager.loadPackIndex).toBe('function');
    expect(typeof packManager.loadManifest).toBe('function');
    expect(typeof packManager.getEmbeddingsForIndividual).toBe('function');
    expect(typeof packManager.deletePack).toBe('function');
    expect(typeof packManager.getPacksDir).toBe('function');
  });

  describe('initialize', () => {
    it('should create packs directory if it does not exist', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(false);
      (RNFS.mkdir as jest.Mock).mockResolvedValue(undefined);

      await packManager.initialize();

      expect(RNFS.exists).toHaveBeenCalledWith('/mock/documents/embedding_packs');
      expect(RNFS.mkdir).toHaveBeenCalledWith('/mock/documents/embedding_packs');
    });

    it('should not create directory if it already exists', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(true);

      await packManager.initialize();

      expect(RNFS.mkdir).not.toHaveBeenCalled();
    });
  });

  describe('loadPackIndex', () => {
    it.each([
      [{ id: '../outside', referencePhotos: ['ref.jpg'] }],
      [{ id: 'individual-001', referencePhotos: ['../../outside.jpg'] }],
      [{ id: 'individual-001', referencePhotos: ['file:///outside.jpg'] }],
      [{ id: 'individual-001', referencePhotos: [null] }],
      [null],
      null,
    ])('rejects an unsafe stored index before returning references: %j', async individuals => {
      (RNFS.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ individuals }));
      await expect(packManager.loadPackIndex('/mock/pack/embeddings/index.json'))
        .rejects.toThrow('Pack index contains unsafe individual or reference-photo paths');
    });

    it('should parse index.json and return PackIndividuals', async () => {
      const mockIndex = {
        formatVersion: '1.0',
        generatedWith: 'miewid-v4',
        individuals: [
          {
            id: 'WB-HORSE-001',
            name: 'Butterscotch',
            alternateId: null,
            sex: 'female',
            lifeStage: 'adult',
            firstSeen: '2024-06-15',
            lastSeen: '2026-02-10',
            encounterCount: 12,
            embeddingCount: 5,
            embeddingOffset: 0,
            referencePhotos: ['ref_01.jpg'],
            notes: null,
          },
          {
            id: 'WB-HORSE-002',
            name: 'Thunder',
            alternateId: null,
            sex: 'male',
            lifeStage: 'adult',
            firstSeen: '2025-01-20',
            lastSeen: '2026-03-01',
            encounterCount: 8,
            embeddingCount: 3,
            embeddingOffset: 5,
            referencePhotos: ['ref_01.jpg'],
            notes: null,
          },
        ],
      };

      (RNFS.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockIndex));

      const individuals = await packManager.loadPackIndex('/mock/pack/embeddings/index.json');

      expect(individuals).toHaveLength(2);
      expect(individuals[0].id).toBe('WB-HORSE-001');
      expect(individuals[0].name).toBe('Butterscotch');
      expect(individuals[0].embeddingCount).toBe(5);
      expect(individuals[0].embeddingOffset).toBe(0);
      expect(individuals[1].id).toBe('WB-HORSE-002');
      expect(individuals[1].embeddingOffset).toBe(5);
    });
  });

  describe('loadManifest', () => {
    it('should parse manifest.json', async () => {
      const mockManifest = {
        formatVersion: '1.0',
        species: 'horse',
        featureClass: 'horse+face',
        displayName: 'Test Horses',
        wildbookInstanceUrl: 'https://horses.wildbook.org',
        exportDate: '2026-03-15T00:00:00Z',
        individualCount: 2,
        embeddingCount: 8,
        embeddingDim: 2152,
        embeddingModel: {
          name: 'miewid-v4',
          version: '4.0.0',
          inputSize: [440, 440],
          normalize: { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
        },
        detectorModel: {
          filename: 'horse-face-yolo11n.onnx',
          configFile: 'config/detector.json',
        },
      };

      (RNFS.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockManifest));

      const manifest = await packManager.loadManifest('/mock/pack/manifest.json');

      expect(manifest.species).toBe('horse');
      expect(manifest.embeddingDim).toBe(2152);
      expect(manifest.detectorModel.filename).toBe('horse-face-yolo11n.onnx');
    });
  });

  describe('getEmbeddingsForIndividual', () => {
    it('should extract correct embedding vectors by offset and count', () => {
      // Simulate embeddings.bin with 3-dim embeddings for simplicity
      const embeddingDim = 3;
      // 8 total vectors: [0,1,2], [3,4,5], [6,7,8], [9,10,11], [12,13,14], [15,16,17], [18,19,20], [21,22,23]
      const allEmbeddings = new Float32Array([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
      ]);

      const individual = {
        id: 'WB-HORSE-002',
        name: 'Thunder',
        alternateId: null,
        sex: 'male' as const,
        lifeStage: 'adult',
        firstSeen: '2025-01-20',
        lastSeen: '2026-03-01',
        encounterCount: 8,
        embeddingCount: 3,
        embeddingOffset: 5, // starts at vector index 5
        referencePhotos: ['ref_01.jpg'],
        notes: null,
      };

      const result = packManager.getEmbeddingsForIndividual(allEmbeddings, individual, embeddingDim);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual([15, 16, 17]); // offset 5 * dim 3 = byte 15
      expect(result[1]).toEqual([18, 19, 20]);
      expect(result[2]).toEqual([21, 22, 23]);
    });

    it('should throw a RangeError when the requested range exceeds the buffer', () => {
      const embeddingDim = 3;
      const allEmbeddings = new Float32Array([0, 1, 2, 3, 4, 5]); // 2 vectors

      const individual = {
        id: 'WB-BAD',
        name: null,
        alternateId: null,
        sex: null,
        lifeStage: null,
        firstSeen: null,
        lastSeen: null,
        encounterCount: 1,
        embeddingCount: 2,
        embeddingOffset: 1, // (1 + 2) * 3 = 9 > 6
        referencePhotos: [],
        notes: null,
      };

      expect(() =>
        packManager.getEmbeddingsForIndividual(allEmbeddings, individual, embeddingDim),
      ).toThrow(RangeError);
    });

    it('should throw a RangeError for a negative offset', () => {
      const allEmbeddings = new Float32Array([0, 1, 2]);

      const individual = {
        id: 'WB-NEG',
        name: null,
        alternateId: null,
        sex: null,
        lifeStage: null,
        firstSeen: null,
        lastSeen: null,
        encounterCount: 1,
        embeddingCount: 1,
        embeddingOffset: -1,
        referencePhotos: [],
        notes: null,
      };

      expect(() =>
        packManager.getEmbeddingsForIndividual(allEmbeddings, individual, 3),
      ).toThrow(RangeError);
    });
  });

  describe('reconcilePacks', () => {
    const { validatePack } = require('../../../src/services/packManager/validator');

    const makeStoredPack = (overrides: Record<string, unknown> = {}) => ({
      id: 'pack-1',
      packVersion: '2026-04-25T00:00:00Z',
      species: 'horse',
      featureClass: 'horse_wild+face',
      displayName: 'Horses',
      wildbookInstanceUrl: 'https://horses.wildbook.org',
      exportDate: '2026-04-25T00:00:00Z',
      individualCount: 5,
      embeddingDim: 2152,
      embeddingModelVersion: '4.1.0',
      detectorModelFile: '/mock/packs/horse/models/detector.onnx',
      embeddingsFile: '/mock/packs/horse/embeddings/embeddings.bin',
      indexFile: '/mock/packs/horse/embeddings/index.json',
      referencePhotosDir: '/mock/packs/horse/reference_photos',
      packDir: '/mock/packs/horse',
      downloadedAt: '2026-04-25T12:00:00Z',
      sizeBytes: 9_000_000,
      ...overrides,
    });

    it('keeps a previously validated intact pack ready using cheap mode', async () => {
      validatePack.mockResolvedValue({ ok: true, manifest: {}, individuals: [] });
      const pack = makeStoredPack({
        status: 'ready',
        validatedAt: '2026-04-25T12:00:00Z',
      });

      const result = await packManager.reconcilePacks([pack] as never[]);

      expect(validatePack).toHaveBeenCalledWith('/mock/packs/horse', {
        skipChecksums: true,
      });
      expect(result[0].status).toBe('ready');
    });

    it('fully validates a pack that was never validated', async () => {
      validatePack.mockResolvedValue({ ok: true, manifest: {}, individuals: [] });
      const pack = makeStoredPack();

      const result = await packManager.reconcilePacks([pack] as never[]);

      expect(validatePack).toHaveBeenCalledWith('/mock/packs/horse', {
        skipChecksums: false,
      });
      expect(result[0].status).toBe('ready');
      expect(result[0].validatedAt).toBeTruthy();
    });

    it('quarantines a pack that fails validation and records the errors', async () => {
      validatePack.mockResolvedValue({
        ok: false,
        errors: [
          { code: 'checksum-mismatch', detail: 'embeddings.bin hash differs' },
        ],
      });
      const pack = makeStoredPack({ status: 'ready', validatedAt: '2026-04-25T12:00:00Z' });

      const result = await packManager.reconcilePacks([pack] as never[]);

      expect(result[0].status).toBe('quarantined');
      expect(result[0].validationErrors).toEqual([
        'checksum-mismatch: embeddings.bin hash differs',
      ]);
    });

    it('reconciles each pack independently', async () => {
      validatePack
        .mockResolvedValueOnce({ ok: true, manifest: {}, individuals: [] })
        .mockResolvedValueOnce({
          ok: false,
          errors: [{ code: 'file-missing', detail: 'embeddings.bin' }],
        });

      const result = await packManager.reconcilePacks([
        makeStoredPack({ id: 'pack-good' }),
        makeStoredPack({ id: 'pack-bad', packDir: '/mock/packs/bad' }),
      ] as never[]);

      expect(result[0].status).toBe('ready');
      expect(result[1].status).toBe('quarantined');
    });
  });

  describe('deletePack', () => {
    it('should delete pack directory if it exists', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      (RNFS.unlink as jest.Mock).mockResolvedValue(undefined);

      await packManager.deletePack('/mock/documents/embedding_packs/test-pack');

      expect(RNFS.unlink).toHaveBeenCalledWith('/mock/documents/embedding_packs/test-pack');
    });

    it('should be a no-op if pack directory does not exist', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(false);

      await packManager.deletePack('/mock/nonexistent');

      expect(RNFS.unlink).not.toHaveBeenCalled();
    });
  });

  describe('getPacksDir', () => {
    it('should return the packs directory path', () => {
      expect(packManager.getPacksDir()).toBe('/mock/documents/embedding_packs');
    });
  });
});
