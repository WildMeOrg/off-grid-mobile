import { resolveMiewidModelSource } from '../../../src/services/modelSourceResolver';
import { ganeshaApiClient } from '../../../src/services/ganeshaApiClient';
import { MIEWID_MODEL_NAME } from '../../../src/config/modelSources';

jest.mock('../../../src/services/ganeshaApiClient', () => ({
  ganeshaApiClient: { getLatestModel: jest.fn() },
}));

const mockGetLatestModel = ganeshaApiClient.getLatestModel as jest.Mock;

describe('resolveMiewidModelSource', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves the miewid model name against the backend', async () => {
    mockGetLatestModel.mockResolvedValue({
      ok: true,
      data: {
        name: 'miewid',
        version: '4.1.0',
        sha256:
          '1ff7c7879bb9e6b1847d19e1905e80f4e960aeed645dce9a52b9aaded2f0f763',
        sizeBytes: 204_011_297,
        downloadUrl:
          'https://blobs.example.invalid/model-artifacts/miewid/4.1.0/miewid_v4_1.onnx?sig=x',
      },
    });

    await resolveMiewidModelSource();

    expect(mockGetLatestModel).toHaveBeenCalledWith(MIEWID_MODEL_NAME);
  });

  it('maps a successful backend response to a ModelSource', async () => {
    mockGetLatestModel.mockResolvedValue({
      ok: true,
      data: {
        name: 'miewid',
        version: '4.1.0',
        sha256:
          '1ff7c7879bb9e6b1847d19e1905e80f4e960aeed645dce9a52b9aaded2f0f763',
        sizeBytes: 204_011_297,
        downloadUrl:
          'https://blobs.example.invalid/model-artifacts/miewid/4.1.0/miewid_v4_1.onnx?sig=x',
      },
    });

    const result = await resolveMiewidModelSource();

    expect(result).toEqual({
      ok: true,
      source: {
        name: 'miewid',
        version: '4.1.0',
        url: 'https://blobs.example.invalid/model-artifacts/miewid/4.1.0/miewid_v4_1.onnx?sig=x',
        expectedSha256:
          '1ff7c7879bb9e6b1847d19e1905e80f4e960aeed645dce9a52b9aaded2f0f763',
        expectedSizeBytes: 204_011_297,
        format: 'onnx',
      },
    });
  });

  it('passes through a not-found error unchanged', async () => {
    mockGetLatestModel.mockResolvedValue({
      ok: false,
      code: 'not-found',
      message: 'HTTP 404',
      httpStatus: 404,
    });

    const result = await resolveMiewidModelSource();

    expect(result).toEqual({
      ok: false,
      code: 'not-found',
      message: 'HTTP 404',
      httpStatus: 404,
    });
  });

  it('passes through a network error unchanged', async () => {
    mockGetLatestModel.mockResolvedValue({
      ok: false,
      code: 'network-error',
      message: 'getaddrinfo ENOTFOUND',
    });

    const result = await resolveMiewidModelSource();

    expect(result).toEqual({
      ok: false,
      code: 'network-error',
      message: 'getaddrinfo ENOTFOUND',
    });
  });

  it('resolves format tflite for a .tflite download URL', async () => {
    mockGetLatestModel.mockResolvedValue({
      ok: true,
      data: {
        name: 'miewid-litert',
        version: '4.1.0',
        sha256: 'a'.repeat(64),
        sizeBytes: 53_000_000,
        downloadUrl:
          'https://blobs.example.invalid/model-artifacts/miewid-litert/4.1.0/miewid_v4_1.tflite?sig=x',
      },
    });

    const result = await resolveMiewidModelSource('miewid-litert');

    expect(mockGetLatestModel).toHaveBeenCalledWith('miewid-litert');
    expect(result.ok && result.source.format).toBe('tflite');
  });
});
