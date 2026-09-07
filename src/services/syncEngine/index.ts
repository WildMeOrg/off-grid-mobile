import RNFS from 'react-native-fs';
import { GANESHA_PROJECT_ID } from '../../config/ganeshaApi';
import { ganeshaApiClient } from '../ganeshaApiClient';
import { packManager } from '../packManager';
import { useWildlifeStore } from '../../stores/wildlifeStore';
import type { Detection, Observation } from '../../types';
import logger from '../../utils/logger';
import type { SyncAllResult, SyncObservationResult } from './types';

/**
 * Drains the local, durable (SQLite-backed) sync queue into the Ganesha
 * backend: uploads each reviewed detection's cropped photo to Blob Storage,
 * then POSTs the match decision to `POST /projects/{project_id}/submissions`
 * (backend/function_app.py `submit_field_observation`).
 *
 * What actually gets submitted, and why -- read before changing this file:
 *
 * - An observation can hold several detections (several elephants in one
 *   photo), each reviewed independently and asynchronously (capture and
 *   review are separate steps -- MatchReviewScreen). `sync_queue` only
 *   tracks one coarse status per *observation*, so an observation is only
 *   considered ready once none of its detections are still
 *   `reviewStatus: 'pending'` -- see `isReadyToSync`. A still-pending
 *   detection is not an error, just not decided yet; the observation is
 *   left alone (sync_queue untouched) until the next sync attempt.
 * - Detections approved against a pack individual are submitted as matches.
 *   "No Match" detections carry their local `FIELD-*` id as a provisional
 *   review key, never as an official `elephantId`; original photo, crop,
 *   candidates, box, GPS, notes, and timestamps are preserved remotely.
 * - Per-detection `ganeshaSubmissionId` (schema v2) makes retries
 *   idempotent: if an observation has 3 eligible detections and the 2nd
 *   upload fails, the 1st's submission id is already persisted, so retrying
 *   only resubmits the 2nd and 3rd, never duplicates the 1st.
 */

const MAX_RETRIES_BEFORE_PERMANENT_FAILURE = 5;

function isPackMatch(detection: Detection): boolean {
  const { approvedIndividual, topCandidates } = detection.matchResult;
  if (!approvedIndividual) {
    return false;
  }
  return topCandidates.some(
    (candidate) => candidate.individualId === approvedIndividual && candidate.source === 'pack',
  );
}

function isProvisionalIndividual(detection: Detection): boolean {
  return detection.matchResult.approvedIndividual?.startsWith('FIELD-') ?? false;
}

/**
 * Detections still eligible to be (re)submitted: reviewed and approved
 * (against either a pack individual or a provisional `FIELD-*` id), and not
 * already carrying a Ganesha submission id from a prior attempt. Exported for
 * reuse by the shared observation-presentation-status derivation, which needs
 * the same "anything left to upload?" answer without duplicating the rules.
 */
export function eligibleDetections(observation: Observation): Detection[] {
  return observation.detections.filter(
    (detection) =>
      detection.matchResult.reviewStatus === 'approved' &&
      !detection.ganeshaSubmissionId &&
      (isPackMatch(detection) || isProvisionalIndividual(detection)),
  );
}

/**
 * Every Ganesha submission id already recorded across this observation's
 * detections. Exported for reuse by the shared observation-presentation
 * status derivation to distinguish a real backend receipt ("Received by
 * EleBook") from a `synced` queue row that never actually submitted anything
 * ("Complete locally", e.g. every detection was rejected).
 */
export function allSubmissionIds(observation: Observation): string[] {
  return observation.detections
    .map((detection) => detection.ganeshaSubmissionId)
    .filter((id): id is string => id !== null);
}

