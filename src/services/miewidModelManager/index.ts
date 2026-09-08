import RNFS from 'react-native-fs';
import type { MiewIDModelRecord } from '../../types';
import type { ModelSource } from '../../config/modelSources';
import { modelDownloadService } from '../modelDownloadService';
import type { DownloadOptions } from '../modelDownloadService';
import { useWildlifeStore } from '../../stores/wildlifeStore';
import logger from '../../utils/logger';

export type EmbeddingModelCompatibility = 'compatible' | 'incompatible';

/**
 * Normalize a semantic model version while allowing an optional `v` prefix
 * and an omitted patch component.
 */
function normalizeModelVersion(version: string): string | null {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version.trim());
  if (!match) {
    return null;
  }
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3] ?? 0)}`;
}

/**
 * Gate a pack's embedding-model version against the installed MiewID model.
 *
 * Any semantic version mismatch, including a patch mismatch or an unknown
 * legacy version, is incompatible. Matching across unverified embedding
 * spaces can produce plausible but meaningless candidates.
 */
export function checkEmbeddingModelCompatibility(
  modelVersion: string,
  packVersion: string,
): EmbeddingModelCompatibility {
  const model = normalizeModelVersion(modelVersion);
  const pack = normalizeModelVersion(packVersion);
  if (!model || !pack) {
    return 'incompatible';
  }
  return model === pack ? 'compatible' : 'incompatible';
}

const candidateRecord = (
  source: ModelSource,
  overrides: Partial<MiewIDModelRecord> = {},
): MiewIDModelRecord => ({
  path: '',
  name: source.name,
  version: source.version,
  sha256: source.expectedSha256 || null,
  sizeBytes: source.expectedSizeBytes ?? null,
  status: 'downloading',
  verifiedAt: null,
  format: source.format,
  ...overrides,
});

/** Download and verify a model candidate without changing the active model. */
export async function prepareMiewidModel(
  source: ModelSource,
  opts: DownloadOptions = {},
): Promise<MiewIDModelRecord> {
  let outcome;
  try {
    outcome = await modelDownloadService.downloadModel(source, opts);
  } catch (error) {
    logger.error('[MiewIDModelManager] Model preparation threw:', error);
    return candidateRecord(source, { status: 'missing' });
  }

  if (outcome.ok) {
    return candidateRecord(source, {
      path: outcome.path,
      sha256: outcome.sha256,
      sizeBytes: outcome.sizeBytes,
      status: 'ready',
      verifiedAt: new Date().toISOString(),
    });
  }
  if (outcome.code === 'checksum-mismatch') {
    logger.error(
      `[MiewIDModelManager] Downloaded model failed verification: ${outcome.message}`,
    );
    return candidateRecord(source, { status: 'corrupt' });
  }
  logger.warn(
    `[MiewIDModelManager] Model preparation failed (${outcome.code}): ${outcome.message}`,
  );
  return candidateRecord(source, { status: 'missing' });
}

/**
 * Download, verify, and register the MiewID model. The store record tracks
 * progress: 'downloading' while in flight, then 'ready' (verified),
 * 'corrupt' (integrity failure), or 'missing' (cancelled / unreachable).
 * This is the production writer of the model record — Settings and
 * first-run flows call this.
 */
export async function acquireMiewidModel(
  source: ModelSource,
  opts: DownloadOptions = {},
): Promise<MiewIDModelRecord> {
  const { setMiewidModel } = useWildlifeStore.getState();

  const downloading = candidateRecord(source);
  setMiewidModel(downloading);

  const record = await prepareMiewidModel(source, opts);
  setMiewidModel(record);
  return record;
}

/**
 * Reconcile a persisted MiewID model record against the filesystem.
 *
 * Called on app startup after store hydration. Cheap by default: a record
 * that has already been hash-verified (`verifiedAt` set) only gets an
 * existence + size check; the full SHA-256 (1-2s for a ~100 MB model) runs
 * once after download or for legacy records that never recorded a hash.
 */
export async function reconcileMiewidModel(
  record: MiewIDModelRecord | null,
): Promise<MiewIDModelRecord | null> {
  if (!record) {
    return null;
  }

  // An app killed mid-download leaves a dangling 'downloading' status; the
  // staging file (if any) is owned by the download service, not this record.
  if (record.status === 'downloading') {
    return { ...record, status: 'missing' };
  }

  try {
    if (!(await RNFS.exists(record.path))) {
      return { ...record, status: 'missing' };
    }

    const stat = await RNFS.stat(record.path);
    const actualSize = Number(stat.size);

    if (record.sizeBytes != null && actualSize !== record.sizeBytes) {
      logger.warn(
        `[MiewIDModelManager] Size mismatch for ${record.path}: expected ${record.sizeBytes}, found ${actualSize}`,
      );
      return { ...record, status: 'corrupt' };
    }

    if (record.sha256 != null) {
      if (record.verifiedAt != null) {
        // Already hash-verified once; size check above is sufficient.
        return { ...record, status: 'ready' };
      }
      const actualHash = await RNFS.hash(record.path, 'sha256');
      if (actualHash.toLowerCase() !== record.sha256.toLowerCase()) {
        logger.warn(
          `[MiewIDModelManager] SHA-256 mismatch for ${record.path}`,
        );
        return { ...record, status: 'corrupt', sizeBytes: actualSize };
      }
      return {
        ...record,
        status: 'ready',
        sizeBytes: actualSize,
        verifiedAt: new Date().toISOString(),
      };
    }

    // Legacy record (migrated from the bare-path format): no expected hash.
    // Require a non-empty file, then backfill identity for future checks.
    if (actualSize <= 0) {
      return { ...record, status: 'corrupt' };
    }
    const computedHash = await RNFS.hash(record.path, 'sha256');
    return {
      ...record,
      status: 'ready',
      sha256: computedHash,
      sizeBytes: actualSize,
      verifiedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(
      `[MiewIDModelManager] Reconciliation failed for ${record.path}:`,
      error,
    );
    return { ...record, status: 'corrupt' };
  }
}
