/**
 * SQLite schema for the field-durable data: observations, their detections,
 * and the sync queue. Packs, local individuals, and the MiewID model record
 * stay in the AsyncStorage-backed wildlifeStore -- they are small, do not
 * need transactional per-row updates, and packs are validated file-based
 * artifacts already (see services/packManager).
 *
 * Migrations: statements are applied once, tracked via `PRAGMA user_version`.
 * To add a schema change, bump CURRENT_SCHEMA_VERSION and append new
 * statements to MIGRATIONS keyed by the version they introduce -- never
 * mutate an already-shipped array in place, or devices that already applied
 * it will silently skip real schema changes.
 */

export const CURRENT_SCHEMA_VERSION = 2;

/** Statements introducing schema version 1 (initial release). */
const V1_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS observations (
    id TEXT PRIMARY KEY,
    photo_uri TEXT NOT NULL,
    gps_lat REAL,
    gps_lon REAL,
    gps_accuracy REAL,
    captured_at TEXT NOT NULL,
    device_model TEXT NOT NULL,
    device_os TEXT NOT NULL,
    field_notes TEXT,
    created_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS detections (
    id TEXT PRIMARY KEY,
    observation_id TEXT NOT NULL,
    bbox_x REAL NOT NULL,
    bbox_y REAL NOT NULL,
    bbox_width REAL NOT NULL,
    bbox_height REAL NOT NULL,
    species TEXT NOT NULL,
    species_confidence REAL NOT NULL,
    cropped_image_uri TEXT NOT NULL,
    embedding_json TEXT NOT NULL,
    top_candidates_json TEXT NOT NULL,
    approved_individual TEXT,
    review_status TEXT NOT NULL DEFAULT 'pending',
    location_id TEXT,
    sex TEXT,
    life_stage TEXT,
    behavior TEXT,
    submitter_id TEXT,
    project_id TEXT
  );`,
  `CREATE INDEX IF NOT EXISTS idx_detections_observation ON detections(observation_id);`,
  // observation_id is intentionally not a FOREIGN KEY: the sync_queue row is
  // always created transactionally alongside its observation in real usage
  // (see insertObservationWithDetections), but the unit test suite exercises
  // addToSyncQueue as a standalone store action without a parent row -- a
  // real FK constraint would make those tests fight the schema rather than
  // the store's actual behavior.
  //
  // `wildbook_*` column names are an upstream leftover (off-grid-mobile synced
  // straight to a Wildbook instance); Ganesha's sync engine currently repurposes
  // them for Ganesha backend submission bookkeeping instead -- see the
  // SyncQueueItem doc comment in types/wildlife.ts before changing this table,
  // especially if direct Wildbook sync is ever added alongside (not instead of)
  // the Ganesha sync.
  `CREATE TABLE IF NOT EXISTS sync_queue (
    observation_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    wildbook_instance_url TEXT NOT NULL DEFAULT '',
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_attempt TEXT,
    synced_at TEXT,
    wildbook_encounter_ids_json TEXT NOT NULL DEFAULT '[]'
  );`,
  `CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);`,
];

/**
 * Statements introducing schema version 2 (sync engine).
 *
 * `ganesha_submission_id` tracks, per detection, the id returned by a
 * successful `POST /projects/{id}/submissions` call. This is deliberately
 * per-detection, not per-observation: `sync_queue` (see above) only tracks
 * one coarse status per observation, which cannot represent "2 of 3
 * detections in this observation already submitted successfully, 1 failed"
 * -- retrying a partially-failed observation would silently create
 * duplicate submissions for the detections that already succeeded. Storing
 * the id directly on the detection row makes re-sync idempotent: the sync
 * engine skips any detection that already has one.
 */
const V2_STATEMENTS: string[] = [
  `ALTER TABLE detections ADD COLUMN ganesha_submission_id TEXT;`,
];

/** Statements keyed by the schema version they introduce, applied in order. */
export const MIGRATIONS: Record<number, string[]> = {
  1: V1_STATEMENTS,
  2: V2_STATEMENTS,
};
