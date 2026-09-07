export type DownloadErrorCode =
  | 'http-error'
  | 'network-error'
  | 'length-mismatch'
  | 'checksum-mismatch'
  | 'cancelled'
  | 'move-failed';

export type DownloadOutcome =
  | { ok: true; path: string; sha256: string; sizeBytes: number }
  | {
      ok: false;
      code: DownloadErrorCode;
      message: string;
      httpStatus?: number;
    };

export interface DownloadOptions {
  onProgress?: (bytesWritten: number, contentLength: number) => void;
  signal?: AbortSignal;
  /** Total attempts including the first (default 3). */
  maxAttempts?: number;
  /** Base for exponential backoff with full jitter (default 1000 ms). */
  baseBackoffMs?: number;
}

/** A file to download, independent of what it will become on disk. */
export interface DownloadSource {
  url: string;
  /** Lowercase hex SHA-256 of the artifact, no prefix. */
  expectedSha256: string;
  expectedSizeBytes?: number;
  /** Extra request headers (e.g. auth for a private HF repo, or a SAS URL that needs none). */
  headers?: Record<string, string>;
}
