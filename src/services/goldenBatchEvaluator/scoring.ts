import type {
  GoldenBatchCandidate,
  GoldenBatchKnownStatus,
  GoldenBatchSummary,
} from './types';
import { DEFAULT_MATCH_THRESHOLD } from './types';

/**
 * Pure scoring helpers for the golden batch evaluator. Kept free of RNFS /
 * pipeline dependencies so they're trivial to unit test.
 */

/**
 * Resolve a detection's prediction from its ranked candidates: the top
 * candidate counts as a match only when its score clears `threshold`.
 * Below threshold (or no candidates at all) is an open-set / "no match"
 * outcome, which is exactly what an unknown individual should produce.
 */
export function scoreDetection(
  candidates: GoldenBatchCandidate[],
  threshold: number = DEFAULT_MATCH_THRESHOLD,
): { predictedStableId: string | null; predictedScore: number | null } {
  const top = candidates[0];
  if (!top) {
    return { predictedStableId: null, predictedScore: null };
  }
  if (top.score < threshold) {
    return { predictedStableId: null, predictedScore: top.score };
  }
  return { predictedStableId: top.stableId, predictedScore: top.score };
}

export interface GoldenBatchItemScoreInput {
  knownStatus: GoldenBatchKnownStatus;
  expectedStableId: string | null;
  /** Predictions for every detection found in this item's image. */
  detections: Array<{
    predictedStableId: string | null;
    candidateStableIds: string[];
  }>;
}

/**
 * Summarize a full run's scored items into known/unknown accuracy metrics.
 *
 * Known items: correct if ANY detection's prediction matches the expected
 * stable ID (a photo can contain more than one detection, e.g. a herd shot
 * where only one bounding box is the target individual). Unknown (open-set)
 * items: correctly rejected only when NO detection matched any pack
 * individual above threshold.
 */
export function summarizeRun(
  items: GoldenBatchItemScoreInput[],
  matchThreshold: number = DEFAULT_MATCH_THRESHOLD,
): GoldenBatchSummary {
  let knownCorrect = 0;
  let knownIncorrect = 0;
  let knownNoDetection = 0;
  let knownTop1 = 0;
  let knownTop5 = 0;
  let unknownCorrectlyRejected = 0;
  let unknownFalseAccept = 0;
  let unknownNoDetection = 0;

  const knownItems = items.filter((item) => item.knownStatus === 'known');
  const unknownItems = items.filter((item) => item.knownStatus === 'unknown');

  for (const item of knownItems) {
    if (item.detections.length === 0) {
      knownNoDetection += 1;
      continue;
    }
    if (
      item.detections.some(
        (detection) =>
          detection.candidateStableIds[0] === item.expectedStableId,
      )
    ) {
      knownTop1 += 1;
    }
    if (
      item.detections.some((detection) =>
        detection.candidateStableIds
          .slice(0, 5)
          .includes(item.expectedStableId ?? ''),
      )
    ) {
      knownTop5 += 1;
    }
    const isCorrect = item.detections.some(
      (detection) => detection.predictedStableId === item.expectedStableId,
    );
    if (isCorrect) {
      knownCorrect += 1;
    } else {
      knownIncorrect += 1;
    }
  }

  for (const item of unknownItems) {
    if (item.detections.length === 0) {
      unknownNoDetection += 1;
      continue;
    }
    const matchedAnyone = item.detections.some(
      (detection) => detection.predictedStableId !== null,
    );
    if (matchedAnyone) {
      unknownFalseAccept += 1;
    } else {
      unknownCorrectlyRejected += 1;
    }
  }

  const scorableKnown = knownCorrect + knownIncorrect;
  const scorableUnknown = unknownCorrectlyRejected + unknownFalseAccept;

  return {
    runId: '',
    totalItems: items.length,
    knownItems: knownItems.length,
    unknownItems: unknownItems.length,
    knownCorrect,
    knownIncorrect,
    knownNoDetection,
    knownTop1,
    knownTop5,
    knownTop1Rate:
      knownItems.length > 0 ? knownTop1 / knownItems.length : null,
    knownTop5Rate:
      knownItems.length > 0 ? knownTop5 / knownItems.length : null,
    unknownCorrectlyRejected,
    unknownFalseAccept,
    unknownNoDetection,
    accuracyKnown: scorableKnown > 0 ? knownCorrect / scorableKnown : null,
    openSetRejectionRate:
      scorableUnknown > 0
        ? unknownCorrectlyRejected / scorableUnknown
        : null,
    matchThreshold,
  };
}
