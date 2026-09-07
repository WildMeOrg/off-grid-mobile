import RNFS from 'react-native-fs';
import type { ModelSource } from '../../config/modelSources';
import { downloadFileWithIntegrityCheck } from '../fileDownloadService';
import type { DownloadOptions, DownloadOutcome } from './types';
import logger from '../../utils/logger';

/**
 * Model-specific staging/destination paths on top of the shared
 * fileDownloadService engine (staging-path download, HTTP status check,
 * expected-length check, SHA-256 verification, retry/backoff, and an atomic
 * same-filesystem move into the model cache). Built on RNFS.downloadFile —
 * the native DownloadManagerModule has no JS binding, no checksum support,
 * and a non-atomic cross-filesystem move; revisit it only if
 * background/resumable downloads become a requirement (Stage 2.8).
 */

/** Staging lives on the same filesystem as the destination so the final
 * move is an atomic rename — a crash never leaves a half-written file at
 * the destination path. */
const stagingDir = () => `${RNFS.DocumentDirectoryPath}/staging`;
const modelsDir = () => `${RNFS.DocumentDirectoryPath}/models`;

const pathPart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 48) ||
  'model';

const normalizedSha256 = (value: string): string | null => {
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
};

const artifactKey = (source: ModelSource, sha256: string): string =>
  `${pathPart(source.name)}-${pathPart(source.version)}-${sha256}`;

// ModelFormat values ('onnx' | 'tflite') double as the file extension, so an
// ONNX and a LiteRT install of the same name/version never collide on disk.
const stagingPathFor = (source: ModelSource, sha256: string) =>
  `${stagingDir()}/${artifactKey(source, sha256)}.${source.format}.part`;
const finalPathFor = (source: ModelSource, sha256: string) =>
  `${modelsDir()}/${artifactKey(source, sha256)}.${source.format}`;

async function reuseVerifiedModel(
  path: string,
  expectedSha256: string,
  expectedSizeBytes?: number,
): Promise<DownloadOutcome | null> {
  if (!(await RNFS.exists(path))) {
    return null;
  }
  try {
    const stat = await RNFS.stat(path);
    const sizeBytes = Number(stat.size);
    const sizeMatches =
      expectedSizeBytes === undefined || sizeBytes === expectedSizeBytes;
    const sha256 = (await RNFS.hash(path, 'sha256')).toLowerCase();
    if (sizeMatches && sha256 === expectedSha256) {
      return { ok: true, path, sha256, sizeBytes };
    }
    await RNFS.unlink(path);
  } catch (error) {
    return {
      ok: false,
      code: 'move-failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return null;
}

class ModelDownloadService {
  async downloadModel(
    source: ModelSource,
    opts: DownloadOptions = {},
  ): Promise<DownloadOutcome> {
    const expectedSha256 = normalizedSha256(source.expectedSha256);
    if (!expectedSha256) {
      return {
        ok: false,
        code: 'checksum-mismatch',
        message: 'Model metadata contains an invalid SHA-256',
      };
    }
    const finalPath = finalPathFor(source, expectedSha256);
    const cached = await reuseVerifiedModel(
      finalPath,
      expectedSha256,
      source.expectedSizeBytes,
    );
    if (cached) {
      return cached;
    }
    const outcome = await downloadFileWithIntegrityCheck(
      {
        source: {
          url: source.url,
          expectedSha256,
          expectedSizeBytes: source.expectedSizeBytes,
          headers: source.headers,
        },
        stagingPath: stagingPathFor(source, expectedSha256),
        finalPath,
      },
      opts,
    );

    if (outcome.ok) {
      logger.log(
        `[ModelDownload] ${source.name}@${source.version} verified and installed at ${outcome.path}`,
      );
    }
    return outcome;
  }
}

export const modelDownloadService = new ModelDownloadService();
export type {
  DownloadOptions,
  DownloadOutcome,
  DownloadErrorCode,
} from './types';
