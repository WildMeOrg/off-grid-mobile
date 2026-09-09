import {
  acquireLatestPack,
  checkLatestPackStatus,
} from '../../../src/services/packDownloadService';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { useWildlifeStore } from '../../../src/stores/wildlifeStore';
import type {
  EmbeddingPack,
  EmbeddingPackManifest,
  MiewIDModelRecord,
  PackIndividual,
} from '../../../src/types';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/documents',
  exists: jest.fn(),
  mkdir: jest.fn(() => Promise.resolve()),
  unlink: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn(),
}));

jest.mock('../../../src/services/ganeshaApiClient', () => ({
  ganeshaApiClient: { getLatestPack: jest.fn() },
}));

jest.mock('../../../src/services/fileDownloadService', () => ({
  downloadFileWithIntegrityCheck: jest.fn(),
}));

jest.mock('../../../src/services/packManager', () => ({
  packManager: {
    initialize: jest.fn(() => Promise.resolve()),
    installPack: jest.fn(),
    getPacksDir: jest.fn(() => '/mock/documents/embedding_packs'),
  },
}));

jest.mock('../../../src/services/packManager/validator', () => ({
  resolvePackFile: jest.fn(),
}));

import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { ganeshaApiClient } from '../../../src/services/ganeshaApiClient';
import { downloadFileWithIntegrityCheck } from '../../../src/services/fileDownloadService';
import { packManager } from '../../../src/services/packManager';
import { resolvePackFile } from '../../../src/services/packManager/validator';

const mockExists = RNFS.exists as jest.Mock;
const mockMkdir = RNFS.mkdir as jest.Mock;
const mockUnlink = RNFS.unlink as jest.Mock;
const mockUnzip = unzip as jest.Mock;
const mockGetLatestPack = ganeshaApiClient.getLatestPack as jest.Mock;
const mockDownload = downloadFileWithIntegrityCheck as jest.Mock;
const mockInstallPack = packManager.installPack as jest.Mock;
const mockResolvePackFile = resolvePackFile as jest.Mock;
const mockStorageSetItem = AsyncStorage.setItem as jest.Mock;

const PROJECT_ID = 'example-project';
const PACK_SHA =
  'ebed1d341b58034de6108a5b138373aa64a7e8458bc43e43909ad0850bf660ba';
const OTHER_PACK_SHA =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
// Mirrors candidate.ts: each pack directory level is a 16-hex-digit SHA-256 prefix of the
// UTF-16 hex encoding of the identity (plus the artifact hash for releases).
const utf16Hex = (value: string): string =>
  Array.from(value, (char) => char.charCodeAt(0).toString(16).padStart(4, '0')).join('');
const pathDigest = (...parts: string[]): string =>
  bytesToHex(sha256(utf8ToBytes(parts.join('\n')))).slice(0, 16);
const PROJECT_PATH = `p-${pathDigest(utf16Hex(PROJECT_ID))}`;
const RELEASE_PATH = `v-${pathDigest(utf16Hex('2026-08-22T12:38:40Z'), PACK_SHA)}`;
const EXTRACT_DIR =
  `/mock/documents/embedding_packs/${PROJECT_PATH}/${RELEASE_PATH}`;
const OLD_EXTRACT_DIR =
  '/mock/documents/embedding_packs/example-project-2026-08-01T00_00_00Z';
const ZIP_FINAL_PATH = expect.stringContaining(
  `/mock/documents/pack_downloads/${PROJECT_PATH}/`,
);
const makePackInfo = (overrides: Partial<Record<string, unknown>> = {}) => ({
  projectId: PROJECT_ID,
  displayName: 'Example Population',
  version: '2026-08-22T12:38:40Z',
  sha256: PACK_SHA,
  sizeBytes: 20_684_583,
  individualCount: 3,
  embeddingCount: 141,
  downloadUrl:
    'https://blobs.example.invalid/wildlife-packs/example-project/example-pack.zip?sig=x',
  ...overrides,
});