async function uploadPhoto(filePath: string, filename: string): Promise<{ blobUrl: string }> {
  const uploadUrlResult = await ganeshaApiClient.getUploadUrl(GANESHA_PROJECT_ID, filename);
  if (!uploadUrlResult.ok) {
    throw new Error(`upload-url request failed: ${uploadUrlResult.message}`);
  }

  // NOT `fetch(uri).blob()` -- React Native's fetch routes through the native
  // OkHttp networking stack on Android, which does not support the `file://`
  // scheme (produces a misleading "Network request failed", not a clear
  // "unsupported scheme" error). RNFS.uploadFiles streams the file directly
  // from disk; `binaryStreamOnly: true` sends the raw file bytes as the
  // request body with no multipart wrapping, matching Azure Blob's PUT Blob
  // contract (which requires the body to be exactly the blob's bytes).
  let uploadResult: { statusCode: number };
  try {
    const { promise } = RNFS.uploadFiles({
      toUrl: uploadUrlResult.data.uploadUrl,
      method: 'PUT',
      binaryStreamOnly: true,
      files: [
        {
          name: 'file',
          filename,
          filepath: filePath,
          filetype: 'image/jpeg',
        },
      ],
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'Content-Type': 'image/jpeg',
      },
    });
    uploadResult = await promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`blob upload failed: ${message}`);
  }

  if (uploadResult.statusCode < 200 || uploadResult.statusCode >= 300) {
    throw new Error(`blob upload failed: HTTP ${uploadResult.statusCode}`);
  }

  return { blobUrl: uploadUrlResult.data.blobUrl };
}

