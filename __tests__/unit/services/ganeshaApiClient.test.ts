import { GANESHA_API_BASE_URL } from '../../../src/config/ganeshaApi';

jest.mock('../../../src/services/entraAuthService', () => ({
  entraAuthService: { getValidAccessToken: jest.fn() },
}));

import { ganeshaApiClient } from '../../../src/services/ganeshaApiClient';
import { entraAuthService } from '../../../src/services/entraAuthService';

const mockGetValidAccessToken = entraAuthService.getValidAccessToken as jest.Mock;
const mockFetch = jest.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  }) as unknown as Response;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetValidAccessToken.mockResolvedValue('fake-access-token');
});

describe('ganeshaApiClient auth', () => {
  it('sends the Entra access token as a Bearer header', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, {}));

    await ganeshaApiClient.getLatestModel('miewid');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fake-access-token' }),
      }),
    );
  });

  it('returns an unauthenticated result and never calls fetch when there is no valid session', async () => {
    mockGetValidAccessToken.mockResolvedValue(null);

    const result = await ganeshaApiClient.getLatestModel('miewid');

    expect(result).toEqual({ ok: false, code: 'unauthenticated', message: 'Not signed in' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('ganeshaApiClient.getLatestModel', () => {
  it('returns parsed model info', async () => {
    const body = {
      name: 'miewid',
      version: '4.1.0',
      sha256: '1ff7c7879bb9e6b1847d19e1905e80f4e960aeed645dce9a52b9aaded2f0f763',
      sizeBytes: 204011297,
      downloadUrl: 'https://blobs.example.invalid/model-artifacts/miewid/4.1.0/miewid_v4_1.onnx?sig=x',
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(200, body));

    const result = await ganeshaApiClient.getLatestModel('miewid');

    expect(result).toEqual({ ok: true, data: body });
    expect(mockFetch).toHaveBeenCalledWith(
      `${GANESHA_API_BASE_URL}/models/miewid/latest`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('URL-encodes the model name', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, {}));

    await ganeshaApiClient.getLatestModel('a model/with slash');

    expect(mockFetch).toHaveBeenCalledWith(
      `${GANESHA_API_BASE_URL}/models/a%20model%2Fwith%20slash/latest`,
      expect.anything(),
    );
  });

  it('maps a 404 to a not-found result', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(404, { error: 'No published model found for this name' }));

    const result = await ganeshaApiClient.getLatestModel('nonexistent');

    expect(result).toEqual({ ok: false, code: 'not-found', message: 'HTTP 404', httpStatus: 404 });
  });

  it('maps a 401 to an unauthorized result', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, { error: 'Unauthorized' }));

    const result = await ganeshaApiClient.getLatestModel('miewid');

    expect(result).toEqual({ ok: false, code: 'unauthorized', message: 'HTTP 401', httpStatus: 401 });
  });

  it('maps a 500 to an http-error result', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(500, { error: 'Internal error' }));

    const result = await ganeshaApiClient.getLatestModel('miewid');

    expect(result).toEqual({ ok: false, code: 'http-error', message: 'HTTP 500', httpStatus: 500 });
  });

  it('maps a network failure (fetch rejects) to a network-error result', async () => {
    mockFetch.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));

    const result = await ganeshaApiClient.getLatestModel('miewid');

    expect(result).toEqual({ ok: false, code: 'network-error', message: 'getaddrinfo ENOTFOUND' });
  });

  it('maps malformed JSON to a parse-error result', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: () => Promise.reject(new Error('Unexpected token')),
    } as unknown as Response);

    const result = await ganeshaApiClient.getLatestModel('miewid');

    expect(result).toEqual({ ok: false, code: 'parse-error', message: 'Unexpected token' });
  });
});

describe('ganeshaApiClient.getLatestPack', () => {
  it('returns parsed pack info from the project-scoped endpoint', async () => {
    const body = {
      projectId: 'example-project',
      displayName: 'Example Population',
      version: '2026-08-22T12:38:40Z',
      sha256: 'ebed1d341b58034de6108a5b138373aa64a7e8458bc43e43909ad0850bf660ba',
      sizeBytes: 20684583,
      individualCount: 3,
      embeddingCount: 141,
      downloadUrl: 'https://blobs.example.invalid/wildlife-packs/example-project/example-pack.zip?sig=x',
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(200, body));

    const result = await ganeshaApiClient.getLatestPack('example-project');

    expect(result).toEqual({ ok: true, data: body });
    expect(mockFetch).toHaveBeenCalledWith(
      `${GANESHA_API_BASE_URL}/projects/example-project/packs/latest`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('maps a 403 (forbidden project access) to an unauthorized result', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(403, { error: 'Forbidden' }));

    const result = await ganeshaApiClient.getLatestPack('proj_other');

    expect(result).toEqual({ ok: false, code: 'unauthorized', message: 'HTTP 403', httpStatus: 403 });
  });

  it('maps a 404 (no published pack) to a not-found result', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(404, { error: 'No published pack found for this project' }));

    const result = await ganeshaApiClient.getLatestPack('example-project');

    expect(result).toEqual({ ok: false, code: 'not-found', message: 'HTTP 404', httpStatus: 404 });
  });
});

