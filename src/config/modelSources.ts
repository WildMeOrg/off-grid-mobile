import type { ModelFormat } from '../types/wildlife';

/**
 * Per-acquisition model source from GET /models/{model_name}/latest.
 * The API supplies a fresh signed URL and artifact integrity metadata.
 */
export interface ModelSource {
  name: string;
  version: string;
  url: string;
  /** Lowercase hex SHA-256 of the artifact, no prefix. */
  expectedSha256: string;
  expectedSizeBytes?: number;
  /** Extra request headers (e.g. auth for a private HF repo). */
  headers?: Record<string, string>;
  /** Which runtime this artifact needs — see ModelFormat. */
  format: ModelFormat;
}

/** Model name key the backend's `/models/{model_name}/latest` endpoint expects. */
export const MIEWID_MODEL_NAME = 'miewid';

/** Model name key for the Android LiteRT artifact. */
export const MIEWID_LITERT_MODEL_NAME = 'miewid-litert';
