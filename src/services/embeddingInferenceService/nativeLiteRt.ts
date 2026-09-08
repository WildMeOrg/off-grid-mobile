import { NativeModules } from 'react-native';

/** Android-only -- undefined on iOS and in any test environment without a native mock. */
interface LiteRtEmbeddingModuleInterface {
  isGpuSupported(): Promise<boolean>;
  loadModel(modelPath: string, preferGpu: boolean): Promise<{ runtime: 'gpu' | 'cpu' }>;
  embedFromUri(
    imageUri: string,
    inputSize: number,
    mean: number[],
    std: number[],
    scale: number,
    expectedDim: number,
  ): Promise<{ embedding: number[]; inferenceTimeMs: number }>;
  unloadModel(): Promise<void>;
}

export const LiteRtEmbeddingModule = NativeModules.LiteRtEmbeddingModule as
  | LiteRtEmbeddingModuleInterface
  | undefined;
