import type { EmbeddingOutput } from '../onnxInferenceService/types';

export type EmbeddingRuntime = 'litert-gpu' | 'litert-cpu' | 'onnx-cpu';

export interface EmbeddingInferenceResult extends EmbeddingOutput {
  runtime: EmbeddingRuntime;
}

export interface EmbeddingInferenceOptions {
  inputSize?: [number, number];
  normalize?: {
    mean: [number, number, number];
    std: [number, number, number];
  };
  /** Expected embedding dimensionality (e.g. a pack's embeddingDim). */
  expectedDim?: number;
}
