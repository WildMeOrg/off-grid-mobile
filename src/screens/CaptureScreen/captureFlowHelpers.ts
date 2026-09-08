import { Alert, PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import DeviceInfo from 'react-native-device-info';
import { wildlifePipeline } from '../../services/wildlifePipeline';
import type { SpeciesConfig, PipelineError } from '../../services/wildlifePipeline/types';
import { buildActiveSpeciesConfigs } from '../../services/speciesConfigBuilder';
import {
  persistObservationFiles,
  deleteObservationFiles,
} from '../../services/observationStorage';
import { useWildlifeStore } from '../../stores/wildlifeStore';
import type { MiewIDModelStatus } from '../../types';
import type { EmbeddingPack, MiewIDModelRecord } from '../../types/wildlife';
import logger from '../../utils/logger';

export type DeviceGps = { lat: number; lon: number; accuracy: number } | null;

export interface PhotoCaptureContext {
  gps: DeviceGps;
  deviceInfo: { model: string; os: string };
  miewidModel: MiewIDModelRecord | null;
}

/** Result of running the pipeline for one photo, without alerting or navigating. */
export type PhotoOutcome =
  | { ok: true; observationId: string; errors: PipelineError[] }
  | { ok: false; message: string };

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Below this, further photo/crop writes risk the device running critically low. */
const LOW_STORAGE_WARNING_BYTES = 300 * 1024 * 1024;
const LOW_BATTERY_WARNING_FRACTION = 0.2;

/** Human-readable explanation for each non-ready model status. */
export const MODEL_STATUS_MESSAGES: Record<Exclude<MiewIDModelStatus, 'ready'>, string> = {
  missing:
    'The MiewID embedding model is not installed on this device. Download it from the Packs screen before capturing.',
  downloading:
    'The MiewID embedding model is still downloading. Try again once the download completes.',
  corrupt:
    'The installed MiewID embedding model file is corrupt. Re-download it from the Packs screen.',
  incompatible:
    'The installed MiewID embedding model is incompatible with the loaded packs. Update the model or packs.',
};

/**
 * Attempt to get the device's current GPS coordinates.
 * Returns null if unavailable — GPS is best-effort since the app
 * may be used offline or without location permissions.
 */
export async function getDeviceLocation(): Promise<DeviceGps> {
  try {
    if (Platform.OS === 'android') {
      const permission = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location permission',
          message:
            'Allow Off Grid Mobile to capture GPS coordinates for this observation.',
          buttonPositive: 'Allow',
          buttonNegative: 'Skip',
        },
      );

      if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
        return null;
      }
    }

    return await new Promise(resolve => {
      Geolocation.getCurrentPosition(
        position => {
          resolve({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        error => {
          logger.warn(
            `[CaptureFlow] Unable to get device location: ${error.message}`,
          );
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        },
      );
    });
  } catch (error) {
    logger.warn(`[CaptureFlow] Unable to get device location: ${errorMessage(error)}`);
    return null;
  }
}

/** Build device info from React Native Platform API. */
export function getDeviceInfo(): { model: string; os: string } {
  return {
    model: Platform.OS,
    os: `${Platform.OS} ${Platform.Version}`,
  };
}

/**
 * Best-effort storage/battery check before a multi-photo batch -- a single
 * capture is cheap enough not to bother, but dozens of photos back-to-back
 * can meaningfully drain both. Never throws: an unreadable device stat just
 * skips its own warning rather than blocking the batch.
 */
export async function checkBatchResourceWarnings(): Promise<string | null> {
  const warnings: string[] = [];

  try {
    const freeBytes = await DeviceInfo.getFreeDiskStorage();
    if (freeBytes < LOW_STORAGE_WARNING_BYTES) {
      warnings.push(`Storage is low (${(freeBytes / (1024 * 1024)).toFixed(0)} MB free).`);
    }
  } catch (error) {
    logger.warn(`[CaptureFlow] Unable to check free storage: ${errorMessage(error)}`);
  }

  try {
    const batteryLevel = await DeviceInfo.getBatteryLevel();
    // -1 means "unknown" on some devices/emulators -- not a real low reading.
    if (batteryLevel >= 0 && batteryLevel < LOW_BATTERY_WARNING_FRACTION) {
      warnings.push(`Battery is low (${Math.round(batteryLevel * 100)}%).`);
    }
  } catch (error) {
    logger.warn(`[CaptureFlow] Unable to check battery level: ${errorMessage(error)}`);
  }

  return warnings.length > 0 ? warnings.join(' ') : null;
}

export function confirmProceedDespiteWarning(warning: string, photoCount: number): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(
      'Before processing this batch',
      `${warning} Processing ${photoCount} photos may use noticeable storage and battery. Continue anyway?`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ],
    );
  });
}

