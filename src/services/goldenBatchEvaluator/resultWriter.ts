import RNFS from 'react-native-fs';
import type {
  GoldenBatchDetectionRecord,
  GoldenBatchItemSummary,
  GoldenBatchStatus,
} from './types';
import {
  detectionsJsonlPath,
  runMetadataPath,
  runResultsDir,
  statusPath,
  summaryCsvPath,
} from './paths';
import logger from '../../utils/logger';

const CSV_HEADER = [
  'itemIndex',
  'stagedPath',
  'expectedFolder',
  'expectedName',
  'expectedStableId',
  'knownStatus',
  'detectionIndex',
  'detectorConfidence',
  'topCandidateStableId',
  'topCandidateName',
  'topCandidateScore',
  'predictedStableId',
  'predictedScore',
  'candidateCount',
  'totalInferenceTimeMs',
].join(',');

function csvField(value: string | number | null): string {
  const str = value === null ? '' : String(value);
  return /["\n,]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function detectionToCsvRow(record: GoldenBatchDetectionRecord): string {
  const topCandidate = record.candidates[0];
  return [
    record.itemIndex,
    record.stagedPath,
    record.expectedFolder,
    record.expectedName,
    record.expectedStableId,
    record.knownStatus,
    record.detectionIndex,
    record.detectorConfidence,
    topCandidate?.stableId ?? null,
    topCandidate?.individualName ?? null,
    topCandidate?.score ?? null,
    record.predictedStableId,
    record.predictedScore,
    record.candidates.length,
    record.totalInferenceTimeMs,
  ]
    .map(csvField)
    .join(',');
}

/**
 * Incrementally flushes golden batch run output so partial progress
 * survives a crash or forced app restart mid-run:
 * - `status.json` -- overwritten after every item (small, always current).
 * - `detections.jsonl` -- appended per detection AND per item (full
 *   embeddings included -- this is the only file with raw vectors).
 * - `summary.csv` -- appended per detection, no embeddings (spreadsheet-
 *   friendly compact view).
 * - `run-metadata.json` -- written once at the end.
 */
export class GoldenBatchResultWriter {
  private readonly runId: string;
  private csvHeaderWritten = false;

  constructor(runId: string) {
    this.runId = runId;
  }

  async init(): Promise<void> {
    await RNFS.mkdir(runResultsDir(this.runId));
  }

  async writeStatus(status: GoldenBatchStatus): Promise<void> {
    try {
      await RNFS.writeFile(
        statusPath(this.runId),
        JSON.stringify(status, null, 2),
        'utf8',
      );
    } catch (error) {
      logger.error(
        `[GoldenBatchEvaluator] Failed to write status for run ${this.runId}:`,
        error,
      );
    }
  }

  async appendDetection(record: GoldenBatchDetectionRecord): Promise<void> {
    await this.appendJsonlLine({ recordType: 'detection', ...record });
    await this.ensureCsvHeader();
    await RNFS.appendFile(
      summaryCsvPath(this.runId),
      `${detectionToCsvRow(record)}\n`,
      'utf8',
    );
  }

  async appendItemSummary(summary: GoldenBatchItemSummary): Promise<void> {
    await this.appendJsonlLine({ recordType: 'item', ...summary });
  }

  async writeRunMetadata(metadata: Record<string, unknown>): Promise<void> {
    await RNFS.writeFile(
      runMetadataPath(this.runId),
      JSON.stringify(metadata, null, 2),
      'utf8',
    );
  }

  private async ensureCsvHeader(): Promise<void> {
    if (this.csvHeaderWritten) {
      return;
    }
    this.csvHeaderWritten = true;
    await RNFS.appendFile(summaryCsvPath(this.runId), `${CSV_HEADER}\n`, 'utf8');
  }

  private async appendJsonlLine(value: unknown): Promise<void> {
    await RNFS.appendFile(
      detectionsJsonlPath(this.runId),
      `${JSON.stringify(value)}\n`,
      'utf8',
    );
  }
}
