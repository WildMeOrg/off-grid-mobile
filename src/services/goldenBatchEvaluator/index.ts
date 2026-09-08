import RNFS from 'react-native-fs';
import DeviceInfo from 'react-native-device-info';
import type { SpeciesConfig } from '../wildlifePipeline/types';
import { buildActiveSpeciesConfigs } from '../speciesConfigBuilder';
import { useWildlifeStore } from '../../stores/wildlifeStore';
import logger from '../../utils/logger';
import { validateGoldenBatchRequest } from './manifest';
import { buildIndividualNameIndex } from './packNameIndex';
import { GoldenBatchResultWriter } from './resultWriter';
import { processItem } from './runItem';
import { summarizeRun } from './scoring';
import { errorMessage } from './errorMessage';
import {
  consumedRequestPath,
  requestPath,
} from './paths';
import {
  DEFAULT_MATCH_THRESHOLD,
  type GoldenBatchManifestItem,
  type GoldenBatchRunRequest,
  type GoldenBatchStatus,
} from './types';

export * from './types';
export { validateGoldenBatchRequest } from './manifest';
export { scoreDetection, summarizeRun } from './scoring';
export { assertEmbeddingDimension, EmbeddingDimensionError } from './embeddingValidation';


/**
 * Debug-only golden batch evaluator entry point -- call once from App.tsx
 * on startup, gated behind `__DEV__` there too (belt-and-suspenders: this
 * function also refuses to run in a release build on its own).
 *
 * No-ops when there is no one-shot request file at `batch/request.json`.
 * Never throws: every failure is caught and logged via `logger.error`
 * (and, once a run has been consumed, recorded in that run's
 * `status.json`) -- a bug in debug tooling must never block the app from
 * becoming usable. This function never calls `addObservation`,
 * `addToSyncQueue`, persists GPS, or performs any network upload; it only
 * reads the currently installed packs/model and writes files under
 * `batch/results/<runId>/`.
 */
export async function runGoldenBatchIfRequested(): Promise<void> {
  if (!__DEV__) {
    return;
  }
  try {
    await runRequestedInner();
  } catch (error) {
    logger.error('[GoldenBatchEvaluator] Unhandled failure:', error);
  }
}

async function runRequestedInner(): Promise<void> {
  const path = requestPath();
  if (!(await RNFS.exists(path))) {
    return;
  }

  let raw: string;
  try {
    raw = await RNFS.readFile(path, 'utf8');
  } catch (error) {
    logger.error('[GoldenBatchEvaluator] Failed to read request file:', error);
    return;
  }

  let parsedRequest: unknown;
  try {
    parsedRequest = JSON.parse(raw);
  } catch (error) {
    logger.error(
      '[GoldenBatchEvaluator] Request file is not valid JSON:',
      error,
    );
    await quarantineRequest(path);
    return;
  }

  const validated = validateGoldenBatchRequest(parsedRequest);
  if (!validated.ok) {
    logger.error(
      '[GoldenBatchEvaluator] Invalid manifest, refusing to run:',
      JSON.stringify(validated.errors),
    );
    await quarantineRequest(path);
    return;
  }

  const { request } = validated;
  const writer = new GoldenBatchResultWriter(request.runId);
  await writer.init();

  // Consume the request atomically (rename onto the same filesystem) BEFORE
  // any processing starts. If the app is killed mid-run, restarting finds
  // no request.json at the watched path, so the run is never re-triggered.
  const consumedPath = consumedRequestPath(request.runId);
  await RNFS.moveFile(path, consumedPath);

  let manifestSha256: string | null = null;
  try {
    manifestSha256 = await RNFS.hash(consumedPath, 'sha256');
  } catch (error) {
    logger.warn(
      '[GoldenBatchEvaluator] Could not hash consumed manifest:',
      error,
    );
  }

  try {
    await executeRun(request, writer, manifestSha256);
  } catch (error) {
    const now = new Date().toISOString();
    const message = `Unhandled batch failure: ${errorMessage(error)}`;
    logger.error(`[GoldenBatchEvaluator] ${message}`);
    await writer.writeStatus({
      runId: request.runId,
      state: 'failed',
      startedAt: now,
      updatedAt: now,
      completedAt: now,
      totalItems: request.items.length,
      processedItems: 0,
      errorItems: 1,
      currentItem: null,
      lastError: message,
    });
  }
}

async function quarantineRequest(path: string): Promise<void> {
  try {
    await RNFS.moveFile(path, `${path}.rejected-${Date.now()}`);
  } catch (error) {
    logger.error(
      '[GoldenBatchEvaluator] Failed to quarantine invalid request file:',
      error,
    );
  }
}

interface ItemScoreInput {
  knownStatus: GoldenBatchManifestItem['knownStatus'];
  expectedStableId: string | null;
  detections: Array<{
    predictedStableId: string | null;
    candidateStableIds: string[];
  }>;
}

