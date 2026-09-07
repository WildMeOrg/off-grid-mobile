import { ganeshaApiClient } from '../ganeshaApiClient';
import type { GaneshaApiErrorCode } from '../ganeshaApiClient';
import { MIEWID_MODEL_NAME } from '../../config/modelSources';
import type { ModelSource } from '../../config/modelSources';
import type { ModelFormat } from '../../types/wildlife';
import logger from '../../utils/logger';

export type ResolveModelSourceResult =
  | { ok: true; source: ModelSource }
  | {
      ok: false;
      code: GaneshaApiErrorCode;
      message: string;
      httpStatus?: number;
    };

/**
 * The API has no format field, so a .tflite filename selects LiteRT;
 * other filenames retain the ONNX default.
 */
function formatFromUrl(url: string): ModelFormat {
  const path = url.split('?')[0] ?? url;
  return path.toLowerCase().endsWith('.tflite') ? 'tflite' : 'onnx';
}

/**
 * Resolve immediately before downloading: the returned signed URL expires
 * and must not be cached across acquisitions. Defaults to the ONNX model;
 * pass MIEWID_LITERT_MODEL_NAME to request the Android LiteRT artifact.
 */
export async function resolveMiewidModelSource(
  modelName: string = MIEWID_MODEL_NAME,
): Promise<ResolveModelSourceResult> {
  const result = await ganeshaApiClient.getLatestModel(modelName);
  if (!result.ok) {
    logger.warn(
      `[resolveMiewidModelSource] Failed to resolve model source: ${result.code} (${result.message})`,
    );
    return result;
  }

  const { data } = result;
  return {
    ok: true,
    source: {
      name: data.name,
      version: data.version,
      url: data.downloadUrl,
      expectedSha256: data.sha256,
      expectedSizeBytes: data.sizeBytes,
      format: formatFromUrl(data.downloadUrl),
    },
  };
}
