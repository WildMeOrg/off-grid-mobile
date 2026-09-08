import { Platform } from 'react-native';
import { onnxInferenceService } from '../onnxInferenceService';
import { MIEWID_DEFAULTS } from '../onnxInferenceService/preprocessing';
import { LiteRtEmbeddingModule } from './nativeLiteRt';
import type { ModelFormat } from '../../types';
import type { EmbeddingInferenceOptions, EmbeddingInferenceResult, EmbeddingRuntime } from './types';
import logger from '../../utils/logger';

/** MiewID v4.1's raw embedding dimensionality (see docs/EMBEDDING_PACK_FORMAT.md). */
const DEFAULT_EMBEDDING_DIM = 2152;
/** MiewID (and ImageNet norm in general) expects inputs in [0,1] before mean/std. */
const MIEWID_SCALE = 1.0 / 255.0;

/**
 * Routes embeddings to Android LiteRT when the artifact and bridge support
 * it; otherwise delegates to the shared ONNX service. Detection stays on ONNX.
 * Errors propagate to the pipeline; this service does not download or retry
 * an alternative artifact when a runtime fails.
 */
class EmbeddingInferenceService {
  private liteRtModelPath: string | null = null;
  private liteRtRuntime: Extract<EmbeddingRuntime, 'litert-gpu' | 'litert-cpu'> | null = null;

  private usesLiteRt(format: ModelFormat): boolean {
    return format === 'tflite' && Platform.OS === 'android' && LiteRtEmbeddingModule != null;
  }

  isModelLoaded(modelPath: string, format: ModelFormat): boolean {
    if (this.usesLiteRt(format)) {
      return this.liteRtModelPath === modelPath;
    }
    return onnxInferenceService.isModelLoaded(modelPath);
  }

  async loadModel(modelPath: string, format: ModelFormat): Promise<void> {
    if (this.usesLiteRt(format)) {
      if (this.liteRtModelPath === modelPath) {
        return;
      }
      const result = await LiteRtEmbeddingModule!.loadModel(modelPath, true);
      this.liteRtModelPath = modelPath;
      this.liteRtRuntime = result.runtime === 'gpu' ? 'litert-gpu' : 'litert-cpu';
      logger.log(`[EmbeddingInference] Loaded ${modelPath} on ${this.liteRtRuntime}`);
      return;
    }
    await onnxInferenceService.loadModel(modelPath, 'embedding');
  }

  async extractEmbedding(
    croppedImageUri: string,
    modelPath: string,
    opts?: EmbeddingInferenceOptions,
  ): Promise<EmbeddingInferenceResult> {
    if (this.liteRtModelPath === modelPath && this.liteRtRuntime) {
      const size = opts?.inputSize ?? MIEWID_DEFAULTS.inputSize;
      const normalize = opts?.normalize ?? MIEWID_DEFAULTS.normalize;
      const expectedDim = opts?.expectedDim ?? DEFAULT_EMBEDDING_DIM;

      const startTime = Date.now();
      const result = await LiteRtEmbeddingModule!.embedFromUri(
        croppedImageUri,
        size[0],
        normalize.mean,
        normalize.std,
        MIEWID_SCALE,
        expectedDim,
      );
      logger.log(
        `[EmbeddingInference] ${this.liteRtRuntime}: ${result.embedding.length}-dim in ${Date.now() - startTime}ms`,
      );
      return {
        embedding: result.embedding,
        inferenceTimeMs: result.inferenceTimeMs,
        runtime: this.liteRtRuntime,
      };
    }

    const output = await onnxInferenceService.extractEmbedding(croppedImageUri, modelPath, opts);
    return { ...output, runtime: 'onnx-cpu' };
  }

  async unloadModel(modelPath: string): Promise<void> {
    if (this.liteRtModelPath === modelPath) {
      await LiteRtEmbeddingModule!.unloadModel();
      this.liteRtModelPath = null;
      this.liteRtRuntime = null;
      return;
    }
    await onnxInferenceService.unloadModel(modelPath);
  }
}

export const embeddingInferenceService = new EmbeddingInferenceService();
export type { EmbeddingInferenceOptions, EmbeddingInferenceResult, EmbeddingRuntime } from './types';
