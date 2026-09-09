import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { downloadFileWithIntegrityCheck } from '../fileDownloadService';
import type { DownloadOptions } from '../fileDownloadService';
import type { LatestPackInfo } from '../ganeshaApiClient/types';
import { packManager } from '../packManager';
import { useWildlifeStore } from '../../stores/wildlifeStore';
import type { EmbeddingPackManifest } from '../../types';
import type { PackAcquisitionOutcome } from './types';
import logger from '../../utils/logger';

type PackAcquisitionFailure = Extract<
  PackAcquisitionOutcome,
  { ok: false }
>;

export type PreparedPack =
  | {
      ok: true;
      extractDir: string;
      manifest: EmbeddingPackManifest;
      artifactSha256: string;
      sizeBytes: number;
    }
  | { ok: false; failure: PackAcquisitionFailure };

interface PreparePackCandidateOptions {
  projectId: string;
  info: LatestPackInfo;
  packSha256: string;
  downloadOptions: DownloadOptions;
}

const packDownloadsDir = () => `${RNFS.DocumentDirectoryPath}/pack_downloads`;
const stagingDir = () => `${RNFS.DocumentDirectoryPath}/staging`;

const MAX_IDENTITY_CODE_UNITS = 40;
/**
 * Hex digits of SHA-256 kept per directory segment. 64 bits is ample for the handful of
 * projects and versions one device ever holds, and keeps the whole pack path short.
 *
 * Directory names are digests rather than encoded identities on purpose. Native code such as
 * ONNX Runtime opens pack files by absolute path, and on BlueStacks (Android 9 x86_64 running
 * the arm64 app through its ARM translation layer) a 290-byte detector path failed with ENOENT
 * while the Java file APIs saw the file; the same build for x86_64 loaded it. Encoding a
 * 40-code-unit identity took 160 characters per level, so paths approached the 255-byte
 * filename-component limit as well.
 */
const PATH_DIGEST_HEX_DIGITS = 16;

const validatePathIdentity = (value: string, label: string): string => {
  if (!value || value.length > MAX_IDENTITY_CODE_UNITS) {
    throw new Error(
      `${label} must contain 1-${MAX_IDENTITY_CODE_UNITS} UTF-16 code units`,
    );
  }
  return value;
};

/** Lossless UTF-16 code-unit encoding, so distinct identities (even malformed ones) never digest alike. */
const utf16Hex = (value: string): string => {
  let encoded = '';
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return encoded;
};

const pathDigest = (...parts: string[]): string =>
  bytesToHex(sha256(utf8ToBytes(parts.join('\n')))).slice(0, PATH_DIGEST_HEX_DIGITS);

const artifactPathKey = (
  version: string,
  sha256Hex: string,
): string =>
  `v-${pathDigest(utf16Hex(validatePathIdentity(version, 'pack version')), sha256Hex)}`;

const projectPathKey = (projectId: string): string =>
  `p-${pathDigest(utf16Hex(validatePathIdentity(projectId, 'project ID')))}`;

const zipStagingPathFor = (
  projectId: string,
  version: string,
  sha256Hex: string,
) =>
  `${stagingDir()}/${projectPathKey(projectId)}/${artifactPathKey(
    version,
    sha256Hex,
  )}.zip.part`;

const zipFinalPathFor = (
  projectId: string,
  version: string,
  sha256Hex: string,
) =>
  `${packDownloadsDir()}/${projectPathKey(projectId)}/${artifactPathKey(
    version,
    sha256Hex,
  )}.zip`;

const extractDirFor = (
  projectId: string,
  version: string,
  sha256Hex: string,
) =>
  `${packManager.getPacksDir()}/${projectPathKey(projectId)}/${artifactPathKey(
    version,
    sha256Hex,
  )}`;

const failure = (
  code: PackAcquisitionFailure['code'],
  message: string,
): PackAcquisitionFailure => ({ ok: false, code, message });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const normalizedSha256 = (value: string): string | null => {
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
};

export async function removeIfExists(path: string): Promise<void> {
  try {
    if (await RNFS.exists(path)) {
      await RNFS.unlink(path);
    }
  } catch (error) {
    logger.warn(
      `[PackDownload] Failed to remove ${path}: ${errorMessage(error)}`,
    );
  }
}

async function clearStaleCandidate(path: string): Promise<void> {
  if (!(await RNFS.exists(path))) {
    return;
  }
  const activePath = useWildlifeStore
    .getState()
    .packs.some(pack => pack.packDir === path);
  if (activePath) {
    throw new Error(`refusing to remove active pack directory ${path}`);
  }
  await RNFS.unlink(path);
}

function unregisteredCandidateDir(baseDir: string): string {
  const registeredDirs = new Set(useWildlifeStore.getState().packs.map(pack => pack.packDir));
  let candidateDir = baseDir;
  let attempt = 0;
  while (registeredDirs.has(candidateDir)) {
    attempt += 1;
    candidateDir = `${baseDir}-repair-${attempt}`;
  }
  return candidateDir;
}

export async function preparePackCandidate({
  projectId,
  info,
  packSha256,
  downloadOptions,
}: PreparePackCandidateOptions): Promise<PreparedPack> {
  let zipStaging: string;
  let zipFinal: string;
  let extractDir: string;
  try {
    await RNFS.mkdir(packDownloadsDir());
    zipStaging = zipStagingPathFor(projectId, info.version, packSha256);
    zipFinal = zipFinalPathFor(projectId, info.version, packSha256);
    extractDir = unregisteredCandidateDir(extractDirFor(projectId, info.version, packSha256));
  } catch (error) {
    return {
      ok: false,
      failure: failure('metadata-invalid', errorMessage(error)),
    };
  }

  const downloadOutcome = await downloadFileWithIntegrityCheck(
    {
      source: {
        url: info.downloadUrl,
        expectedSha256: packSha256,
        expectedSizeBytes: info.sizeBytes,
      },
      stagingPath: zipStaging,
      finalPath: zipFinal,
    },
    downloadOptions,
  );
  if (!downloadOutcome.ok) {
    return { ok: false, failure: downloadOutcome };
  }

  try {
    await packManager.initialize();
    await RNFS.mkdir(
      `${packManager.getPacksDir()}/${projectPathKey(projectId)}`,
    );
    await clearStaleCandidate(extractDir);
  } catch (error) {
    await removeIfExists(downloadOutcome.path);
    return { ok: false, failure: failure('filesystem-error', errorMessage(error)) };
  }
  try {
    await unzip(downloadOutcome.path, extractDir);
  } catch (error) {
    await removeIfExists(downloadOutcome.path);
    await removeIfExists(extractDir);
    return { ok: false, failure: failure('unzip-failed', errorMessage(error)) };
  }
  await removeIfExists(downloadOutcome.path);

  let validation;
  try {
    validation = await packManager.installPack(extractDir);
  } catch (error) {
    await removeIfExists(extractDir);
    return {
      ok: false,
      failure: failure('unexpected-error', errorMessage(error)),
    };
  }
  if (!validation.ok) {
    await removeIfExists(extractDir);
    return {
      ok: false,
      failure: failure(
        'validation-failed',
        validation.errors.map(item => `${item.code}: ${item.detail}`).join('; '),
      ),
    };
  }
  return {
    ok: true,
    extractDir,
    manifest: validation.manifest,
    artifactSha256: packSha256,
    sizeBytes: downloadOutcome.sizeBytes,
  };
}