describe('ganeshaApiClient.getUploadUrl', () => {
  it('POSTs the filename and returns the upload/blob URLs', async () => {
    const body = {
      uploadUrl: 'https://blobs.example.invalid/elephant-images/example-project/u1/x_det-1.jpg?sig=x',
      blobUrl: 'https://blobs.example.invalid/elephant-images/example-project/u1/x_det-1.jpg',
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(200, body));

    const result = await ganeshaApiClient.getUploadUrl('example-project', 'det-1.jpg');

    expect(result).toEqual({ ok: true, data: body });
    expect(mockFetch).toHaveBeenCalledWith(
      `${GANESHA_API_BASE_URL}/projects/example-project/upload-url`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ filename: 'det-1.jpg' }),
      }),
    );
  });

  it('maps a network failure to a network-error result', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));

    const result = await ganeshaApiClient.getUploadUrl('example-project', 'det-1.jpg');

    expect(result).toEqual({ ok: false, code: 'network-error', message: 'offline' });
  });
});

describe('ganeshaApiClient.submitObservation', () => {
  it('POSTs the submission payload and returns the created submission id', async () => {
    const body = { submissionId: 'sub-1', status: 'reviewing', imageUrl: 'https://example.com/signed.jpg' };
    mockFetch.mockResolvedValueOnce(jsonResponse(200, body));

    const payload = {
      imageUrl: 'https://blobs.example.invalid/elephant-images/example-project/u1/x_det-1.jpg',
      elephantId: 'elephant-thomas',
      confidence: 0.954,
      alternatives: [{ individualId: 'elephant-thomas', score: 0.954, source: 'pack', refPhotoIndex: 0 }],
      lat: -33.5,
      long: 26.9,
      observationDate: '2026-08-23T10:00:00Z',
      captureTimestamp: '2026-08-23T10:00:00Z',
      deviceModel: 'Pixel 9a',
      deviceOs: 'Android 16',
    };
    const result = await ganeshaApiClient.submitObservation('example-project', payload);

    expect(result).toEqual({ ok: true, data: body });
    expect(mockFetch).toHaveBeenCalledWith(
      `${GANESHA_API_BASE_URL}/projects/example-project/submissions`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      }),
    );
  });

  it('maps a 401 to an unauthorized result', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, { error: 'Unauthorized' }));

    const result = await ganeshaApiClient.submitObservation('example-project', {
      imageUrl: 'https://example.com/x.jpg',
      elephantId: 'elephant-thomas',
    });

    expect(result).toEqual({ ok: false, code: 'unauthorized', message: 'HTTP 401', httpStatus: 401 });
  });

  it('maps a 500 to an http-error result', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(500, { error: 'Internal error' }));

    const result = await ganeshaApiClient.submitObservation('example-project', {
      imageUrl: 'https://example.com/x.jpg',
      elephantId: 'elephant-thomas',
    });

    expect(result).toEqual({ ok: false, code: 'http-error', message: 'HTTP 500', httpStatus: 500 });
  });
});

describe('ganeshaApiClient.getUserProfile', () => {
  it('returns the profile on success', async () => {
    const body = {
      id: 'user-1',
      userId: 'user-1',
      email: 'a@b.com',
      name: 'Alex',
      role: 'researcher',
      orgId: 'example-org',
      approved: true,
      badges: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(200, body));

    const result = await ganeshaApiClient.getUserProfile();

    expect(result).toEqual({ ok: true, data: body });
    expect(mockFetch).toHaveBeenCalledWith(
      `${GANESHA_API_BASE_URL}/users/profile`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('maps a 404 (no profile yet) to a not-found result', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(404, { error: 'Profile not found' }));

    const result = await ganeshaApiClient.getUserProfile();

    expect(result).toEqual({ ok: false, code: 'not-found', message: 'HTTP 404', httpStatus: 404 });
  });
});

describe('ganeshaApiClient.createUserProfile', () => {
  it('POSTs the profile payload and returns the created/updated profile', async () => {
    const body = {
      id: 'user-1',
      userId: 'user-1',
      email: 'a@b.com',
      name: 'Alex',
      role: 'citizen',
      orgId: 'example-org',
      approved: false,
      badges: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(200, body));

    const payload = { name: 'Alex', role: 'citizen' as const, orgId: 'example-org' };
    const result = await ganeshaApiClient.createUserProfile(payload);

    expect(result).toEqual({ ok: true, data: body });
    expect(mockFetch).toHaveBeenCalledWith(
      `${GANESHA_API_BASE_URL}/users/profile`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      }),
    );
  });
});
