import RNFS from 'react-native-fs';
import { ganeshaApiClient } from '../ganeshaApiClient';
import type { DownloadOptions } from '../fileDownloadService';
import { resolvePackFile } from '../packManager/validator';
import { checkEmbeddingModelCompatibility } from '../miewidModelManager';
import type { LatestPackInfo } from '../ganeshaApiClient/types';
import { useWildlifeStore } from '../../stores/wildlifeStore';
import type {
  EmbeddingPack,
  MiewIDModelRecord,
} from '../../types';
import type {
  PackAcquisitionOutcome,
  PackUpdateCheckOutcome,
} from './types';
import {
  normalizedSha256,
  preparePackCandidate,
  removeIfExists,
} from './candidate';
import type { PreparedPack } from './candidate';
import logger from '../../utils/logger';

/**
 * Fetches the latest embedding pack for a project from the Ganesha backend
 * (`GET /projects/{project_id}/packs/latest`), downloads the zip with the
 * same retry/checksum/atomic-move guarantees `modelDownloadService`
 * established (shared via `fileDownloadService`), unzips it, validates +
 * installs it via `packManager`, and registers the result in the wildlife
 * store. Each version uses a distinct directory, so the active pack remains
 * usable until its replacement passes full validation. One pack per project
 * is active in the store; older version directories remain available for
 * rollback.
 */

async function activateArtifacts(
  pack: EmbeddingPack,
  model: MiewIDModelRecord,
): Promise<void> {
  const previous = useWildlifeStore.getState();
  const previousPacks = previous.packs;
  const previousModel = previous.miewidModel;
  const nextPacks = [...previousPacks.filter(item => item.id !== pack.id), pack];
  try {
    await Promise.resolve(
      useWildlifeStore.setState({
        packs: nextPacks,
        miewidModel: model,
      }),
    );
  } catch (error) {
    try {
      await Promise.resolve(
        useWildlifeStore.setState({
          packs: previousPacks,
          miewidModel: previousModel,
        }),
      );
    } catch (rollbackError) {
      logger.error(
        '[PackDownload] Failed to persist activation rollback:',
        rollbackError,
      );
    }
    throw error;
  }
}

type PackAcquisitionFailure = Extract<
  PackAcquisitionOutcome,
  { ok: false }
>;

const failure = (
  code: PackAcquisitionFailure['code'],
  message: string,
): PackAcquisitionFailure => ({ ok: false, code, message });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const modelSupportsPack = (
  model: MiewIDModelRecord | null | undefined,
  packModelVersion: string,
): model is MiewIDModelRecord =>
  model?.status === 'ready' &&
  checkEmbeddingModelCompatibility(model.version, packModelVersion) ===
    'compatible';

export async function checkLatestPackStatus(
  projectId: string,
  installedPack?: EmbeddingPack,
): Promise<PackUpdateCheckOutcome> {
  try {
    const resolved = await ganeshaApiClient.getLatestPack(projectId);
    if (!resolved.ok) {
      return resolved;
    }
    const latestSha256 = normalizedSha256(resolved.data.sha256);
    if (!latestSha256) {
      return {
        ok: false,
        code: 'metadata-invalid',
        message: 'Latest pack metadata contains an invalid SHA-256',
      };
    }
    return {
      ok: true,
      isLatest:
        installedPack?.status === 'ready' &&
        installedPack.packVersion === resolved.data.version &&
        installedPack.artifactSha256?.toLowerCase() === latestSha256,
      latestVersion: resolved.data.version,
    };
  } catch (error) {
    return {
      ok: false,
      code: 'unexpected-error',
      message: errorMessage(error),
    };
  }
}

interface CurrentPackContext {
  installedPack: EmbeddingPack | undefined;
  latestVersion: string;
  latestSha256: string;
  activationModel: MiewIDModelRecord | null | undefined;
  preparedModel: MiewIDModelRecord | undefined;
}

async function resolveCurrentPack({
  installedPack,
  latestVersion,
  latestSha256,
  activationModel,
  preparedModel,
}: CurrentPackContext,
): Promise<PackAcquisitionOutcome | null> {
  if (
    installedPack?.status !== 'ready' ||
    installedPack.packVersion !== latestVersion ||
    installedPack.artifactSha256?.toLowerCase() !== latestSha256 ||
    !(await RNFS.exists(installedPack.packDir))
  ) {
    return null;
  }
  if (!modelSupportsPack(activationModel, installedPack.embeddingModelVersion)) {
    return failure(
      'model-incompatible',
      'The ready model is incompatible with the latest pack',
    );
  }
  if (preparedModel && preparedModel !== useWildlifeStore.getState().miewidModel) {
    try {
      await activateArtifacts(installedPack, preparedModel);
    } catch (error) {
      return failure('activation-failed', errorMessage(error));
    }
  }
  return { ok: true, pack: installedPack };
}

