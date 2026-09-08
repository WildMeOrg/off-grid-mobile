import RNFS from 'react-native-fs';
import type { Detection } from '../types';
import logger from '../utils/logger';

function observationDir(observationId: string): string {
  return `${RNFS.DocumentDirectoryPath}/observations/${observationId}`;
}

/**
 * Copies the source photo into durable storage. A copy (not a move) is used
 * because the source may be a content:// URI from the camera/gallery picker,
 * outside our sandbox -- an atomic rename can fail across storage providers.
 * The source is left in place; OS-managed picker caches are cleaned up by
 * the OS, not by us.
 */
async function copyDurable(sourceUri: string, destPath: string): Promise<void> {
  try {
    await RNFS.copyFile(sourceUri, destPath);
  } catch (error) {
    logger.error(`[ObservationStorage] Failed to copy ${sourceUri} -> ${destPath}:`, error);
    throw error;
  }
}

/**
 * Moves a detection crop into durable storage. A move (not a copy) is used
 * because crops were just written by our own pipeline into the cache
 * directory (see wildlifePipeline) -- an atomic rename is safe there and
 * avoids leaving a duplicate behind in a purgeable location.
 */
async function moveDurable(sourceUri: string, destPath: string): Promise<void> {
  try {
    await RNFS.moveFile(sourceUri, destPath);
  } catch (error) {
    logger.error(`[ObservationStorage] Failed to move ${sourceUri} -> ${destPath}:`, error);
    throw error;
  }
}

/**
 * Moves a just-captured photo and its detection crops out of ephemeral
 * cache/picker storage into a durable, app-private directory keyed by
 * observation id. Must complete before an observation is considered saved --
 * a file left in the cache directory can be evicted by the OS at any time,
 * force-quit or not.
 */
export async function persistObservationFiles(
  observationId: string,
  photoUri: string,
  detections: Detection[],
): Promise<{ photoUri: string; detections: Detection[] }> {
  const dir = observationDir(observationId);
  await RNFS.mkdir(dir);

  const durablePhotoPath = `${dir}/original.jpg`;
  await copyDurable(photoUri, durablePhotoPath);

  const durableDetections = await Promise.all(
    detections.map(async (detection) => {
      const durableCropPath = `${dir}/crop_${detection.id}.jpg`;
      await moveDurable(detection.croppedImageUri, durableCropPath);
      return { ...detection, croppedImageUri: durableCropPath };
    }),
  );

  return { photoUri: durablePhotoPath, detections: durableDetections };
}

/** Deletes all durably-persisted files (photo + crops) for one observation. */
export async function deleteObservationFiles(observationId: string): Promise<void> {
  const dir = observationDir(observationId);
  try {
    if (await RNFS.exists(dir)) {
      await RNFS.unlink(dir);
    }
  } catch (error) {
    logger.error(`[ObservationStorage] Failed to delete ${dir}:`, error);
  }
}
