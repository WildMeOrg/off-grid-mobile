import {
  reconcileMiewidModel,
  checkEmbeddingModelCompatibility,
  acquireMiewidModel,
  prepareMiewidModel,
} from '../../../src/services/miewidModelManager';
import { useWildlifeStore } from '../../../src/stores/wildlifeStore';
import type { MiewIDModelRecord } from '../../../src/types';

jest.mock('react-native-fs', () => ({
  exists: jest.fn(),
  stat: jest.fn(),
  hash: jest.fn(),
}));

jest.mock('../../../src/services/modelDownloadService', () => ({
  modelDownloadService: {
    downloadModel: jest.fn(),
  },
}));

import RNFS from 'react-native-fs';
import { modelDownloadService } from '../../../src/services/modelDownloadService';

const mockDownloadModel = modelDownloadService.downloadModel as jest.Mock;

const mockExists = RNFS.exists as jest.Mock;
const mockStat = RNFS.stat as jest.Mock;
const mockHash = RNFS.hash as jest.Mock;

const makeRecord = (
  overrides: Partial<MiewIDModelRecord> = {},
): MiewIDModelRecord => ({
  path: '/mock/documents/models/miewid-4.1.0.onnx',
  name: 'miewid',
  version: '4.1.0',
  sha256: 'abc123',
  sizeBytes: 103_859_027,
  status: 'ready',
  verifiedAt: '2026-08-01T00:00:00.000Z',
  format: 'onnx',
  ...overrides,
});

describe('reconcileMiewidModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null for a null record', async () => {
    expect(await reconcileMiewidModel(null)).toBeNull();
  });

  it('marks an interrupted download as missing', async () => {
    const record = makeRecord({ status: 'downloading', verifiedAt: null });

    const result = await reconcileMiewidModel(record);

    expect(result?.status).toBe('missing');
  });

  it('marks the record missing when the file does not exist', async () => {
    mockExists.mockResolvedValue(false);

    const result = await reconcileMiewidModel(makeRecord());

    expect(result?.status).toBe('missing');
    expect(mockStat).not.toHaveBeenCalled();
  });

  it('marks the record corrupt on file size mismatch', async () => {
    mockExists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ size: 12345 });

    const result = await reconcileMiewidModel(makeRecord());

    expect(result?.status).toBe('corrupt');
    expect(mockHash).not.toHaveBeenCalled();
  });

  it('skips hashing for an already-verified record with intact size', async () => {
    mockExists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ size: 103_859_027 });

    const result = await reconcileMiewidModel(makeRecord());

    expect(result?.status).toBe('ready');
    expect(mockHash).not.toHaveBeenCalled();
  });

  it('hashes an unverified record and marks it ready on match', async () => {
    mockExists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ size: 103_859_027 });
    mockHash.mockResolvedValue('abc123');
    const record = makeRecord({ verifiedAt: null });

    const result = await reconcileMiewidModel(record);

    expect(mockHash).toHaveBeenCalledWith(record.path, 'sha256');
    expect(result?.status).toBe('ready');
    expect(result?.verifiedAt).not.toBeNull();
  });

  it('marks an unverified record corrupt on hash mismatch', async () => {
    mockExists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ size: 103_859_027 });
    mockHash.mockResolvedValue('deadbeef');

    const result = await reconcileMiewidModel(makeRecord({ verifiedAt: null }));

    expect(result?.status).toBe('corrupt');
  });

  it('compares hashes case-insensitively', async () => {
    mockExists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ size: 103_859_027 });
    mockHash.mockResolvedValue('ABC123');

    const result = await reconcileMiewidModel(makeRecord({ verifiedAt: null }));

    expect(result?.status).toBe('ready');
  });

  it('backfills size and hash for a legacy record without sha256', async () => {
    mockExists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ size: 999 });
    mockHash.mockResolvedValue('computedhash');
    const legacy = makeRecord({
      sha256: null,
      sizeBytes: null,
      status: 'missing',
      verifiedAt: null,
      version: 'unknown',
    });

    const result = await reconcileMiewidModel(legacy);

    expect(result?.status).toBe('ready');
    expect(result?.sizeBytes).toBe(999);
    expect(result?.sha256).toBe('computedhash');
    expect(result?.verifiedAt).not.toBeNull();
  });

  it('marks a legacy record with an empty file as corrupt', async () => {
    mockExists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ size: 0 });

    const result = await reconcileMiewidModel(
      makeRecord({ sha256: null, sizeBytes: null, verifiedAt: null }),
    );

    expect(result?.status).toBe('corrupt');
  });

  it('marks the record corrupt when filesystem calls fail', async () => {
    mockExists.mockRejectedValue(new Error('fs unavailable'));

    const result = await reconcileMiewidModel(makeRecord());

    expect(result?.status).toBe('corrupt');
  });
});