async function resolveApprovedIndividualName(
  detection: Detection,
): Promise<string | null> {
  const approvedIndividual = detection.matchResult.approvedIndividual;
  if (!approvedIndividual) {
    return null;
  }

  for (const pack of useWildlifeStore.getState().packs) {
    try {
      const individuals = await packManager.loadPackIndex(pack.indexFile);
      const individual = individuals.find(
        (candidate) => candidate.id === approvedIndividual,
      );
      if (individual) {
        return individual.name;
      }
    } catch (error) {
      logger.warn(
        `[SyncEngine] Failed to resolve individual names from pack ${pack.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return null;
}

async function submitDetectionEvidence(
  observation: Observation,
  detection: Detection,
  sourceImageUrl: string | null,
): Promise<string> {
  const { blobUrl } = await uploadPhoto(detection.croppedImageUri, `${detection.id}.jpg`);
  const provisional = isProvisionalIndividual(detection);
  const approvedIndividual = detection.matchResult.approvedIndividual;
  const approvedCandidate = detection.matchResult.topCandidates.find(
    (candidate) => candidate.individualId === approvedIndividual,
  );
  const elephantName = provisional ? null : await resolveApprovedIndividualName(detection);

  const submitResult = await ganeshaApiClient.submitObservation(GANESHA_PROJECT_ID, {
    imageUrl: blobUrl,
    sourceImageUrl,
    elephantId: provisional ? null : approvedIndividual,
    provisionalId: provisional ? approvedIndividual : null,
    reviewDecision: provisional ? 'unknown' : 'matched',
    elephantName,
    confidence: approvedCandidate?.score ?? null,
    alternatives: detection.matchResult.topCandidates,
    detectedSpecies: detection.species,
    detectorConfidence: detection.speciesConfidence,
    boundingBox: detection.boundingBox,
    lat: observation.gps?.lat ?? null,
    long: observation.gps?.lon ?? null,
    observationDate: observation.timestamp,
    observationNotes: observation.fieldNotes,
    captureTimestamp: observation.timestamp,
    deviceModel: observation.deviceInfo.model,
    deviceOs: observation.deviceInfo.os,
  });

  if (!submitResult.ok) {
    throw new Error(`submission request failed: ${submitResult.message}`);
  }
  return submitResult.data.submissionId;
}

/**
 * Attempts to sync one observation. Safe to call repeatedly (e.g. on every
 * "Sync All" tap, or a reconnect) -- already-submitted detections and
 * already-`synced` observations are cheap no-ops.
 */
export async function syncObservation(observation: Observation): Promise<SyncObservationResult> {
  const store = useWildlifeStore.getState();
  const observationId = observation.id;

  const hasUnreviewedDetections = observation.detections.some(
    (detection) => detection.matchResult.reviewStatus === 'pending',
  );
  if (hasUnreviewedDetections) {
    return { observationId, status: 'waiting-for-review' };
  }

  const toSubmit = eligibleDetections(observation);
  if (toSubmit.length === 0) {
    // Either every eligible detection was already submitted on a prior
    // attempt, or none are eligible yet (all rejected / all local-only) --
    // either way, there is nothing left this sync engine can do right now.
    const currentItem = useWildlifeStore.getState().syncQueue.find((item) => item.observationId === observationId);
    if (currentItem && currentItem.status !== 'synced') {
      await store.updateSyncStatus(observationId, {
        status: 'synced',
        syncedAt: new Date().toISOString(),
        wildbookEncounterIds: allSubmissionIds(observation),
        lastError: null,
      });
    }
    return { observationId, status: 'synced', submittedCount: 0 };
  }

  await store.updateSyncStatus(observationId, { status: 'uploading' });

  let submittedCount = 0;
  let sourceImageUrl: string | null = null;
  for (const detection of toSubmit) {
    try {
      if (isProvisionalIndividual(detection) && sourceImageUrl === null) {
        const sourceUpload = await uploadPhoto(
          observation.photoUri,
          `${observation.id}-source.jpg`,
        );
        sourceImageUrl = sourceUpload.blobUrl;
      }
      const submissionId = await submitDetectionEvidence(
        observation,
        detection,
        sourceImageUrl,
      );
      await store.updateDetection(observationId, detection.id, { ganeshaSubmissionId: submissionId });
      submittedCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[SyncEngine] Failed to sync detection ${detection.id} of observation ${observationId}: ${message}`);

      // Read fresh, current state for the retry count -- `store` above is a
      // snapshot from function entry, taken before this function's own
      // 'uploading' status write, and must not be reused for reads here.
      const currentItem = useWildlifeStore.getState().syncQueue.find((item) => item.observationId === observationId);
      const retryCount = (currentItem?.retryCount ?? 0) + 1;
      await store.updateSyncStatus(observationId, {
        status: retryCount >= MAX_RETRIES_BEFORE_PERMANENT_FAILURE ? 'failedPermanent' : 'failed',
        retryCount,
        lastError: message,
        lastAttempt: new Date().toISOString(),
      });
      return { observationId, status: 'failed', submittedCount, message };
    }
  }

  // Re-read the observation from the store after the loop above -- `store`
  // (and the `observation` parameter) were both captured before this
  // function's own updateDetection() calls, so their `.detections` are now
  // stale; a fresh getState() reflects every id just written.
  const refreshedObservation =
    useWildlifeStore.getState().observations.find((obs) => obs.id === observationId) ?? observation;
  await store.updateSyncStatus(observationId, {
    status: 'synced',
    syncedAt: new Date().toISOString(),
    wildbookEncounterIds: allSubmissionIds(refreshedObservation),
    lastError: null,
  });

  return { observationId, status: 'synced', submittedCount };
}

/**
 * Syncs every observation currently queued (status `pending` or `failed`),
 * sequentially -- not in parallel, since field connectivity is often a
 * single flaky link and a batch of concurrent uploads would just contend
 * with each other. Skips observations already `uploading` (a sync is
 * already in flight for them) or `synced`.
 */
export async function syncAllObservations(): Promise<SyncAllResult> {
  const result: SyncAllResult = { synced: 0, uploaded: 0, waitingForReview: 0, failed: 0 };
  const { observations, syncQueue } = useWildlifeStore.getState();

  const queued = syncQueue.filter((item) => item.status === 'pending' || item.status === 'failed' || item.status === 'failedPermanent');

  for (const queueItem of queued) {
    const observation = observations.find((obs) => obs.id === queueItem.observationId);
    if (!observation) {
      continue;
    }
    const outcome = await syncObservation(observation);
    if (outcome.status === 'synced') {
      result.synced += 1;
      result.uploaded += outcome.submittedCount;
    } else if (outcome.status === 'waiting-for-review') {
      result.waitingForReview += 1;
    } else {
      result.failed += 1;
      result.uploaded += outcome.submittedCount;
    }
  }

  return result;
}

export type { SyncAllResult, SyncObservationResult, SyncObservationOutcome } from './types';
