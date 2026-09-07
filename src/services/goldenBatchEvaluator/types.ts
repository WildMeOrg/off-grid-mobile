/**
 * Types for the debug-only golden batch evaluator.
 *
 * The evaluator processes a manifest of staged reference images through the
 * production `wildlifePipeline` (detect → crop → embed → match) and writes
 * machine-readable results for offline scoring. It never calls
 * `addObservation`, persists GPS, touches the sync queue, or uploads
 * anything -- see `src/services/goldenBatchEvaluator/index.ts`.
 */

/** MiewID v4.1's raw embedding dimensionality (see docs/EMBEDDING_PACK_FORMAT.md). */
export const EXPECTED_EMBEDDING_DIM = 2152;

/** Default cosine-similarity threshold for counting a top candidate as an accepted match. */
export const DEFAULT_MATCH_THRESHOLD = 0.6;

export type GoldenBatchKnownStatus = 'known' | 'unknown';

/** One staged image to process, as described by the orchestration script's manifest. */
export interface GoldenBatchManifestItem {
  /**
   * Path of the staged image, relative to
   * `RNFS.DocumentDirectoryPath/batch/staged/` -- never an absolute path or
   * one containing `..` segments (rejected by manifest validation).
   */
  stagedPath: string;
  /** Dataset folder name the image came from (e.g. the elephant's name). */
  expectedFolder: string;
  /** Original file name, for cross-checking staging didn't mix up files. */
  expectedName: string;
  /** Stable pack individual ID this image is expected to match, or `null` for an open-set / not-in-pack individual. */
  expectedStableId: string | null;
  /** Whether this individual is installed in the pack ('known') or expected to be rejected as open-set ('unknown'). */
  knownStatus: GoldenBatchKnownStatus;
  /** ISO 8601 EXIF capture timestamp, audit metadata only -- never used for matching. */
  captureDateIso: string | null;
  /** ISO 8601 cutoff date the orchestration script used to select this item, audit metadata only. */
  cutoffIso: string;
}

/** The one-shot run request written by the orchestration script under `batch/request.json`. */
export interface GoldenBatchRunRequest {
  formatVersion: '1';
  runId: string;
  createdAt: string;
  items: GoldenBatchManifestItem[];
  /** Cosine-similarity threshold for scoring; defaults to `DEFAULT_MATCH_THRESHOLD` when omitted. */
  matchThreshold?: number;
}

export interface GoldenBatchCandidate {
  stableId: string;
  score: number;
  source: 'pack' | 'local';
  /** Resolved individual display name from the pack index. */
  individualName: string | null;
}

/** One detection record -- a single bounding box within one processed image. */
export interface GoldenBatchDetectionRecord {
  runId: string;
  itemIndex: number;
  stagedPath: string;
  expectedFolder: string;
  expectedName: string;
  expectedStableId: string | null;
  knownStatus: GoldenBatchKnownStatus;
  detectionIndex: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  detectorConfidence: number;
  /** Raw MiewID v4.1 embedding -- exactly `EXPECTED_EMBEDDING_DIM` floats. */
  embedding: number[];
  embeddingDim: number;
  candidates: GoldenBatchCandidate[];
  predictedStableId: string | null;
  predictedScore: number | null;
  /**
   * Total pipeline inference time (detector + embedding, accumulated across
   * every detection) for the whole photo this detection came from -- not a
   * per-detection breakdown, since the detector runs once per photo.
   */
  totalInferenceTimeMs: number;
}

export type GoldenBatchRunState = 'running' | 'completed' | 'failed';

export interface GoldenBatchStatus {
  runId: string;
  state: GoldenBatchRunState;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  totalItems: number;
  processedItems: number;
  errorItems: number;
  currentItem: string | null;
  lastError: string | null;
}

export interface GoldenBatchItemError {
  species: string | null;
  stage: string;
  message: string;
}

/**
 * One line of `detections.jsonl` per item -- written even when an item
 * produced zero detections, so item-level pipeline errors are never
 * silently dropped from the audit trail.
 */
export interface GoldenBatchItemSummary {
  itemIndex: number;
  stagedPath: string;
  expectedFolder: string;
  expectedName: string;
  expectedStableId: string | null;
  knownStatus: GoldenBatchKnownStatus;
  detectionCount: number;
  totalInferenceTimeMs: number;
  errors: GoldenBatchItemError[];
}

/** Discriminated union written to `detections.jsonl`, one JSON object per line. */
export type GoldenBatchResultLine =
  | ({ recordType: 'detection' } & GoldenBatchDetectionRecord)
  | ({ recordType: 'item' } & GoldenBatchItemSummary);

export interface GoldenBatchSummary {
  runId: string;
  totalItems: number;
  knownItems: number;
  unknownItems: number;
  /** Known item's best detection predicted the expected stable ID above threshold. */
  knownCorrect: number;
  /** Known item produced a detection, but the top prediction was wrong or below threshold. */
  knownIncorrect: number;
  /** Known item produced zero detections. */
  knownNoDetection: number;
  /** Known item placed the expected stable ID first for at least one detection, regardless of threshold. */
  knownTop1: number;
  /** Known item placed the expected stable ID in the top five for at least one detection, regardless of threshold. */
  knownTop5: number;
  knownTop1Rate: number | null;
  knownTop5Rate: number | null;
  /** Unknown (open-set) item correctly produced no match above threshold. */
  unknownCorrectlyRejected: number;
  /** Unknown (open-set) item incorrectly matched a pack individual above threshold. */
  unknownFalseAccept: number;
  /** Unknown item produced zero detections (counted separately from a correct rejection). */
  unknownNoDetection: number;
  accuracyKnown: number | null;
  openSetRejectionRate: number | null;
  matchThreshold: number;
}
