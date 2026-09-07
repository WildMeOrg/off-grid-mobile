jest.mock('../../../../src/services/wildlifePipeline', () => ({
  wildlifePipeline: { processPhoto: jest.fn() },
}));

jest.mock('../../../../src/services/speciesConfigBuilder', () => ({
  buildActiveSpeciesConfigs: jest.fn(),
}));

jest.mock('../../../../src/services/goldenBatchEvaluator/packNameIndex', () => ({
  buildIndividualNameIndex: jest.fn(),
}));

import RNFS from 'react-native-fs';
import { wildlifePipeline } from '../../../../src/services/wildlifePipeline';
import { buildActiveSpeciesConfigs } from '../../../../src/services/speciesConfigBuilder';
import { buildIndividualNameIndex } from '../../../../src/services/goldenBatchEvaluator/packNameIndex';
import { runGoldenBatchIfRequested } from '../../../../src/services/goldenBatchEvaluator';
import {
  consumedRequestPath,
  requestPath,
} from '../../../../src/services/goldenBatchEvaluator/paths';
import { useWildlifeStore } from '../../../../src/stores/wildlifeStore';
import type { GoldenBatchRunRequest } from '../../../../src/services/goldenBatchEvaluator/types';
import type { PipelineResult } from '../../../../src/services/wildlifePipeline/types';
import type { MiewIDModelRecord } from '../../../../src/types';

const mockExists = RNFS.exists as jest.Mock;
const mockReadFile = RNFS.readFile as jest.Mock;
const mockWriteFile = RNFS.writeFile as jest.Mock;
const mockAppendFile = RNFS.appendFile as jest.Mock;
const mockMoveFile = RNFS.moveFile as jest.Mock;
const mockUnlink = RNFS.unlink as jest.Mock;
const mockMkdir = RNFS.mkdir as jest.Mock;
const mockProcessPhoto = wildlifePipeline.processPhoto as jest.Mock;
const mockBuildSpeciesConfigs = buildActiveSpeciesConfigs as jest.Mock;
const mockBuildIndividualNameIndex = buildIndividualNameIndex as jest.Mock;

const READY_MODEL: MiewIDModelRecord = {
  path: '/mock/miewid.onnx',
  name: 'miewid',
  version: '4.1.0',
  sha256: 'abc',
  sizeBytes: 1000,
  status: 'ready',
  verifiedAt: '2026-08-01T00:00:00.000Z',
  format: 'onnx',
};

function makeRequest(
  overrides: Partial<GoldenBatchRunRequest> = {},
): GoldenBatchRunRequest {
  return {
    formatVersion: '1',
    runId: 'run-2026-08-24-001',
    createdAt: '2026-08-24T12:00:00Z',
    items: [
      {
        stagedPath: 'Belle/IMG_001.jpg',
        expectedFolder: 'Belle',
        expectedName: 'IMG_001.jpg',
        expectedStableId: 'WB-BELLE',
        knownStatus: 'known',
        captureDateIso: '2026-03-01T10:00:00Z',
        cutoffIso: '2026-02-23T00:00:00Z',
      },
      {
        stagedPath: 'Taffy/IMG_900.jpg',
        expectedFolder: 'Taffy',
        expectedName: 'IMG_900.jpg',
        expectedStableId: null,
        knownStatus: 'unknown',
        captureDateIso: '2026-03-02T10:00:00Z',
        cutoffIso: '2026-02-23T00:00:00Z',
      },
    ],
    ...overrides,
  };
}

function makePipelineResult(
  overrides: Partial<PipelineResult> = {},
): PipelineResult {
  return {
    observationId: 'obs-1',
    photoUri: 'file:///mock/documents/batch/staged/Belle/IMG_001.jpg',
    detections: [],
    errors: [],
    totalInferenceTimeMs: 100,
    ...overrides,
  };
}

function makeDetection(overrides: Partial<PipelineResult['detections'][number]> = {}) {
  return {
    id: 'det-1',
    observationId: 'obs-1',
    boundingBox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    species: 'elephant',
    speciesConfidence: 0.95,
    croppedImageUri: '/mock/caches/crops/det-1.jpg',
    embedding: new Array(2152).fill(0.01),
    matchResult: {
      topCandidates: [
        { individualId: 'WB-BELLE', score: 0.9, source: 'pack' as const, refPhotoIndex: 0 },
      ],
      approvedIndividual: null,
      reviewStatus: 'pending' as const,
    },
    encounterFields: {
      locationId: null,
      sex: null,
      lifeStage: null,
      behavior: null,
      submitterId: null,
      projectId: null,
    },
    ganeshaSubmissionId: null,
    ...overrides,
  };
}

