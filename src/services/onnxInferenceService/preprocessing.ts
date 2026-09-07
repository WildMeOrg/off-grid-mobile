import type { DetectorConfig } from '../../types';
import { ImageTensorModule } from './nativeImageTensor';

/**
 * Default MiewID v4 normalization (ImageNet statistics).
 */
export const MIEWID_DEFAULTS = {
  inputSize: [440, 440] as [number, number],
  normalize: {
    mean: [0.485, 0.456, 0.406] as [number, number, number],
    std: [0.229, 0.224, 0.225] as [number, number, number],
  },
};

/**
 * Preprocess an image for detection inference.
 *
 * Calls the native ImageTensorModule to load the image, resize it,
 * and normalize pixel values into an NCHW Float32Array tensor.
 *
 * @param imageUri  URI of the source image
 * @param config    Detector configuration describing input dimensions and normalization
 * @returns Float32Array of size channels * height * width in NCHW layout
 */
export async function preprocessImageForDetection(
  imageUri: string,
  config: DetectorConfig,
): Promise<Float32Array> {
  const [height, width] = config.inputSize;
  const { mean, std, scale } = config.normalize;

  const rawArray = await ImageTensorModule.imageToTensor(
    imageUri,
    width,
    height,
    mean,
    std,
    scale,
    config.channelOrder,
  );

  return new Float32Array(rawArray);
}

/**
 * Preprocess a cropped image for MiewID embedding extraction.
 *
 * @param imageUri   URI of the cropped image
 * @param inputSize  Model input dimensions [height, width]
 * @param normalize  Normalization parameters (mean, std per channel)
 * @returns Float32Array of size 3 * height * width in NCHW layout
 */
export async function preprocessImageForEmbedding(
  imageUri: string,
  inputSize?: [number, number],
  normalize?: { mean: [number, number, number]; std: [number, number, number] },
): Promise<Float32Array> {
  const size = inputSize ?? MIEWID_DEFAULTS.inputSize;
  const norm = normalize ?? MIEWID_DEFAULTS.normalize;
  const [height, width] = size;

  const rawArray = await ImageTensorModule.imageToTensor(
    imageUri,
    width,
    height,
    norm.mean,
    norm.std,
    1.0 / 255.0, // MiewID (and ImageNet norm in general) expects inputs in [0,1] before mean/std
    'RGB',
  );

  return new Float32Array(rawArray);
}
