import type { Detection } from '../../types';
import { onnxInferenceService } from '../onnxInferenceService';
import { embeddingInferenceService } from '../embeddingInferenceService';
import { embeddingMatchService } from '../embeddingMatchService';
import { ImageTensorModule } from '../onnxInferenceService/nativeImageTensor';
import { generateId } from '../../utils/generateId';
import logger from '../../utils/logger';
import type {
  ProcessPhotoParams,
  PipelineError,
  PipelineResult,
  SpeciesConfig,
} from './types';

const RNFS = require('react-native-fs');

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

class WildlifePipeline {
  /**
   * Run the full detect → crop → embed → match pipeline for one photo.
   *
   * Partial-failure semantics: one species' detector blowing up, or one
   * detection failing to crop/embed, never discards work that already
   * completed — failures are annotated in `result.errors` instead. The one
   * fail-fast case is the MiewID embedding model itself: if it cannot load,
   * no detector work is started (detections without embeddings cannot match).
   */
  async processPhoto(params: ProcessPhotoParams): Promise<PipelineResult> {
    const {
      photoUri,
      speciesConfigs,
      miewidModelPath,
      miewidModelFormat = 'onnx',
      embeddingInputSize,
      embeddingNormalize,
    } = params;
    const observationId = generateId();
    const detections: Detection[] = [];
    const errors: PipelineError[] = [];
    let totalInferenceTimeMs = 0;

    // Load MiewID before any detector work — embeddings are required for
    // every detection, so a broken model would waste all detector inference.
    if (speciesConfigs.length > 0) {
      try {
        if (!embeddingInferenceService.isModelLoaded(miewidModelPath, miewidModelFormat)) {
          await embeddingInferenceService.loadModel(miewidModelPath, miewidModelFormat);
        }
      } catch (error) {
        logger.error('[WildlifePipeline] MiewID load failed:', error);
        return {
          observationId,
          photoUri,
          detections,
          errors: [
            {
              species: null,
              stage: 'embedding-model',
              message: errorMessage(error),
            },
          ],
          totalInferenceTimeMs,
        };
      }
    }

    for (const config of speciesConfigs) {
      let detectionResults;
      try {
        if (!onnxInferenceService.isModelLoaded(config.detectorModelPath)) {
          await onnxInferenceService.loadModel(
            config.detectorModelPath,
            'detector',
          );
        }
        const detectionOutput = await onnxInferenceService.runDetection(
          photoUri,
          config.detectorModelPath,
          config.detectorConfig,
        );
        totalInferenceTimeMs += detectionOutput.inferenceTimeMs;
        detectionResults = detectionOutput.results;
      } catch (error) {
        logger.error(
          `[WildlifePipeline] Detection failed for ${config.species}:`,
          error,
        );
        errors.push({
          species: config.species,
          stage: 'detector',
          message: errorMessage(error),
        });
        continue;
      }

      if (detectionResults.length === 0) {
        continue;
      }

      const cropsDir = `${RNFS.CachesDirectoryPath}/crops`;
      await RNFS.mkdir(cropsDir);

      for (const result of detectionResults) {
        const outcome = await this.processDetection({
          photoUri,
          cropsDir,
          observationId,
          config,
          result,
          miewidModelPath,
          embeddingInputSize,
          embeddingNormalize,
        });
        if ('error' in outcome) {
          errors.push(outcome.error);
        } else {
          totalInferenceTimeMs += outcome.inferenceTimeMs;
          detections.push(outcome.detection);
        }
      }
    }

    logger.log(
      `[WildlifePipeline] Processed photo: ${detections.length} detection(s), ${errors.length} error(s), ${totalInferenceTimeMs}ms`,
    );

    return {
      observationId,
      photoUri,
      detections,
      errors,
      totalInferenceTimeMs,
    };
  }

  private async processDetection(args: {
    photoUri: string;
    cropsDir: string;
    observationId: string;
    config: SpeciesConfig;
    result: { boundingBox: Detection['boundingBox']; species: string; confidence: number };
    miewidModelPath: string;
    embeddingInputSize?: [number, number];
    embeddingNormalize?: { mean: [number, number, number]; std: [number, number, number] };
  }): Promise<
    | { detection: Detection; inferenceTimeMs: number }
    | { error: PipelineError }
  > {
    const { config, result } = args;
    const detectionId = generateId();
    let stage: PipelineError['stage'] = 'crop';

    try {
      const cropPath = `${args.cropsDir}/${detectionId}.jpg`;
      const croppedImageUri = await ImageTensorModule.cropImage(
        args.photoUri,
        result.boundingBox.x,
        result.boundingBox.y,
        result.boundingBox.width,
        result.boundingBox.height,
        cropPath,
      );

      stage = 'embedding';
      const embeddingOutput = await embeddingInferenceService.extractEmbedding(
        croppedImageUri,
        args.miewidModelPath,
        {
          inputSize: config.embeddingInputSize ?? args.embeddingInputSize,
          normalize: config.embeddingNormalize ?? args.embeddingNormalize,
        },
      );

      stage = 'match';
      const topCandidates = embeddingMatchService.matchEmbedding(
        embeddingOutput.embedding,
        config.embeddingDatabase,
        5,
      );

      return {
        inferenceTimeMs: embeddingOutput.inferenceTimeMs,
        detection: {
          id: detectionId,
          observationId: args.observationId,
          boundingBox: result.boundingBox,
          species: result.species,
          speciesConfidence: result.confidence,
          croppedImageUri,
          embedding: embeddingOutput.embedding,
          matchResult: {
            topCandidates,
            approvedIndividual: null,
            reviewStatus: 'pending',
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
        },
      };
    } catch (error) {
      logger.error(
        `[WildlifePipeline] ${stage} failed for a ${config.species} detection:`,
        error,
      );
      return {
        error: {
          species: config.species,
          stage,
          message: errorMessage(error),
        },
      };
    }
  }
}

export const wildlifePipeline = new WildlifePipeline();