/** Validate the model and build species configs once per capture/batch. */
export async function prepareSpeciesConfigs(
  miewidModel: MiewIDModelRecord | null,
  packs: EmbeddingPack[],
): Promise<SpeciesConfig[] | null> {
  if (!miewidModel || miewidModel.status !== 'ready') {
    const message = miewidModel
      ? MODEL_STATUS_MESSAGES[miewidModel.status as Exclude<MiewIDModelStatus, 'ready'>]
      : MODEL_STATUS_MESSAGES.missing;
    Alert.alert('MiewID model not ready', message);
    return null;
  }

  const { localIndividuals } = useWildlifeStore.getState();
  const { speciesConfigs, excludedPacks } = await buildActiveSpeciesConfigs(
    packs,
    miewidModel,
    localIndividuals,
  );

  // Mirror the original guard: healthy (non-quarantined) packs existed,
  // but every one of them was excluded for embedding-model
  // incompatibility — nothing left to match against.
  const quarantinedIds = new Set(
    excludedPacks
      .filter(excluded => excluded.reason === 'quarantined')
      .map(excluded => excluded.packId),
  );
  const healthyPackCount = packs.length - quarantinedIds.size;
  const incompatiblePackCount = excludedPacks.length - quarantinedIds.size;
  if (healthyPackCount > 0 && incompatiblePackCount === healthyPackCount) {
    Alert.alert(
      'Model and pack versions do not match',
      `The installed MiewID model (${miewidModel.version}) cannot be used with the downloaded pack. Download the latest model and pack before identifying an elephant.`,
    );
    return null;
  }

  return speciesConfigs;
}

/**
 * Run detect → crop → embed → match → persist → save → enqueue for one
 * photo. Never alerts or navigates -- callers (single-photo or batch)
 * decide how to report the outcome.
 */
export async function runPipelineForOnePhoto(
  photoUri: string,
  speciesConfigs: SpeciesConfig[],
  context: PhotoCaptureContext,
): Promise<PhotoOutcome> {
  const { miewidModel } = context;
  if (!miewidModel) {
    return { ok: false, message: MODEL_STATUS_MESSAGES.missing };
  }

  try {
    const result = await wildlifePipeline.processPhoto({
      photoUri,
      speciesConfigs,
      miewidModelPath: miewidModel.path,
      miewidModelFormat: miewidModel.format,
    });

    // Total failure: nothing completed, nothing worth saving.
    if (result.detections.length === 0 && result.errors.length > 0) {
      return {
        ok: false,
        message: result.errors
          .map(e => (e.species ? `${e.species}: ${e.message}` : e.message))
          .join('\n'),
      };
    }

    // Move the photo and its crops out of ephemeral cache storage into a
    // durable, app-private location before the observation is saved --
    // a file left in the cache directory can be evicted at any time.
    const persisted = await persistObservationFiles(
      result.observationId,
      result.photoUri,
      result.detections,
    );

    // Save observation to store -- awaited so the durable SQLite write
    // actually commits before we tell the user it's saved. If the DB
    // write fails after the files were already moved, clean them up
    // rather than leaving an orphaned, unreferenced directory behind.
    try {
      await useWildlifeStore.getState().addObservation({
        id: result.observationId,
        photoUri: persisted.photoUri,
        gps: context.gps,
        timestamp: new Date().toISOString(),
        deviceInfo: context.deviceInfo,
        fieldNotes: null,
        detections: persisted.detections,
        createdAt: new Date().toISOString(),
      });
    } catch (saveError) {
      await deleteObservationFiles(result.observationId);
      throw saveError;
    }

    // Queue the observation for sync now, not after review completes --
    // syncObservation() already no-ops (returns 'waiting-for-review')
    // until every detection has a decided reviewStatus, so it is safe to
    // enqueue immediately. Best-effort: the observation itself is
    // already durably saved above, so a queue-insert failure here must
    // not undo it -- it only means the queue row will be missing until
    // the next reconciliation.
    try {
      await useWildlifeStore.getState().addToSyncQueue({
        observationId: result.observationId,
        status: 'pending',
        wildbookInstanceUrl: '',
        retryCount: 0,
        lastError: null,
        lastAttempt: null,
        syncedAt: null,
        wildbookEncounterIds: [],
      });
    } catch (queueError) {
      logger.error(
        `[CaptureFlow] Failed to queue observation ${result.observationId} for sync:`,
        queueError,
      );
    }

    return { ok: true, observationId: result.observationId, errors: result.errors };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}
