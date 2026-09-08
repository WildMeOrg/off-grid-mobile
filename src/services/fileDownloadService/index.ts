import RNFS from 'react-native-fs';
import type {
  DownloadErrorCode,
  DownloadOptions,
  DownloadOutcome,
  DownloadSource,
} from './types';
import logger from '../../utils/logger';

/**
 * Generic download engine with integrity guarantees the native download layer
 * lacks: staging-path download, HTTP status check, expected-length check,
 * SHA-256 verification, retry with backoff, and an atomic same-filesystem
 * move into a final destination. Extracted from modelDownloadService (which
 * originated this pattern for the MiewID .onnx model) so packDownloadService
 * (embedding pack .zip) can reuse the identical integrity/retry contract —
 * only the source URL and destination paths differ between callers. Built
 * on RNFS.downloadFile — the native DownloadManagerModule has no JS binding,
 * no checksum support, and a non-atomic cross-filesystem move.
 */

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 1000;

const RETRYABLE_CODES: ReadonlySet<DownloadErrorCode> = new Set([
  'network-error',
  'length-mismatch',
  'checksum-mismatch',
]);

const isRetryable = (outcome: DownloadOutcome): boolean => {
  if (outcome.ok) {
    return false;
  }
  if (outcome.code === 'http-error') {
    // Server-side failures are worth retrying; client errors are not.
    return outcome.httpStatus !== undefined && outcome.httpStatus >= 500;
  }
  return RETRYABLE_CODES.has(outcome.code);
};

const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const failure = (
  code: DownloadErrorCode,
  message: string,
  httpStatus?: number,
): DownloadOutcome => ({ ok: false, code, message, httpStatus });

const dirnameOf = (path: string): string =>
  path.substring(0, path.lastIndexOf('/'));

async function cleanupStaging(stagingPath: string): Promise<void> {
  try {
    await RNFS.unlink(stagingPath);
  } catch {
    // Missing staging file is the normal case; anything else is best-effort.
  }
}

/** Where a download comes from and where it lands, staged and final. */
export interface DownloadTarget {
  source: DownloadSource;
  stagingPath: string;
  finalPath: string;
}

async function attemptDownload(
  target: DownloadTarget,
  opts: DownloadOptions,
): Promise<DownloadOutcome> {
  const { source, stagingPath, finalPath } = target;
  await RNFS.mkdir(dirnameOf(stagingPath));
  await RNFS.mkdir(dirnameOf(finalPath));
  await cleanupStaging(stagingPath);

  let contentLengthFromServer = 0;
  const { jobId, promise } = RNFS.downloadFile({
    fromUrl: source.url,
    toFile: stagingPath,
    headers: source.headers,
    progressDivider: 5,
    begin: (res: { contentLength: number }) => {
      contentLengthFromServer = res.contentLength;
    },
    progress: (res: { bytesWritten: number; contentLength: number }) => {
      opts.onProgress?.(res.bytesWritten, res.contentLength);
    },
  });

  const onAbort = () => RNFS.stopDownload(jobId);
  if (opts.signal?.aborted) {
    // The signal aborted before we could listen — an aborted signal never
    // fires 'abort' again, so stop the job directly.
    onAbort();
  } else {
    opts.signal?.addEventListener('abort', onAbort, { once: true });
  }

  let statusCode: number;
  try {
    const result = await promise;
    statusCode = result.statusCode;
  } catch (error) {
    if (opts.signal?.aborted) {
      return failure('cancelled', 'download cancelled');
    }
    return failure(
      'network-error',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }

  if (opts.signal?.aborted) {
    return failure('cancelled', 'download cancelled');
  }
  if (statusCode < 200 || statusCode >= 300) {
    return failure('http-error', `HTTP ${statusCode}`, statusCode);
  }

  // Length check: prefer the source's declared size, fall back to the
  // server's content-length when it sent one.
  const stat = await RNFS.stat(stagingPath);
  const actualSize = Number(stat.size);
  const expectedSize = source.expectedSizeBytes ?? contentLengthFromServer;
  if (expectedSize > 0 && actualSize !== expectedSize) {
    return failure(
      'length-mismatch',
      `downloaded ${actualSize} bytes, expected ${expectedSize}`,
    );
  }

  const actualHash = (await RNFS.hash(stagingPath, 'sha256')).toLowerCase();
  if (actualHash !== source.expectedSha256.toLowerCase()) {
    return failure(
      'checksum-mismatch',
      `SHA-256 ${actualHash} does not match expected ${source.expectedSha256}`,
    );
  }

  try {
    await RNFS.moveFile(stagingPath, finalPath);
  } catch (error) {
    return failure(
      'move-failed',
      error instanceof Error ? error.message : String(error),
    );
  }

  return {
    ok: true,
    path: finalPath,
    sha256: actualHash,
    sizeBytes: actualSize,
  };
}

/**
 * Download `target.source.url` to `target.stagingPath`, verify its length
 * and SHA-256, then atomically move it to `target.finalPath`. Retries
 * transient failures (network/length/checksum errors, 5xx responses) with
 * exponential backoff and full jitter; staging is cleaned up on final
 * failure.
 */
export async function downloadFileWithIntegrityCheck(
  target: DownloadTarget,
  opts: DownloadOptions = {},
): Promise<DownloadOutcome> {
  const { stagingPath } = target;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseBackoffMs = opts.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;

  let outcome: DownloadOutcome = failure(
    'network-error',
    'download never attempted',
  );

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts.signal?.aborted) {
      outcome = failure('cancelled', 'download cancelled');
      break;
    }
    if (attempt > 0) {
      // Exponential backoff with full jitter.
      const backoff =
        baseBackoffMs * 2 ** (attempt - 1) * (0.5 + Math.random() / 2);
      await delay(backoff, opts.signal);
      if (opts.signal?.aborted) {
        outcome = failure('cancelled', 'download cancelled');
        break;
      }
    }

    outcome = await attemptDownload(target, opts);
    if (outcome.ok || !isRetryable(outcome)) {
      break;
    }
    logger.warn(
      `[FileDownload] Attempt ${attempt + 1}/${maxAttempts} for ${
        target.finalPath
      } failed (${outcome.code}); ${
        attempt + 1 < maxAttempts ? 'retrying' : 'giving up'
      }`,
    );
  }

  if (!outcome.ok) {
    await cleanupStaging(stagingPath);
  }
  return outcome;
}

export type {
  DownloadErrorCode,
  DownloadOptions,
  DownloadOutcome,
  DownloadSource,
} from './types';