async function executeRun(
  request: GoldenBatchRunRequest,
  writer: GoldenBatchResultWriter,
  manifestSha256: string | null,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const matchThreshold = request.matchThreshold ?? DEFAULT_MATCH_THRESHOLD;

  const status: GoldenBatchStatus = {
    runId: request.runId,
    state: 'running',
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
    totalItems: request.items.length,
    processedItems: 0,
    errorItems: 0,
    currentItem: null,
    lastError: null,
  };
  await writer.writeStatus(status);

  const { packs, miewidModel } = useWildlifeStore.getState();

  if (!miewidModel || miewidModel.status !== 'ready') {
    await failRun(
      writer,
      status,
      'MiewID model is not ready; cannot run golden batch evaluation.',
    );
    return;
  }

  let speciesConfigs: SpeciesConfig[];
  let excludedPacks: Array<{ packId: string; reason: string }>;
  try {
    ({ speciesConfigs, excludedPacks } = await buildActiveSpeciesConfigs(
      packs,
      miewidModel,
      [],
    ));
  } catch (error) {
    await failRun(
      writer,
      status,
      `Failed to build species configs from installed packs: ${errorMessage(error)}`,
    );
    return;
  }

  if (speciesConfigs.length === 0) {
    await failRun(
      writer,
      status,
      'No usable packs are installed (all quarantined or embedding-model-incompatible); nothing to match against.',
    );
    return;
  }

  const activePackIds = new Set(
    speciesConfigs.flatMap((config) =>
      config.embeddingDatabase
        .filter((entry) => entry.source === 'pack')
        .map((entry) => entry.individualId),
    ),
  );
  const missingExpectedIds = Array.from(
    new Set(
      request.items
        .filter(
          (item) =>
            item.knownStatus === 'known' &&
            item.expectedStableId !== null &&
            !activePackIds.has(item.expectedStableId),
        )
        .map((item) => item.expectedStableId as string),
    ),
  );
  if (missingExpectedIds.length > 0) {
    await failRun(
      writer,
      status,
      `Known manifest IDs are absent from the active pack database: ${missingExpectedIds.join(', ')}`,
    );
    return;
  }

  const individualNameIndex = await buildIndividualNameIndex(packs);
  const scoreInputs: ItemScoreInput[] = [];

  // Sequential by design: photos share the same loaded detector/embedding
  // model sessions, and results must stream out (and be scoreable) in
  // manifest order for reproducible runs.
  for (let itemIndex = 0; itemIndex < request.items.length; itemIndex += 1) {
    const item = request.items[itemIndex];
    status.currentItem = item.stagedPath;
    status.updatedAt = new Date().toISOString();
    await writer.writeStatus(status);

    const outcome = await processItem({
      runId: request.runId,
      itemIndex,
      item,
      speciesConfigs,
      miewidModelPath: miewidModel.path,
      miewidModelFormat: miewidModel.format,
      individualNameIndex,
      matchThreshold,
      writer,
    });

    scoreInputs.push({
      knownStatus: item.knownStatus,
      expectedStableId: item.expectedStableId,
      detections: outcome.detections,
    });

    status.processedItems += 1;
    if (outcome.errors.length > 0) {
      status.errorItems += 1;
    }
    status.updatedAt = new Date().toISOString();
    await writer.writeStatus(status);
  }

  const summary = {
    ...summarizeRun(scoreInputs, matchThreshold),
    runId: request.runId,
  };

  await writer.writeRunMetadata({
    runId: request.runId,
    requestCreatedAt: request.createdAt,
    startedAt,
    completedAt: new Date().toISOString(),
    matchThreshold,
    excludedPacks,
    manifestSha256,
    app: {
      version: DeviceInfo.getVersion(),
      buildNumber: DeviceInfo.getBuildNumber(),
      bundleId: DeviceInfo.getBundleId(),
    },
    device: {
      model: DeviceInfo.getModel(),
      systemName: DeviceInfo.getSystemName(),
      systemVersion: DeviceInfo.getSystemVersion(),
    },
    model: {
      name: miewidModel.name,
      version: miewidModel.version,
      sha256: miewidModel.sha256,
    },
    packs: packs.map((pack) => ({
      id: pack.id,
      displayName: pack.displayName,
      packVersion: pack.packVersion,
      embeddingModelVersion: pack.embeddingModelVersion,
      individualCount: pack.individualCount,
      status: pack.status ?? 'ready',
    })),
    summary,
  });

  status.state = 'completed';
  status.completedAt = new Date().toISOString();
  status.updatedAt = status.completedAt;
  status.currentItem = null;
  await writer.writeStatus(status);
}

async function failRun(
  writer: GoldenBatchResultWriter,
  status: GoldenBatchStatus,
  message: string,
): Promise<void> {
  logger.error(`[GoldenBatchEvaluator] ${message}`);
  status.state = 'failed';
  status.updatedAt = new Date().toISOString();
  status.completedAt = status.updatedAt;
  status.lastError = message;
  await writer.writeStatus(status);
}
