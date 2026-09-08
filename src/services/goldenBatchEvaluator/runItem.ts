import RNFS from 'react-native-fs';
import { wildlifePipeline } from '../wildlifePipeline';
import type { SpeciesConfig } from '../wildlifePipeline/types';
import type { ModelFormat } from '../../types';
import { toDisplayUri } from '../../utils/imageUri';
import logger from '../../utils/logger';
import { assertEmbeddingDimension } from './embeddingValidation';
import { scoreDetection } from './scoring';
import { stagedDir } from './paths';
import { errorMessage } from './errorMessage';
import type { GoldenBatchResultWriter } from './resultWriter';
import type {
  GoldenBatchCandidate,
  GoldenBatchDetectionRecord,
  GoldenBatchItemError,
  GoldenBatchManifestItem,
} from './types';

async function cleanupCrop(croppedImageUri: string): Promise<void> {
  try {
    if (await RNFS.exists(croppedImageUri)) {
      await RNFS.unlink(croppedImageUri);
    }
  } catch (error) {
    logger.warn(
      `[GoldenBatchEvaluator] Failed to clean up crop ${croppedImageUri}:`,
      error,
    );
  }
}

interface ProcessItemArgs {
  runId: string;
  itemIndex: number;
  item: GoldenBatchManifestItem;
  speciesConfigs: SpeciesConfig[];
  miewidModelPath: string;
  miewidModelFormat: ModelFormat;
  individualNameIndex: Map<string, string>;
  matchThreshold: number;
  writer: GoldenBatchResultWriter;
}

interface ProcessItemResult {
  detections: Array<{
    predictedStableId: string | null;
    candidateStableIds: string[];
  }>;
  errors: string[];
}

interface FinishWithErrorsArgs {
  writer: GoldenBatchResultWriter;
  item: GoldenBatchManifestItem;
  itemIndex: number;
  errors: GoldenBatchItemError[];
}

async function finishWithErrors(
  args: FinishWithErrorsArgs,
): Promise<ProcessItemResult> {
  const { writer, item, itemIndex, errors } = args;
  await writer.appendItemSummary({
    itemIndex,
    stagedPath: item.stagedPath,
    expectedFolder: item.expectedFolder,
    expectedName: item.expectedName,
    expectedStableId: item.expectedStableId,
    knownStatus: item.knownStatus,
    detectionCount: 0,
    totalInferenceTimeMs: 0,
    errors,
  });
  return { detections: [], errors: errors.map((e) => e.message) };
}

function buildCandidates(
  detection: Awaited<ReturnType<typeof wildlifePipeline.processPhoto>>['detections'][number],
  individualNameIndex: Map<string, string>,
): GoldenBatchCandidate[] {
  return detection.matchResult.topCandidates.map((candidate) => ({
    stableId: candidate.individualId,
    score: candidate.score,
    source: candidate.source,
    individualName:
      candidate.source === 'pack'
        ? individualNameIndex.get(candidate.individualId) ?? null
        : null,
  }));
}

/**
 * Runs the production pipeline against a single staged manifest item and
 * serializes each detection record + the item-level summary. Sequential by
 * design: photos share the same loaded detector/embedding model sessions.
 */
export async function processItem(
  args: ProcessItemArgs,
): Promise<ProcessItemResult> {
  const {
    runId,
    itemIndex,
    item,
    speciesConfigs,
    miewidModelPath,
    miewidModelFormat,
    individualNameIndex,
    matchThreshold,
    writer,
  } = args;

  const errors: GoldenBatchItemError[] = [];
  const predictedDetections: Array<{
    predictedStableId: string | null;
    candidateStableIds: string[];
  }> = [];
  const stagedAbsolutePath = `${stagedDir()}/${item.stagedPath}`;

  if (!(await RNFS.exists(stagedAbsolutePath))) {
    errors.push({
      species: null,
      stage: 'staging',
      message: `Staged file not found: ${stagedAbsolutePath}`,
    });
    return finishWithErrors({ writer, item, itemIndex, errors });
  }

  let result: Awaited<ReturnType<typeof wildlifePipeline.processPhoto>>;
  try {
    result = await wildlifePipeline.processPhoto({
      photoUri: toDisplayUri(stagedAbsolutePath),
      speciesConfigs,
      miewidModelPath,
      miewidModelFormat,
    });
  } catch (error) {
    errors.push({ species: null, stage: 'pipeline', message: errorMessage(error) });
    return finishWithErrors({ writer, item, itemIndex, errors });
  }

  for (const pipelineError of result.errors) {
    errors.push({
      species: pipelineError.species,
      stage: pipelineError.stage,
      message: pipelineError.message,
    });
  }

  for (
    let detectionIndex = 0;
    detectionIndex < result.detections.length;
    detectionIndex += 1
  ) {
    const detection = result.detections[detectionIndex];
    try {
      assertEmbeddingDimension(detection.embedding);
      const candidates = buildCandidates(detection, individualNameIndex);
      const { predictedStableId, predictedScore } = scoreDetection(
        candidates,
        matchThreshold,
      );

      const record: GoldenBatchDetectionRecord = {
        runId,
        itemIndex,
        stagedPath: item.stagedPath,
        expectedFolder: item.expectedFolder,
        expectedName: item.expectedName,
        expectedStableId: item.expectedStableId,
        knownStatus: item.knownStatus,
        detectionIndex,
        boundingBox: detection.boundingBox,
        detectorConfidence: detection.speciesConfidence,
        embedding: detection.embedding,
        embeddingDim: detection.embedding.length,
        candidates,
        predictedStableId,
        predictedScore,
        totalInferenceTimeMs: result.totalInferenceTimeMs,
      };
      await writer.appendDetection(record);
      predictedDetections.push({
        predictedStableId,
        candidateStableIds: candidates.map((candidate) => candidate.stableId),
      });
    } catch (error) {
      errors.push({
        species: detection.species,
        stage: 'embedding-validation',
        message: errorMessage(error),
      });
    } finally {
      await cleanupCrop(detection.croppedImageUri);
    }
  }

  await writer.appendItemSummary({
    itemIndex,
    stagedPath: item.stagedPath,
    expectedFolder: item.expectedFolder,
    expectedName: item.expectedName,
    expectedStableId: item.expectedStableId,
    knownStatus: item.knownStatus,
    detectionCount: result.detections.length,
    totalInferenceTimeMs: result.totalInferenceTimeMs,
    errors,
  });

  return {
    detections: predictedDetections,
    errors: errors.map((e) => e.message),
  };
}