const makeManifest = (
  overrides: Partial<EmbeddingPackManifest> = {},
): EmbeddingPackManifest => ({
  formatVersion: '1.0',
  species: 'Loxodonta africana',
  featureClass: 'elephant+ear',
  displayName: 'Example Population',
  wildbookInstanceUrl: 'https://wildbook.example.invalid',
  exportDate: '2026-08-22T12:38:40Z',
  individualCount: 3,
  embeddingCount: 141,
  embeddingDim: 2152,
  embeddingModel: {
    name: 'miewid',
    version: '4.1.0',
    inputSize: [440, 440],
    normalize: { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
  },
  detectorModel: {
    filename: 'elephant-yolo11n.onnx',
    configFile: 'config/detector.json',
  },
  ...overrides,
});

const makeIndividuals = (): PackIndividual[] => [];

const makeReadyModel = (
  overrides: Partial<MiewIDModelRecord> = {},
): MiewIDModelRecord => ({
  path: '/mock/documents/models/miewid-4.1.0.onnx',
  name: 'miewid',
  version: '4.1.0',
  sha256: 'abc123',
  sizeBytes: 204_011_297,
  status: 'ready',
  verifiedAt: '2026-08-01T00:00:00.000Z',
  format: 'onnx',
  ...overrides,
});

const makeInstalledPack = (
  overrides: Partial<EmbeddingPack> = {},
): EmbeddingPack => ({
  id: PROJECT_ID,
  packVersion: '2026-08-01T00:00:00Z',
  artifactSha256: 'c'.repeat(64),
  species: 'Loxodonta africana',
  featureClass: 'elephant+ear',
  displayName: 'Example Population',
  wildbookInstanceUrl: 'https://wildbook.example.invalid',
  exportDate: '2026-08-01T00:00:00Z',
  individualCount: 60,
  embeddingDim: 2152,
  embeddingModelVersion: '4.1.0',
  detectorModelFile: `${OLD_EXTRACT_DIR}/models/elephant-yolo11n.onnx`,
  embeddingsFile: `${OLD_EXTRACT_DIR}/embeddings/embeddings.bin`,
  indexFile: `${OLD_EXTRACT_DIR}/embeddings/index.json`,
  referencePhotosDir: `${OLD_EXTRACT_DIR}/reference_photos`,
  packDir: OLD_EXTRACT_DIR,
  downloadedAt: '2026-08-01T00:00:00Z',
  sizeBytes: 20_000_000,
  status: 'ready',
  validatedAt: '2026-08-01T00:00:00Z',
  ...overrides,
});

describe('acquireLatestPack', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useWildlifeStore.getState().reset();
    useWildlifeStore.setState({ miewidModel: makeReadyModel() });
    // Files "exist" by default (staging/extract-dir cleanup calls unlink
    // only when RNFS.exists is true) — the one test exercising "nothing to
    // clean up yet" overrides this per-path.
    mockExists.mockResolvedValue(true);
    mockUnlink.mockResolvedValue(undefined);
    mockDownload.mockResolvedValue({
      ok: true,
      path: '/mock/documents/pack_downloads/example-project-2026-08-22T12_38_40Z.zip',
      sha256:
        'ebed1d341b58034de6108a5b138373aa64a7e8458bc43e43909ad0850bf660ba',
      sizeBytes: 20_684_583,
    });
    mockUnzip.mockResolvedValue(EXTRACT_DIR);
    mockInstallPack.mockResolvedValue({
      ok: true,
      manifest: makeManifest(),
      individuals: makeIndividuals(),
    });
    mockResolvePackFile.mockImplementation((packDir: string, name: string) =>
      Promise.resolve(`${packDir}/resolved/${name}`),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps pack directory names short even for maximal project and version identities', async () => {
    // Native code opens pack files by absolute path; a 290-byte detector path failed on
    // BlueStacks' ARM translation layer while Java saw the file. Identities may be 40 code
    // units each, so the two pack directory levels must stay compact regardless.
    const projectId = 'p'.repeat(40);
    const version = 'v'.repeat(40);
    mockGetLatestPack.mockResolvedValue({
      ok: true,
      data: makePackInfo({ projectId, version }),
    });

    const result = await acquireLatestPack(projectId);

    expect(result.ok).toBe(true);
    const [, extractDir] = mockUnzip.mock.calls[0] as [string, string];
    const segments = extractDir
      .replace('/mock/documents/embedding_packs/', '')
      .split('/');
    expect(segments).toHaveLength(2);
    for (const segment of segments) {
      expect(segment.length).toBeLessThanOrEqual(34);
    }
  });

  it('resolves, downloads, unzips, validates, installs, and registers the pack', async () => {
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });

    const result = await acquireLatestPack(PROJECT_ID);

    expect(mockGetLatestPack).toHaveBeenCalledWith(PROJECT_ID);
    expect(mockDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          url: makePackInfo().downloadUrl,
          expectedSha256: makePackInfo().sha256,
          expectedSizeBytes: makePackInfo().sizeBytes,
        }),
        stagingPath: expect.any(String),
        finalPath: ZIP_FINAL_PATH,
      }),
      {},
    );
    expect(mockUnzip).toHaveBeenCalledWith(
      '/mock/documents/pack_downloads/example-project-2026-08-22T12_38_40Z.zip',
      EXTRACT_DIR,
    );
    expect(mockInstallPack).toHaveBeenCalledWith(EXTRACT_DIR);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected ok result');
    }
    expect(result.pack).toMatchObject({
      id: PROJECT_ID,
      packVersion: '2026-08-22T12:38:40Z',
      species: 'Loxodonta africana',
      featureClass: 'elephant+ear',
      displayName: 'Example Population',
      individualCount: 3,
      embeddingDim: 2152,
      embeddingModelVersion: '4.1.0',
      packDir: EXTRACT_DIR,
      sizeBytes: 20_684_583,
      status: 'ready',
    });
    expect(result.pack.embeddingsFile).toBe(
      `${EXTRACT_DIR}/resolved/embeddings.bin`,
    );
    expect(result.pack.indexFile).toBe(`${EXTRACT_DIR}/resolved/index.json`);
    expect(result.pack.detectorModelFile).toBe(
      `${EXTRACT_DIR}/resolved/elephant-yolo11n.onnx`,
    );
    expect(result.pack.referencePhotosDir).toBe(
      `${EXTRACT_DIR}/reference_photos`,
    );

    expect(useWildlifeStore.getState().packs).toHaveLength(1);
    expect(useWildlifeStore.getState().packs[0].id).toBe(PROJECT_ID);

    // The downloaded zip is cleaned up once its contents are extracted.
    expect(mockUnlink).toHaveBeenCalledWith(
      '/mock/documents/pack_downloads/example-project-2026-08-22T12_38_40Z.zip',
    );
  });

  it('activates a validated update and retains the previous directory for rollback', async () => {
    useWildlifeStore.setState({ packs: [makeInstalledPack()] });
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result.ok).toBe(true);
    expect(useWildlifeStore.getState().packs).toHaveLength(1);
    expect(useWildlifeStore.getState().packs[0]).toMatchObject({
      packVersion: '2026-08-22T12:38:40Z',
      packDir: EXTRACT_DIR,
    });
    expect(mockUnlink).not.toHaveBeenCalledWith(OLD_EXTRACT_DIR);
  });

  it.each(['elephant-yolo11n.onnx', 'embeddings.bin', 'index.json'])('does not activate when checked resolution rejects %s', async rejectedName => {
    const installed = makeInstalledPack();
    useWildlifeStore.setState({ packs: [installed] });
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });
    mockResolvePackFile.mockImplementation(async (packDir: string, name: string) => (
      name === rejectedName ? null : `${packDir}/resolved/${name}`
    ));

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result.ok).toBe(false);
    expect(useWildlifeStore.getState().packs).toEqual([installed]);
    expect(mockUnlink).not.toHaveBeenCalledWith(OLD_EXTRACT_DIR);
  });

  it('returns the installed ready pack when the latest version is unchanged', async () => {
    const installed = makeInstalledPack({
      packVersion: '2026-08-22T12:38:40Z',
      artifactSha256: PACK_SHA,
      packDir: EXTRACT_DIR,
    });
    useWildlifeStore.setState({ packs: [installed] });
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result).toEqual({ ok: true, pack: installed });
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockUnzip).not.toHaveBeenCalled();
    expect(mockInstallPack).not.toHaveBeenCalled();
  });

  it('redownloads when the version is unchanged but the archive hash changed', async () => {
    const installed = makeInstalledPack({
      packVersion: '2026-08-22T12:38:40Z',
      artifactSha256: PACK_SHA,
      packDir: EXTRACT_DIR,
    });
    useWildlifeStore.setState({ packs: [installed] });
    mockGetLatestPack.mockResolvedValue({
      ok: true,
      data: makePackInfo({ sha256: OTHER_PACK_SHA }),
    });

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result.ok).toBe(true);
    expect(mockDownload).toHaveBeenCalled();
    expect(useWildlifeStore.getState().packs[0].artifactSha256).toBe(
      OTHER_PACK_SHA,
    );
  });

  it('repairs the same quarantined release in a separate directory before activation', async () => {
    const quarantined = makeInstalledPack({
      packVersion: makePackInfo().version,
      artifactSha256: PACK_SHA,
      packDir: EXTRACT_DIR,
      status: 'quarantined',
    });
    useWildlifeStore.setState({ packs: [quarantined] });
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });
    mockInstallPack.mockImplementation(async (path: string) => {
      expect(path).not.toBe(EXTRACT_DIR);
      expect(useWildlifeStore.getState().packs).toEqual([quarantined]);
      expect(mockUnlink).not.toHaveBeenCalledWith(EXTRACT_DIR);
      return { ok: true, manifest: makeManifest(), individuals: makeIndividuals() };
    });

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result.ok).toBe(true);
    expect(useWildlifeStore.getState().packs[0]).toMatchObject({
      packVersion: quarantined.packVersion,
      artifactSha256: PACK_SHA,
      packDir: `${EXTRACT_DIR}-repair-1`,
      status: 'ready',
    });
    expect(mockUnlink).not.toHaveBeenCalledWith(EXTRACT_DIR);
  });

  it.each(['validation', 'activation'])('keeps a quarantined release intact when repair %s fails', async stage => {
    const quarantined = makeInstalledPack({
      packVersion: makePackInfo().version,
      artifactSha256: PACK_SHA,
      packDir: EXTRACT_DIR,
      status: 'quarantined',
    });
    useWildlifeStore.setState({ packs: [quarantined] });
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });
    if (stage === 'validation') {
      mockInstallPack.mockResolvedValue({ ok: false, errors: [{ code: 'checksum-mismatch', detail: 'embeddings.bin' }] });
    } else {
      mockStorageSetItem.mockRejectedValueOnce(new Error('storage full'));
    }

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result).toMatchObject({ ok: false, code: `${stage}-failed` });
    expect(useWildlifeStore.getState().packs).toEqual([quarantined]);
    expect(mockUnlink).not.toHaveBeenCalledWith(EXTRACT_DIR);
    expect(mockUnlink).toHaveBeenCalledWith(`${EXTRACT_DIR}-repair-1`);
  });

  it('normalizes pack SHA metadata for verification and installed identity', async () => {
    mockGetLatestPack.mockResolvedValue({
      ok: true,
      data: makePackInfo({ sha256: ` ${PACK_SHA.toUpperCase()} ` }),
    });

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result.ok).toBe(true);
    expect(mockDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ expectedSha256: PACK_SHA }),
      }),
      {},
    );
    expect(useWildlifeStore.getState().packs[0].artifactSha256).toBe(PACK_SHA);
  });

  it('clears a stale extract directory before unzipping', async () => {
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(path === EXTRACT_DIR),
    );

    await acquireLatestPack(PROJECT_ID);

    const unlinkOrder = mockUnlink.mock.invocationCallOrder.find(
      (_, i) => mockUnlink.mock.calls[i][0] === EXTRACT_DIR,
    );
    const unzipOrder = mockUnzip.mock.invocationCallOrder[0];
    expect(unlinkOrder).toBeLessThan(unzipOrder);
  });

  it('passes through a not-found error from the backend without downloading', async () => {
    mockGetLatestPack.mockResolvedValue({
      ok: false,
      code: 'not-found',
      message: 'HTTP 404',
      httpStatus: 404,
    });

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result).toEqual({
      ok: false,
      code: 'not-found',
      message: 'HTTP 404',
      httpStatus: 404,
    });
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('passes through a download failure without unzipping', async () => {
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });
    mockDownload.mockResolvedValue({
      ok: false,
      code: 'checksum-mismatch',
      message: 'bad hash',
    });

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result).toEqual({
      ok: false,
      code: 'checksum-mismatch',
      message: 'bad hash',
    });
    expect(mockUnzip).not.toHaveBeenCalled();
    expect(useWildlifeStore.getState().packs).toHaveLength(0);
  });

  it('returns unzip-failed and cleans up the zip when extraction throws', async () => {
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });
    mockUnzip.mockRejectedValue(new Error('corrupt zip'));

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result).toEqual({
      ok: false,
      code: 'unzip-failed',
      message: 'corrupt zip',
    });
    expect(mockInstallPack).not.toHaveBeenCalled();
    expect(useWildlifeStore.getState().packs).toHaveLength(0);
  });

  it('returns validation-failed and quarantine-cleans the extracted dir on invalid pack contents', async () => {
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });
    mockInstallPack.mockResolvedValue({
      ok: false,
      errors: [{ code: 'file-missing', detail: 'embeddings.bin' }],
    });

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result).toEqual({
      ok: false,
      code: 'validation-failed',
      message: 'file-missing: embeddings.bin',
    });
    expect(useWildlifeStore.getState().packs).toHaveLength(0);
  });

  it('keeps the installed pack active when replacement validation fails', async () => {
    const installed = makeInstalledPack();
    useWildlifeStore.setState({ packs: [installed] });
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });
    mockInstallPack.mockResolvedValue({
      ok: false,
      errors: [{ code: 'checksum-mismatch', detail: 'embeddings.bin' }],
    });

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result).toEqual({
      ok: false,
      code: 'validation-failed',
      message: 'checksum-mismatch: embeddings.bin',
    });
    expect(useWildlifeStore.getState().packs).toEqual([installed]);
    expect(mockUnlink).not.toHaveBeenCalledWith(OLD_EXTRACT_DIR);
    expect(mockUnlink).toHaveBeenCalledWith(EXTRACT_DIR);
  });

  it('rejects a pack incompatible with the candidate model and preserves active artifacts', async () => {
    const installed = makeInstalledPack();
    const activeModel = makeReadyModel();
    const incompatibleCandidate = makeReadyModel({ version: '4.2.0' });
    useWildlifeStore.setState({ packs: [installed], miewidModel: activeModel });
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });

    const result = await acquireLatestPack(
      PROJECT_ID,
      {},
      incompatibleCandidate,
    );

    expect(result).toMatchObject({ ok: false, code: 'model-incompatible' });
    expect(useWildlifeStore.getState().packs).toEqual([installed]);
    expect(useWildlifeStore.getState().miewidModel).toEqual(activeModel);
    expect(mockUnlink).toHaveBeenCalledWith(EXTRACT_DIR);
  });

  it('uses distinct directories for look-alike release labels and for different artifacts of one label', async () => {
    mockGetLatestPack
      .mockResolvedValueOnce({
        ok: true,
        data: makePackInfo({ version: 'release/a', sha256: PACK_SHA }),
      })
      .mockResolvedValueOnce({
        ok: true,
        data: makePackInfo({ version: 'release:a', sha256: PACK_SHA }),
      })
      .mockResolvedValueOnce({
        ok: true,
        data: makePackInfo({ version: 'release/a', sha256: OTHER_PACK_SHA }),
      });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      // Start each acquisition with no registered pack so every directory is the
      // unsuffixed base name rather than a `-repair-N` fallback.
      useWildlifeStore.setState({ packs: [] });
      await acquireLatestPack(PROJECT_ID);
    }

    const extractPaths = mockUnzip.mock.calls.map((call) => call[1] as string);
    expect(extractPaths).toHaveLength(3);
    expect(new Set(extractPaths).size).toBe(3);
    expect(extractPaths.some((path) => path.includes('-repair-'))).toBe(false);
  });

  it('derives stable, documented directory names for a given project, version, and artifact', async () => {
    // Pinned on purpose: changing the derivation would strand packs downloaded by earlier builds.
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });

    await acquireLatestPack(PROJECT_ID);

    expect(mockUnzip.mock.calls[0][1]).toBe(
      '/mock/documents/embedding_packs/p-04f33288d529779a/v-07b3b6af53a80300',
    );
  });

  it('aborts when a stale candidate directory cannot be removed', async () => {
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });
    mockUnlink.mockImplementation((path: string) =>
      path === EXTRACT_DIR
        ? Promise.reject(new Error('directory locked'))
        : Promise.resolve(),
    );

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result).toMatchObject({ ok: false, code: 'filesystem-error' });
    expect(mockUnzip).not.toHaveBeenCalled();
    expect(mockInstallPack).not.toHaveBeenCalled();
  });

  it('returns a structured failure when an unexpected dependency throws', async () => {
    mockGetLatestPack.mockRejectedValue(new Error('unexpected API failure'));

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result).toEqual({
      ok: false,
      code: 'unexpected-error',
      message: 'unexpected API failure',
    });
  });

  it('removes the extracted candidate when validation throws', async () => {
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });
    mockInstallPack.mockRejectedValue(new Error('validator crashed'));

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result).toEqual({
      ok: false,
      code: 'unexpected-error',
      message: 'validator crashed',
    });
    expect(mockUnlink).toHaveBeenCalledWith(EXTRACT_DIR);
  });

  it('removes the candidate when pack-record construction throws', async () => {
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });
    mockResolvePackFile.mockRejectedValue(new Error('path resolution failed'));

    const result = await acquireLatestPack(PROJECT_ID);

    expect(result).toEqual({
      ok: false,
      code: 'unexpected-error',
      message: 'path resolution failed',
    });
    expect(mockUnlink).toHaveBeenCalledWith(EXTRACT_DIR);
  });

  it('restores active artifacts when durable activation fails', async () => {
    const installed = makeInstalledPack();
    const activeModel = makeReadyModel();
    const candidateModel = makeReadyModel({
      path: '/mock/documents/models/miewid-4.1.0-replacement.onnx',
      sha256: 'replacement-hash',
    });
    await Promise.resolve(
      useWildlifeStore.setState({
        packs: [installed],
        miewidModel: activeModel,
      }),
    );
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });
    mockStorageSetItem.mockImplementationOnce(() =>
      Promise.reject(new Error('storage full')),
    );

    const result = await acquireLatestPack(PROJECT_ID, {}, candidateModel);

    expect(result).toMatchObject({ ok: false, code: 'activation-failed' });
    expect(useWildlifeStore.getState().packs).toEqual([installed]);
    expect(useWildlifeStore.getState().miewidModel).toEqual(activeModel);
    const persisted = JSON.parse(
      (await AsyncStorage.getItem('wildlife-store')) ?? '{}',
    );
    expect(persisted.state.packs).toEqual([installed]);
    expect(persisted.state.miewidModel).toEqual(activeModel);
  });

  it('forwards download options (progress/signal) to the file download engine', async () => {
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });
    const onProgress = jest.fn();

    await acquireLatestPack(PROJECT_ID, { onProgress, maxAttempts: 5 });

    expect(mockDownload).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ onProgress, maxAttempts: 5 }),
    );
  });

  it('creates the pack downloads directory before downloading', async () => {
    mockGetLatestPack.mockResolvedValue({ ok: true, data: makePackInfo() });

    await acquireLatestPack(PROJECT_ID);

    expect(mockMkdir).toHaveBeenCalledWith('/mock/documents/pack_downloads');
  });
});

describe('checkLatestPackStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('compares both version and normalized archive SHA without downloading', async () => {
    const installed = makeInstalledPack({
      packVersion: '2026-08-22T12:38:40Z',
      artifactSha256: PACK_SHA,
      status: 'ready',
    });
    mockGetLatestPack.mockResolvedValue({
      ok: true,
      data: makePackInfo({ sha256: PACK_SHA.toUpperCase() }),
    });

    await expect(checkLatestPackStatus(PROJECT_ID, installed)).resolves.toEqual({
      ok: true,
      isLatest: true,
      latestVersion: '2026-08-22T12:38:40Z',
    });
    expect(mockDownload).not.toHaveBeenCalled();
  });
});
