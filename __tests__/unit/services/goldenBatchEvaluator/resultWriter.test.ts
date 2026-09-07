import RNFS from 'react-native-fs';
import { GoldenBatchResultWriter } from '../../../../src/services/goldenBatchEvaluator/resultWriter';
import {
  detectionsJsonlPath,
  runResultsDir,
  summaryCsvPath,
} from '../../../../src/services/goldenBatchEvaluator/paths';
import type { GoldenBatchDetectionRecord } from '../../../../src/services/goldenBatchEvaluator/types';

function makeDetectionRecord(
  overrides: Partial<GoldenBatchDetectionRecord> = {},
): GoldenBatchDetectionRecord {
  return {
    runId: 'run-1',
    itemIndex: 0,
    stagedPath: 'Belle/IMG_001.jpg',
    expectedFolder: 'Belle',
    expectedName: 'IMG_001.jpg',
    expectedStableId: 'WB-ELE-001',
    knownStatus: 'known',
    detectionIndex: 0,
    boundingBox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    detectorConfidence: 0.95,
    embedding: [0.1, 0.2, 0.3],
    embeddingDim: 3,
    candidates: [
      { stableId: 'WB-ELE-001', score: 0.9, source: 'pack', individualName: 'Belle' },
    ],
    predictedStableId: 'WB-ELE-001',
    predictedScore: 0.9,
    totalInferenceTimeMs: 120,
    ...overrides,
  };
}

describe('GoldenBatchResultWriter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates the run results directory on init', async () => {
    const writer = new GoldenBatchResultWriter('run-1');
    await writer.init();
    expect(RNFS.mkdir).toHaveBeenCalledWith(runResultsDir('run-1'));
  });

  it('overwrites status.json on every call (not append)', async () => {
    const writer = new GoldenBatchResultWriter('run-1');
    await writer.writeStatus({
      runId: 'run-1',
      state: 'running',
      startedAt: '2026-08-24T00:00:00Z',
      updatedAt: '2026-08-24T00:00:00Z',
      completedAt: null,
      totalItems: 2,
      processedItems: 0,
      errorItems: 0,
      currentItem: null,
      lastError: null,
    });
    expect(RNFS.writeFile).toHaveBeenCalledTimes(1);
    const [, contents] = (RNFS.writeFile as jest.Mock).mock.calls[0];
    expect(JSON.parse(contents)).toMatchObject({ runId: 'run-1', state: 'running' });
  });

  it('appends a detection record (with its full embedding) to the JSONL file', async () => {
    const writer = new GoldenBatchResultWriter('run-1');
    const record = makeDetectionRecord();
    await writer.appendDetection(record);

    const jsonlCalls = (RNFS.appendFile as jest.Mock).mock.calls.filter(
      ([path]) => path === detectionsJsonlPath('run-1'),
    );
    expect(jsonlCalls).toHaveLength(1);
    const written = JSON.parse((jsonlCalls[0][1] as string).trim());
    expect(written.recordType).toBe('detection');
    expect(written.embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it('writes a CSV header once, then appends compact rows without embeddings', async () => {
    const writer = new GoldenBatchResultWriter('run-1');
    await writer.appendDetection(makeDetectionRecord({ detectionIndex: 0 }));
    await writer.appendDetection(makeDetectionRecord({ detectionIndex: 1 }));

    const csvCalls = (RNFS.appendFile as jest.Mock).mock.calls.filter(
      ([path]) => path === summaryCsvPath('run-1'),
    );
    // One header write + one row per detection.
    expect(csvCalls).toHaveLength(3);
    expect(csvCalls[0][1]).toContain('itemIndex');
    expect(csvCalls[0][1]).not.toContain('embedding');
    expect(csvCalls[1][1]).not.toContain('embedding');
  });

  it('appends an item summary line distinguishable from detection lines', async () => {
    const writer = new GoldenBatchResultWriter('run-1');
    await writer.appendItemSummary({
      itemIndex: 0,
      stagedPath: 'Taffy/IMG_900.jpg',
      expectedFolder: 'Taffy',
      expectedName: 'IMG_900.jpg',
      expectedStableId: null,
      knownStatus: 'unknown',
      detectionCount: 0,
      totalInferenceTimeMs: 0,
      errors: [{ species: null, stage: 'staging', message: 'not found' }],
    });

    const jsonlCalls = (RNFS.appendFile as jest.Mock).mock.calls.filter(
      ([path]) => path === detectionsJsonlPath('run-1'),
    );
    expect(jsonlCalls).toHaveLength(1);
    const written = JSON.parse((jsonlCalls[0][1] as string).trim());
    expect(written.recordType).toBe('item');
    expect(written.errors).toHaveLength(1);
  });

  it('writes run metadata as a single JSON document', async () => {
    const writer = new GoldenBatchResultWriter('run-1');
    await writer.writeRunMetadata({ runId: 'run-1', summary: { totalItems: 5 } });
    expect(RNFS.writeFile).toHaveBeenCalledTimes(1);
  });
});
