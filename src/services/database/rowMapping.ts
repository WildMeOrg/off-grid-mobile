import type { Detection, MatchCandidate, Observation, SyncQueueItem } from '../../types';

export interface ObservationRow {
  id: string;
  photo_uri: string;
  gps_lat: number | null;
  gps_lon: number | null;
  gps_accuracy: number | null;
  captured_at: string;
  device_model: string;
  device_os: string;
  field_notes: string | null;
  created_at: string;
}

export interface DetectionRow {
  id: string;
  observation_id: string;
  bbox_x: number;
  bbox_y: number;
  bbox_width: number;
  bbox_height: number;
  species: string;
  species_confidence: number;
  cropped_image_uri: string;
  embedding_json: string;
  top_candidates_json: string;
  approved_individual: string | null;
  review_status: string;
  location_id: string | null;
  sex: string | null;
  life_stage: string | null;
  behavior: string | null;
  submitter_id: string | null;
  project_id: string | null;
  ganesha_submission_id: string | null;
}

export interface SyncQueueRow {
  observation_id: string;
  status: string;
  wildbook_instance_url: string;
  retry_count: number;
  last_error: string | null;
  last_attempt: string | null;
  synced_at: string | null;
  wildbook_encounter_ids_json: string;
}

export function mapDetectionRow(row: DetectionRow): Detection {
  return {
    id: row.id,
    observationId: row.observation_id,
    boundingBox: {
      x: row.bbox_x,
      y: row.bbox_y,
      width: row.bbox_width,
      height: row.bbox_height,
    },
    species: row.species,
    speciesConfidence: row.species_confidence,
    croppedImageUri: row.cropped_image_uri,
    embedding: JSON.parse(row.embedding_json) as number[],
    matchResult: {
      topCandidates: JSON.parse(row.top_candidates_json) as MatchCandidate[],
      approvedIndividual: row.approved_individual,
      reviewStatus: row.review_status as Detection['matchResult']['reviewStatus'],
    },
    encounterFields: {
      locationId: row.location_id,
      sex: row.sex as Detection['encounterFields']['sex'],
      lifeStage: row.life_stage,
      behavior: row.behavior,
      submitterId: row.submitter_id,
      projectId: row.project_id,
    },
    ganeshaSubmissionId: row.ganesha_submission_id,
  };
}

export function mapObservationRow(row: ObservationRow, detections: Detection[]): Observation {
  return {
    id: row.id,
    photoUri: row.photo_uri,
    gps:
      row.gps_lat !== null && row.gps_lon !== null && row.gps_accuracy !== null
        ? { lat: row.gps_lat, lon: row.gps_lon, accuracy: row.gps_accuracy }
        : null,
    timestamp: row.captured_at,
    deviceInfo: { model: row.device_model, os: row.device_os },
    fieldNotes: row.field_notes,
    detections,
    createdAt: row.created_at,
  };
}

export function mapSyncQueueRow(row: SyncQueueRow): SyncQueueItem {
  return {
    observationId: row.observation_id,
    status: row.status as SyncQueueItem['status'],
    wildbookInstanceUrl: row.wildbook_instance_url,
    retryCount: row.retry_count,
    lastError: row.last_error,
    lastAttempt: row.last_attempt,
    syncedAt: row.synced_at,
    wildbookEncounterIds: JSON.parse(row.wildbook_encounter_ids_json) as string[],
  };
}