/** Wires up a stateful RNFS.exists/moveFile fake so "consuming" the request is observable across calls. */
function setUpFakeFilesystem(request: GoldenBatchRunRequest | null) {
  let requestFileExists = request !== null;
  mockExists.mockImplementation((path: string) => {
    if (path === requestPath()) {
      return Promise.resolve(requestFileExists);
    }
    // Staged inputs and any produced crop files "exist" by default; tests
    // that need to simulate a missing staged file override this mock.
    return Promise.resolve(true);
  });
  mockReadFile.mockImplementation((path: string) => {
    if (path === requestPath() && request) {
      return Promise.resolve(JSON.stringify(request));
    }
    return Promise.resolve('');
  });
  mockMoveFile.mockImplementation((from: string) => {
    if (from === requestPath()) {
      requestFileExists = false;
    }
    return Promise.resolve();
  });
}

describe('runGoldenBatchIfRequested', () => {
  const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    useWildlifeStore.setState({
      packs: [],
      localIndividuals: [],
      miewidModel: READY_MODEL,
    });
    mockBuildSpeciesConfigs.mockResolvedValue({
      speciesConfigs: [
        {
          packId: 'pack-1',
          species: 'elephant',
          detectorModelPath: '/mock/detector.onnx',
          detectorConfig: {} as never,
          embeddingDatabase: [
            {
              individualId: 'WB-BELLE',
              source: 'pack',
              embeddings: [new Array(2152).fill(0.01)],
              refPhotoIndex: 0,
            },
          ],
        },
      ],
      excludedPacks: [],
    });
    mockBuildIndividualNameIndex.mockResolvedValue(
      new Map([['WB-BELLE', 'Belle']]),
    );
  });

  afterAll(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
  });

  it('does nothing when no request file exists', async () => {
    setUpFakeFilesystem(null);
    await runGoldenBatchIfRequested();
    expect(mockReadFile).not.toHaveBeenCalledWith(requestPath(), 'utf8');
    expect(mockProcessPhoto).not.toHaveBeenCalled();
  });

  it('never touches the filesystem in a release build', async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    setUpFakeFilesystem(makeRequest());
    await runGoldenBatchIfRequested();
    expect(mockExists).not.toHaveBeenCalled();
    expect(mockProcessPhoto).not.toHaveBeenCalled();
  });

  it('quarantines an unparseable request file instead of running', async () => {
    setUpFakeFilesystem(null);
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(path === requestPath()),
    );
    mockReadFile.mockResolvedValue('not valid json {{{');

    await runGoldenBatchIfRequested();

    expect(mockMoveFile).toHaveBeenCalledTimes(1);
    const [from, to] = mockMoveFile.mock.calls[0];
    expect(from).toBe(requestPath());
    expect(to).toContain('.rejected-');
    expect(mockProcessPhoto).not.toHaveBeenCalled();
  });

  it('quarantines a structurally invalid manifest instead of running', async () => {
    setUpFakeFilesystem(null);
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(path === requestPath()),
    );
    mockReadFile.mockResolvedValue(
      JSON.stringify({ formatVersion: '1', runId: 'bad-run', items: [] }),
    );

    await runGoldenBatchIfRequested();

    expect(mockMoveFile).toHaveBeenCalledTimes(1);
    expect(mockMoveFile.mock.calls[0][1]).toContain('.rejected-');
    expect(mockProcessPhoto).not.toHaveBeenCalled();
  });

  it('fails the run without processing any item when the MiewID model is not ready', async () => {
    useWildlifeStore.setState({ miewidModel: { ...READY_MODEL, status: 'missing' } });
    setUpFakeFilesystem(makeRequest());

    await runGoldenBatchIfRequested();

    expect(mockProcessPhoto).not.toHaveBeenCalled();
    const statusWrites = mockWriteFile.mock.calls.filter(([path]) =>
      path.endsWith('/status.json'),
    );
    expect(statusWrites.length).toBeGreaterThan(0);
    const lastStatus = JSON.parse(statusWrites[statusWrites.length - 1][1]);
    expect(lastStatus.state).toBe('failed');
    expect(lastStatus.lastError).toContain('MiewID model is not ready');
  });

  it('consumes the request atomically before processing (one-shot)', async () => {
    const request = makeRequest();
    setUpFakeFilesystem(request);
    mockProcessPhoto.mockResolvedValue(makePipelineResult());

    await runGoldenBatchIfRequested();

    expect(mockMoveFile).toHaveBeenCalledWith(
      requestPath(),
      consumedRequestPath(request.runId),
    );
    // Consuming happens before any item is processed.
    const moveIndex = mockMoveFile.mock.invocationCallOrder[0];
    const firstProcessIndex = mockProcessPhoto.mock.invocationCallOrder[0];
    expect(moveIndex).toBeLessThan(firstProcessIndex);
  });

  it('does not re-run after the request file has been consumed (restart safety)', async () => {
    const request = makeRequest({ items: [makeRequest().items[0]] });
    setUpFakeFilesystem(request);
    mockProcessPhoto.mockResolvedValue(makePipelineResult());

    await runGoldenBatchIfRequested();
    expect(mockProcessPhoto).toHaveBeenCalledTimes(1);

    // Simulate an app restart: call the entry point again. The request file
    // was already renamed away by the first run, so this must be a no-op.
    await runGoldenBatchIfRequested();
    expect(mockProcessPhoto).toHaveBeenCalledTimes(1);
  });

  it('processes items sequentially, scores known/unknown detections, writes full-embedding JSONL + compact CSV, cleans up crops, and never touches observations or the sync queue', async () => {
    const request = makeRequest();
    setUpFakeFilesystem(request);

    const addObservationSpy = jest.spyOn(
      useWildlifeStore.getState(),
      'addObservation',
    );
    const addToSyncQueueSpy = jest.spyOn(
      useWildlifeStore.getState(),
      'addToSyncQueue',
    );

    mockProcessPhoto
      .mockResolvedValueOnce(
        makePipelineResult({
          detections: [
            makeDetection({
              croppedImageUri: '/mock/caches/crops/belle.jpg',
              matchResult: {
                topCandidates: [
                  { individualId: 'WB-BELLE', score: 0.92, source: 'pack', refPhotoIndex: 0 },
                ],
                approvedIndividual: null,
                reviewStatus: 'pending',
              },
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        makePipelineResult({
          detections: [
            makeDetection({
              croppedImageUri: '/mock/caches/crops/taffy.jpg',
              matchResult: {
                topCandidates: [
                  { individualId: 'WB-BELLE', score: 0.1, source: 'pack', refPhotoIndex: 0 },
                ],
                approvedIndividual: null,
                reviewStatus: 'pending',
              },
            }),
          ],
        }),
      );

    await runGoldenBatchIfRequested();

    // Sequential: second photo only processed after the first resolved.
    expect(mockProcessPhoto).toHaveBeenCalledTimes(2);
    expect(mockProcessPhoto.mock.calls[0][0].photoUri).toContain('Belle/IMG_001.jpg');
    expect(mockProcessPhoto.mock.calls[1][0].photoUri).toContain('Taffy/IMG_900.jpg');

    // Full embeddings only ever land in the JSONL file, never in the CSV.
    const jsonlWrites = mockAppendFile.mock.calls.filter(([path]) =>
      path.endsWith('/detections.jsonl'),
    );
    const detectionLines = jsonlWrites
      .map(([, contents]) => JSON.parse((contents as string).trim()))
      .filter((line) => line.recordType === 'detection');
    expect(detectionLines).toHaveLength(2);
    expect(detectionLines[0].embedding).toHaveLength(2152);
    expect(detectionLines[0].candidates[0].individualName).toBe('Belle');
    expect(detectionLines[0].predictedStableId).toBe('WB-BELLE'); // known, correct
    expect(detectionLines[1].predictedStableId).toBeNull(); // unknown, correctly rejected (below threshold)

    const csvWrites = mockAppendFile.mock.calls.filter(([path]) =>
      path.endsWith('/summary.csv'),
    );
    expect(csvWrites.some(([, contents]) => (contents as string).includes('embedding'))).toBe(
      false,
    );

    // Crops are cleaned up after serialization.
    expect(mockUnlink).toHaveBeenCalledWith('/mock/caches/crops/belle.jpg');
    expect(mockUnlink).toHaveBeenCalledWith('/mock/caches/crops/taffy.jpg');

    // Run metadata + a final "completed" status were written.
    const metadataWrites = mockWriteFile.mock.calls.filter(([path]) =>
      path.endsWith('/run-metadata.json'),
    );
    expect(metadataWrites).toHaveLength(1);
    const metadata = JSON.parse(metadataWrites[0][1]);
    expect(metadata.summary.knownCorrect).toBe(1);
    expect(metadata.summary.knownTop1).toBe(1);
    expect(metadata.summary.knownTop5).toBe(1);
    expect(metadata.summary.unknownCorrectlyRejected).toBe(1);
    expect(metadata.manifestSha256).toBe('mockhash');
    expect(metadata.model.version).toBe('4.1.0');
    expect(metadata.app.bundleId).toBe('org.ganesha.elebook.dev');
    expect(mockBuildSpeciesConfigs).toHaveBeenCalledWith(
      expect.any(Array),
      READY_MODEL,
      [],
    );

    const statusWrites = mockWriteFile.mock.calls.filter(([path]) =>
      path.endsWith('/status.json'),
    );
    const finalStatus = JSON.parse(statusWrites[statusWrites.length - 1][1]);
    expect(finalStatus.state).toBe('completed');
    expect(finalStatus.processedItems).toBe(2);

    // Never touches production observation/sync state.
    expect(addObservationSpy).not.toHaveBeenCalled();
    expect(addToSyncQueueSpy).not.toHaveBeenCalled();
    expect(useWildlifeStore.getState().observations).toHaveLength(0);
    expect(useWildlifeStore.getState().syncQueue).toHaveLength(0);
  });

  it('enforces the 2152-dim embedding contract: rejects a malformed embedding instead of writing it', async () => {
    const request = makeRequest({ items: [makeRequest().items[0]] });
    setUpFakeFilesystem(request);
    mockProcessPhoto.mockResolvedValueOnce(
      makePipelineResult({
        detections: [
          makeDetection({
            croppedImageUri: '/mock/caches/crops/bad.jpg',
            embedding: new Array(512).fill(0.01),
          }),
        ],
      }),
    );

    await runGoldenBatchIfRequested();

    const jsonlWrites = mockAppendFile.mock.calls.filter(([path]) =>
      path.endsWith('/detections.jsonl'),
    );
    const lines = jsonlWrites.map(([, contents]) => JSON.parse((contents as string).trim()));
    expect(lines.some((line) => line.recordType === 'detection')).toBe(false);

    const itemLine = lines.find((line) => line.recordType === 'item');
    expect(itemLine.errors[0].stage).toBe('embedding-validation');
    expect(itemLine.errors[0].message).toContain('2152');

    // The malformed detection's crop is still cleaned up.
    expect(mockUnlink).toHaveBeenCalledWith('/mock/caches/crops/bad.jpg');
  });

  it('fails before inference when a known stable ID is absent from the active pack database', async () => {
    const request = makeRequest({ items: [makeRequest().items[0]] });
    setUpFakeFilesystem(request);
    mockBuildSpeciesConfigs.mockResolvedValueOnce({
      speciesConfigs: [
        {
          packId: 'pack-1',
          species: 'elephant',
          detectorModelPath: '/mock/detector.onnx',
          detectorConfig: {} as never,
          embeddingDatabase: [],
        },
      ],
      excludedPacks: [],
    });

    await runGoldenBatchIfRequested();

    expect(mockProcessPhoto).not.toHaveBeenCalled();
    const statusWrites = mockWriteFile.mock.calls.filter(([path]) =>
      path.endsWith('/status.json'),
    );
    const finalStatus = JSON.parse(statusWrites[statusWrites.length - 1][1]);
    expect(finalStatus.state).toBe('failed');
    expect(finalStatus.lastError).toContain('WB-BELLE');
  });

  it('records a missing staged file as an item error without crashing the run', async () => {
    const request = makeRequest({ items: [makeRequest().items[0]] });
    setUpFakeFilesystem(request);
    mockExists.mockImplementation((path: string) => {
      if (path === requestPath()) return Promise.resolve(true);
      // Staged file is missing.
      return Promise.resolve(false);
    });

    await runGoldenBatchIfRequested();

    expect(mockProcessPhoto).not.toHaveBeenCalled();
    const jsonlWrites = mockAppendFile.mock.calls.filter(([path]) =>
      path.endsWith('/detections.jsonl'),
    );
    const itemLine = JSON.parse((jsonlWrites[0][1] as string).trim());
    expect(itemLine.errors[0].stage).toBe('staging');

    const statusWrites = mockWriteFile.mock.calls.filter(([path]) =>
      path.endsWith('/status.json'),
    );
    const finalStatus = JSON.parse(statusWrites[statusWrites.length - 1][1]);
    expect(finalStatus.state).toBe('completed');
    expect(finalStatus.errorItems).toBe(1);
  });

  it('creates the results directory for the run', async () => {
    setUpFakeFilesystem(makeRequest());
    mockProcessPhoto.mockResolvedValue(makePipelineResult());
    await runGoldenBatchIfRequested();
    expect(mockMkdir).toHaveBeenCalled();
  });
});
