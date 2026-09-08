jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: {
    LiteRtEmbeddingModule: {
      isGpuSupported: jest.fn(),
      loadModel: jest.fn(),
      embedFromUri: jest.fn(),
      unloadModel: jest.fn(),
    },
  },
}));

jest.mock('../../../src/services/onnxInferenceService', () => ({
  onnxInferenceService: {
    loadModel: jest.fn().mockResolvedValue(undefined),
    extractEmbedding: jest.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3], inferenceTimeMs: 30 }),
    isModelLoaded: jest.fn().mockReturnValue(false),
    unloadModel: jest.fn().mockResolvedValue(undefined),
  },
}));

import { NativeModules } from 'react-native';
import { embeddingInferenceService } from '../../../src/services/embeddingInferenceService';
import { onnxInferenceService } from '../../../src/services/onnxInferenceService';

const mockOnnxLoadModel = onnxInferenceService.loadModel as jest.Mock;
const mockOnnxExtractEmbedding = onnxInferenceService.extractEmbedding as jest.Mock;
const mockOnnxIsModelLoaded = onnxInferenceService.isModelLoaded as jest.Mock;
const mockOnnxUnloadModel = onnxInferenceService.unloadModel as jest.Mock;

const liteRt = NativeModules.LiteRtEmbeddingModule as {
  loadModel: jest.Mock;
  embedFromUri: jest.Mock;
  unloadModel: jest.Mock;
};

describe('embeddingInferenceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOnnxLoadModel.mockResolvedValue(undefined);
    mockOnnxExtractEmbedding.mockResolvedValue({ embedding: [0.1, 0.2, 0.3], inferenceTimeMs: 30 });
    mockOnnxIsModelLoaded.mockReturnValue(false);
    mockOnnxUnloadModel.mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  // format 'onnx' -- passthrough to onnxInferenceService unchanged
  // -------------------------------------------------------------------------

  describe('format onnx', () => {
    it('loadModel delegates to onnxInferenceService', async () => {
      await embeddingInferenceService.loadModel('/models/miewid.onnx', 'onnx');

      expect(mockOnnxLoadModel).toHaveBeenCalledWith('/models/miewid.onnx', 'embedding');
      expect(liteRt.loadModel).not.toHaveBeenCalled();
    });

    it('isModelLoaded delegates to onnxInferenceService', () => {
      mockOnnxIsModelLoaded.mockReturnValue(true);

      expect(embeddingInferenceService.isModelLoaded('/models/miewid.onnx', 'onnx')).toBe(true);
      expect(mockOnnxIsModelLoaded).toHaveBeenCalledWith('/models/miewid.onnx');
    });

    it('extractEmbedding delegates to onnxInferenceService and tags runtime onnx-cpu', async () => {
      const result = await embeddingInferenceService.extractEmbedding(
        'file:///crop.jpg',
        '/models/miewid.onnx',
      );

      expect(mockOnnxExtractEmbedding).toHaveBeenCalledWith(
        'file:///crop.jpg',
        '/models/miewid.onnx',
        undefined,
      );
      expect(result).toEqual({ embedding: [0.1, 0.2, 0.3], inferenceTimeMs: 30, runtime: 'onnx-cpu' });
    });

    it('unloadModel delegates to onnxInferenceService', async () => {
      await embeddingInferenceService.unloadModel('/models/miewid.onnx');

      expect(mockOnnxUnloadModel).toHaveBeenCalledWith('/models/miewid.onnx');
      expect(liteRt.unloadModel).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // format 'tflite' on Android -- routes to the LiteRT native bridge
  // -------------------------------------------------------------------------

  describe('format tflite on Android', () => {
    it('loadModel uses the GPU delegate and records runtime litert-gpu', async () => {
      liteRt.loadModel.mockResolvedValue({ runtime: 'gpu' });

      await embeddingInferenceService.loadModel('/models/miewid-gpu.tflite', 'tflite');

      expect(liteRt.loadModel).toHaveBeenCalledWith('/models/miewid-gpu.tflite', true);
      expect(mockOnnxLoadModel).not.toHaveBeenCalled();
      expect(embeddingInferenceService.isModelLoaded('/models/miewid-gpu.tflite', 'tflite')).toBe(true);
    });

    it('falls back to litert-cpu when the device has no GPU delegate', async () => {
      liteRt.loadModel.mockResolvedValue({ runtime: 'cpu' });
      liteRt.embedFromUri.mockResolvedValue({ embedding: [0.4, 0.5], inferenceTimeMs: 900 });

      await embeddingInferenceService.loadModel('/models/miewid-cpu-fallback.tflite', 'tflite');
      const result = await embeddingInferenceService.extractEmbedding(
        'file:///crop.jpg',
        '/models/miewid-cpu-fallback.tflite',
      );

      expect(result.runtime).toBe('litert-cpu');
    });

    it('extractEmbedding calls embedFromUri with MiewID defaults and tags the loaded runtime', async () => {
      liteRt.loadModel.mockResolvedValue({ runtime: 'gpu' });
      liteRt.embedFromUri.mockResolvedValue({ embedding: [0.7, 0.8], inferenceTimeMs: 76 });

      await embeddingInferenceService.loadModel('/models/miewid-defaults.tflite', 'tflite');
      const result = await embeddingInferenceService.extractEmbedding(
        'file:///crop.jpg',
        '/models/miewid-defaults.tflite',
      );

      expect(liteRt.embedFromUri).toHaveBeenCalledWith(
        'file:///crop.jpg',
        440,
        [0.485, 0.456, 0.406],
        [0.229, 0.224, 0.225],
        1 / 255,
        2152,
      );
      expect(mockOnnxExtractEmbedding).not.toHaveBeenCalled();
      expect(result).toEqual({ embedding: [0.7, 0.8], inferenceTimeMs: 76, runtime: 'litert-gpu' });
    });

    it('does not re-load an already-loaded LiteRT model path', async () => {
      liteRt.loadModel.mockResolvedValue({ runtime: 'gpu' });

      await embeddingInferenceService.loadModel('/models/miewid-no-reload.tflite', 'tflite');
      await embeddingInferenceService.loadModel('/models/miewid-no-reload.tflite', 'tflite');

      expect(liteRt.loadModel).toHaveBeenCalledTimes(1);
    });

    it('propagates a LiteRT load failure instead of silently falling back', async () => {
      liteRt.loadModel.mockRejectedValue(new Error('Failed to load LiteRT model: corrupt file'));

      await expect(
        embeddingInferenceService.loadModel('/models/miewid-load-fail.tflite', 'tflite'),
      ).rejects.toThrow('corrupt file');
      // A failed load leaves no LiteRT model marked as active.
      expect(embeddingInferenceService.isModelLoaded('/models/miewid-load-fail.tflite', 'tflite')).toBe(false);
    });

    it('unloadModel releases the native LiteRT interpreter', async () => {
      liteRt.loadModel.mockResolvedValue({ runtime: 'gpu' });
      await embeddingInferenceService.loadModel('/models/miewid-unload.tflite', 'tflite');

      await embeddingInferenceService.unloadModel('/models/miewid-unload.tflite');

      expect(liteRt.unloadModel).toHaveBeenCalled();
      expect(mockOnnxUnloadModel).not.toHaveBeenCalled();
      expect(embeddingInferenceService.isModelLoaded('/models/miewid-unload.tflite', 'tflite')).toBe(false);
    });
  });
});