describe('acquireMiewidModel', () => {
  const SOURCE = {
    name: 'miewid',
    version: '4.1.0',
    url: 'https://example.org/miewid.onnx',
    expectedSha256: 'abc123',
    expectedSizeBytes: 1000,
    format: 'onnx' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useWildlifeStore.getState().reset();
  });

  it('transitions the store record through downloading to ready on success', async () => {
    const statuses: string[] = [];
    const unsubscribe = useWildlifeStore.subscribe((state) => {
      if (state.miewidModel) {
        statuses.push(state.miewidModel.status);
      }
    });
    mockDownloadModel.mockResolvedValue({
      ok: true,
      path: '/mock/documents/models/miewid-4.1.0.onnx',
      sha256: 'abc123',
      sizeBytes: 1000,
    });

    const record = await acquireMiewidModel(SOURCE);
    unsubscribe();

    expect(statuses).toContain('downloading');
    expect(record.status).toBe('ready');
    expect(record.path).toBe('/mock/documents/models/miewid-4.1.0.onnx');
    expect(record.sha256).toBe('abc123');
    expect(record.sizeBytes).toBe(1000);
    expect(record.version).toBe('4.1.0');
    expect(record.verifiedAt).not.toBeNull();
    expect(useWildlifeStore.getState().miewidModel).toEqual(record);
  });

  it('marks the record corrupt on checksum failure', async () => {
    mockDownloadModel.mockResolvedValue({
      ok: false,
      code: 'checksum-mismatch',
      message: 'hash differs',
    });

    const record = await acquireMiewidModel(SOURCE);

    expect(record.status).toBe('corrupt');
    expect(useWildlifeStore.getState().miewidModel?.status).toBe('corrupt');
  });

  it('marks the record missing on cancellation or network failure', async () => {
    mockDownloadModel.mockResolvedValue({
      ok: false,
      code: 'cancelled',
      message: 'download cancelled',
    });

    const record = await acquireMiewidModel(SOURCE);

    expect(record.status).toBe('missing');
    expect(useWildlifeStore.getState().miewidModel?.status).toBe('missing');
  });

  it('forwards download options to the download service', async () => {
    mockDownloadModel.mockResolvedValue({
      ok: false,
      code: 'network-error',
      message: 'offline',
    });
    const onProgress = jest.fn();

    await acquireMiewidModel(SOURCE, { onProgress });

    expect(mockDownloadModel).toHaveBeenCalledWith(
      SOURCE,
      expect.objectContaining({ onProgress }),
    );
  });
});

describe('prepareMiewidModel', () => {
  const SOURCE = {
    name: 'miewid',
    version: '4.2.0',
    url: 'https://example.org/miewid-4.2.onnx',
    expectedSha256: 'def456',
    expectedSizeBytes: 2000,
    format: 'onnx' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useWildlifeStore.setState({ miewidModel: makeRecord() });
  });

  it('returns a verified candidate without replacing the active model', async () => {
    const active = useWildlifeStore.getState().miewidModel;
    mockDownloadModel.mockResolvedValue({
      ok: true,
      path: '/mock/documents/models/miewid-4.2.0.onnx',
      sha256: 'def456',
      sizeBytes: 2000,
    });

    const candidate = await prepareMiewidModel(SOURCE);

    expect(candidate).toMatchObject({
      version: '4.2.0',
      status: 'ready',
      path: '/mock/documents/models/miewid-4.2.0.onnx',
    });
    expect(useWildlifeStore.getState().miewidModel).toEqual(active);
  });

  it('returns a failed candidate without replacing the active model', async () => {
    const active = useWildlifeStore.getState().miewidModel;
    mockDownloadModel.mockResolvedValue({
      ok: false,
      code: 'checksum-mismatch',
      message: 'hash differs',
    });

    const candidate = await prepareMiewidModel(SOURCE);

    expect(candidate.status).toBe('corrupt');
    expect(useWildlifeStore.getState().miewidModel).toEqual(active);
  });
});

describe('checkEmbeddingModelCompatibility', () => {
  it.each([
    ['4.1.0', '4.1.0', 'compatible'],
    ['v4.1', '4.1.0', 'compatible'],
    ['4.1.0', '4.1.3', 'incompatible'],
    ['4.1.0', '4.2.0', 'incompatible'],
    ['4.2.0', '4.1.0', 'incompatible'],
    ['4.1.0', '5.0.0', 'incompatible'],
    ['5.0.0', '4.1.0', 'incompatible'],
    ['unknown', '4.1.0', 'incompatible'],
    ['4.1.0', 'garbage', 'incompatible'],
    ['', '4.1.0', 'incompatible'],
  ])('(%s, %s) → %s', (modelVersion, packVersion, expected) => {
    expect(checkEmbeddingModelCompatibility(modelVersion, packVersion)).toBe(
      expected,
    );
  });
});