async function buildPackRecord(
  projectId: string,
  info: LatestPackInfo,
  prepared: Extract<PreparedPack, { ok: true }>,
): Promise<EmbeddingPack> {
  const { extractDir, manifest } = prepared;
  const [detectorModelFile, embeddingsFile, indexFile] = await Promise.all([
    resolvePackFile(extractDir, manifest.detectorModel.filename),
    resolvePackFile(extractDir, 'embeddings.bin'),
    resolvePackFile(extractDir, 'index.json'),
  ]);
  if (!detectorModelFile || !embeddingsFile || !indexFile) {
    throw new Error('Pack file references are missing or unsafe');
  }
  return {
    id: projectId,
    packVersion: info.version,
    artifactSha256: prepared.artifactSha256,
    species: manifest.species,
    featureClass: manifest.featureClass,
    displayName: info.displayName ?? manifest.displayName,
    wildbookInstanceUrl: manifest.wildbookInstanceUrl,
    exportDate: manifest.exportDate,
    individualCount: manifest.individualCount,
    embeddingDim: manifest.embeddingDim,
    embeddingModelVersion: manifest.embeddingModel.version,
    detectorModelFile,
    embeddingsFile,
    indexFile,
    referencePhotosDir: `${extractDir}/reference_photos`,
    packDir: extractDir,
    downloadedAt: new Date().toISOString(),
    sizeBytes: prepared.sizeBytes,
    status: 'ready',
    validatedAt: new Date().toISOString(),
  };
}

async function acquireLatestPackInternal(
  projectId: string,
  opts: DownloadOptions = {},
  preparedModel?: MiewIDModelRecord,
): Promise<PackAcquisitionOutcome> {
  const resolved = await ganeshaApiClient.getLatestPack(projectId);
  if (!resolved.ok) {
    return resolved;
  }
  const info = resolved.data;
  const packSha256 = normalizedSha256(info.sha256);
  if (!packSha256) {
    return failure(
      'metadata-invalid',
      'Latest pack metadata contains an invalid SHA-256',
    );
  }
  const activationModel =
    preparedModel ?? useWildlifeStore.getState().miewidModel;
  const installedPack = useWildlifeStore
    .getState()
    .packs.find(pack => pack.id === projectId);
  const currentPackResult = await resolveCurrentPack({
    installedPack,
    latestVersion: info.version,
    latestSha256: packSha256,
    activationModel,
    preparedModel,
  });
  if (currentPackResult) {
    return currentPackResult;
  }

  const candidate = await preparePackCandidate({
    projectId,
    info,
    packSha256,
    downloadOptions: opts,
  });
  if (!candidate.ok) {
    return candidate.failure;
  }

  if (!modelSupportsPack(activationModel, candidate.manifest.embeddingModel.version)) {
    await removeIfExists(candidate.extractDir);
    return failure(
      'model-incompatible',
      'The ready model is incompatible with the downloaded pack',
    );
  }
  let pack: EmbeddingPack;
  try {
    pack = await buildPackRecord(projectId, info, candidate);
  } catch (error) {
    await removeIfExists(candidate.extractDir);
    return failure('unexpected-error', errorMessage(error));
  }

  try {
    await activateArtifacts(pack, activationModel);
  } catch (error) {
    await removeIfExists(candidate.extractDir);
    return failure('activation-failed', errorMessage(error));
  }
  logger.log(
    `[PackDownload] Installed pack ${pack.id} (${pack.individualCount} individuals) at ${candidate.extractDir}`,
  );
  return { ok: true, pack };
}

export async function acquireLatestPack(
  projectId: string,
  opts: DownloadOptions = {},
  preparedModel?: MiewIDModelRecord,
): Promise<PackAcquisitionOutcome> {
  try {
    return await acquireLatestPackInternal(projectId, opts, preparedModel);
  } catch (error) {
    logger.error('[PackDownload] Unexpected acquisition failure:', error);
    return {
      ok: false,
      code: 'unexpected-error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export type {
  PackAcquisitionOutcome,
  PackAcquisitionErrorCode,
  PackUpdateCheckOutcome,
} from './types';
