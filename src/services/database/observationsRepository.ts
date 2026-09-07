import type { Detection, Observation } from '../../types';
import { getDb } from './connection';
import type { DetectionRow, ObservationRow } from './rowMapping';
import { mapDetectionRow, mapObservationRow } from './rowMapping';

/**
 * Inserts an observation, all of its detections, and a paired 'pending'
 * sync_queue row in a single transaction -- an observation is never
 * durably half-saved (e.g. present but with no way to sync it later).
 */
export async function insertObservationWithDetections(observation: Observation): Promise<void> {
  const database = getDb();
  await database.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO observations
        (id, photo_uri, gps_lat, gps_lon, gps_accuracy, captured_at, device_model, device_os, field_notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        observation.id,
        observation.photoUri,
        observation.gps?.lat ?? null,
        observation.gps?.lon ?? null,
        observation.gps?.accuracy ?? null,
        observation.timestamp,
        observation.deviceInfo.model,
        observation.deviceInfo.os,
        observation.fieldNotes,
        observation.createdAt,
      ],
    );

    for (const detection of observation.detections) {
      await tx.execute(
        `INSERT INTO detections
          (id, observation_id, bbox_x, bbox_y, bbox_width, bbox_height, species, species_confidence,
           cropped_image_uri, embedding_json, top_candidates_json, approved_individual, review_status,
           location_id, sex, life_stage, behavior, submitter_id, project_id, ganesha_submission_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          detection.id,
          observation.id,
          detection.boundingBox.x,
          detection.boundingBox.y,
          detection.boundingBox.width,
          detection.boundingBox.height,
          detection.species,
          detection.speciesConfidence,
          detection.croppedImageUri,
          JSON.stringify(detection.embedding),
          JSON.stringify(detection.matchResult.topCandidates),
          detection.matchResult.approvedIndividual,
          detection.matchResult.reviewStatus,
          detection.encounterFields.locationId,
          detection.encounterFields.sex,
          detection.encounterFields.lifeStage,
          detection.encounterFields.behavior,
          detection.encounterFields.submitterId,
          detection.encounterFields.projectId,
          detection.ganeshaSubmissionId,
        ],
      );
    }

    await tx.execute(
      `INSERT INTO sync_queue (observation_id, status, wildbook_instance_url, retry_count, last_error, last_attempt, synced_at, wildbook_encounter_ids_json)
       VALUES (?, 'pending', '', 0, NULL, NULL, NULL, '[]')`,
      [observation.id],
    );
  });
}

/** Loads every observation with its detections, oldest first. */
export async function listObservationsWithDetections(): Promise<Observation[]> {
  const database = getDb();
  const obsResult = await database.execute('SELECT * FROM observations ORDER BY created_at ASC;');
  const detResult = await database.execute('SELECT * FROM detections ORDER BY id ASC;');

  const detectionsByObservation = new Map<string, Detection[]>();
  for (const row of detResult.rows as unknown as DetectionRow[]) {
    const list = detectionsByObservation.get(row.observation_id) ?? [];
    list.push(mapDetectionRow(row));
    detectionsByObservation.set(row.observation_id, list);
  }

  return (obsResult.rows as unknown as ObservationRow[]).map((row) =>
    mapObservationRow(row, detectionsByObservation.get(row.id) ?? []),
  );
}

export async function updateObservationNotes(
  observationId: string,
  fieldNotes: string | null,
): Promise<void> {
  const database = getDb();
  await database.execute(
    'UPDATE observations SET field_notes = ? WHERE id = ?;',
    [fieldNotes, observationId],
  );
}

/**
 * Applies a partial update to one detection. Only columns whose top-level
 * key is present in `updates` are touched -- e.g. passing just
 * `{ matchResult: {...} }` leaves boundingBox/species/etc. untouched.
 */
export async function updateDetectionFields(
  observationId: string,
  detectionId: string,
  updates: Partial<Detection>,
): Promise<void> {
  const database = getDb();
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.boundingBox) {
    setClauses.push('bbox_x = ?', 'bbox_y = ?', 'bbox_width = ?', 'bbox_height = ?');
    params.push(updates.boundingBox.x, updates.boundingBox.y, updates.boundingBox.width, updates.boundingBox.height);
  }
  if (updates.species !== undefined) {
    setClauses.push('species = ?');
    params.push(updates.species);
  }
  if (updates.speciesConfidence !== undefined) {
    setClauses.push('species_confidence = ?');
    params.push(updates.speciesConfidence);
  }
  if (updates.croppedImageUri !== undefined) {
    setClauses.push('cropped_image_uri = ?');
    params.push(updates.croppedImageUri);
  }
  if (updates.embedding !== undefined) {
    setClauses.push('embedding_json = ?');
    params.push(JSON.stringify(updates.embedding));
  }
  if (updates.matchResult) {
    setClauses.push('top_candidates_json = ?', 'approved_individual = ?', 'review_status = ?');
    params.push(
      JSON.stringify(updates.matchResult.topCandidates),
      updates.matchResult.approvedIndividual,
      updates.matchResult.reviewStatus,
    );
  }
  if (updates.encounterFields) {
    setClauses.push('location_id = ?', 'sex = ?', 'life_stage = ?', 'behavior = ?', 'submitter_id = ?', 'project_id = ?');
    params.push(
      updates.encounterFields.locationId,
      updates.encounterFields.sex,
      updates.encounterFields.lifeStage,
      updates.encounterFields.behavior,
      updates.encounterFields.submitterId,
      updates.encounterFields.projectId,
    );
  }
  if (updates.ganeshaSubmissionId !== undefined) {
    setClauses.push('ganesha_submission_id = ?');
    params.push(updates.ganeshaSubmissionId);
  }

  if (setClauses.length === 0) {
    return;
  }

  params.push(detectionId, observationId);
  await database.execute(`UPDATE detections SET ${setClauses.join(', ')} WHERE id = ? AND observation_id = ?;`, params as never[]);
}
