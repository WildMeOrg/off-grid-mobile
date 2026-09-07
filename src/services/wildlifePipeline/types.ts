import type { DetectorConfig, Detection, ModelFormat } from '../../types';
import type { EmbeddingDatabaseEntry } from '../embeddingMatchService/types';

export interface SpeciesConfig {
  packId: string;
  species: string;
  detectorModelPath: string;
  detectorConfig: DetectorConfig;
  embeddingDatabase: EmbeddingDatabaseEntry[];
  /**
   * Embedding preprocessing from the pack's manifest (`embeddingModel`).
   * When absent, the pipeline falls back to the photo-level params and
   * finally to the MiewID v4 defaults (440×440, ImageNet).
   */
  embeddingInputSize?: [number, number];
  embeddingNormalize?: {
    mean: [number, number, number];
    std: [number, number, number];
  };
}

export interface ProcessPhotoParams {
  photoUri: string;
  speciesConfigs: SpeciesConfig[];
  miewidModelPath: string;
  /** Defaults to 'onnx' for callers without explicit format metadata. */
  miewidModelFormat?: ModelFormat;
  embeddingInputSize?: [number, number];
  embeddingNormalize?: {
    mean: [number, number, number];
    std: [number, number, number];
  };
}

export type PipelineErrorStage =
  | 'embedding-model'
  | 'detector'
  | 'crop'
  | 'embedding'
  | 'match';

export interface PipelineError {
  /** Species whose processing failed; null for photo-wide failures. */
  species: string | null;
  stage: PipelineErrorStage;
  message: string;
}

export interface PipelineResult {
  observationId: string;
  photoUri: string;
  detections: Detection[];
  /**
   * Per-species / per-detection failures. Detections that completed are
   * always returned even when other work failed — callers decide whether a
   * partial observation is worth saving.
   */
  errors: PipelineError[];
  totalInferenceTimeMs: number;
}
