// === MiewID Model Types ===

export type MiewIDModelStatus =
  | 'missing'
  | 'downloading'
  | 'ready'
  | 'corrupt'
  | 'incompatible';

/**
 * ONNX artifacts use the shared CPU runtime; TFLite artifacts use Android
 * LiteRT. Either artifact must match the pack's embedding-model contract.
 */
export type ModelFormat = 'onnx' | 'tflite';

/**
 * Persisted identity of the installed MiewID embedding model.
 *
 * `sha256`/`sizeBytes` are null only for records migrated from the legacy
 * bare-path format; startup reconciliation backfills them. `verifiedAt` is
 * the timestamp of the last successful full-hash verification — while it is
 * set, reconciliation only re-checks existence and size.
 */
export interface MiewIDModelRecord {
  path: string;
  name: string;
  version: string;
  sha256: string | null;
  sizeBytes: number | null;
  status: MiewIDModelStatus;
  verifiedAt: string | null;
  format: ModelFormat;
  /**
   * Why a non-ready record ended up that way, for display. 'missing' covers
   * every failure that is not an integrity mismatch -- a stalled transfer, an
   * unreachable host, a 404, a cancellation -- and collapsing those into one
   * word leaves the person in the field with nothing to act on. Null when the
   * model is ready or still downloading, and absent on records written by
   * builds from before it existed.
   */
  failureReason?: string | null;
}

// === Embedding Pack Types ===

export interface EmbeddingPackManifest {
  formatVersion: string;
  species: string;
  featureClass: string;
  displayName: string;
  description?: string;
  wildbookInstanceUrl: string;
  exportDate: string;
  individualCount: number;
  embeddingCount: number;
  embeddingDim: number;
  embeddingModel: {
    name: string;
    version: string;
    huggingFaceRepo?: string;
    inputSize: [number, number];
    normalize: {
      mean: [number, number, number];
      std: [number, number, number];
    };
  };
  detectorModel: {
    filename: string;
    configFile: string;
  };
  checksums?: Record<string, string>;
}

export interface DetectorConfig {
  modelFile: string;
  architecture: string;
  inputSize: [number, number];
  inputChannels: number;
  channelOrder: 'RGB' | 'BGR';
  normalize: {
    mean: [number, number, number];
    std: [number, number, number];
    scale: number;
  };
  confidenceThreshold: number;
  nmsThreshold: number;
  maxDetections: number;
  outputFormat: string;
  classLabels: string[];
  outputSpec: {
    boxFormat: 'xyxy' | 'xywh' | 'cxcywh';
    coordinateType: 'normalized' | 'absolute';
    outputTensorName?: string;
    layout: string;
  };
}

export interface EmbeddingPack {
  id: string;
  packVersion: string;
  /** SHA-256 of the installed source archive; absent only on legacy records. */
  artifactSha256?: string;
  species: string;
  featureClass: string;
  displayName: string;
  wildbookInstanceUrl: string;
  exportDate: string;
  individualCount: number;
  embeddingDim: number;
  embeddingModelVersion: string;
  detectorModelFile: string;
  embeddingsFile: string;
  indexFile: string;
  referencePhotosDir: string;
  packDir: string;
  downloadedAt: string;
  sizeBytes: number;
  /**
   * Validation state. `undefined` means the pack predates validation and
   * gets a full check on next startup; 'quarantined' packs are excluded
   * from capture and matching until re-validated.
   */
  status?: 'ready' | 'quarantined';
  validationErrors?: string[];
  validatedAt?: string;
}

export interface PackIndividual {
  id: string;
  name: string | null;
  alternateId: string | null;
  sex: 'male' | 'female' | 'unknown' | null;
  lifeStage: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  encounterCount: number;
  embeddingCount: number;
  embeddingOffset: number;
  referencePhotos: string[];
  notes: string | null;
}

// === Local Individual Types ===

export interface LocalIndividual {
  localId: string;
  userLabel: string | null;
  species: string;
  embeddings: number[][];
  referencePhotos: string[];
  firstSeen: string;
  encounterCount: number;
  syncStatus: 'pending' | 'synced';
  wildbookId: string | null;
}

// === Observation Types ===

export interface Observation {
  id: string;
  photoUri: string;
  gps: {
    lat: number;
    lon: number;
    accuracy: number;
  } | null;
  timestamp: string;
  deviceInfo: {
    model: string;
    os: string;
  };
  fieldNotes: string | null;
  detections: Detection[];
  createdAt: string;
}

export interface Detection {
  id: string;
  observationId: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  species: string;
  speciesConfidence: number;
  croppedImageUri: string;
  embedding: number[];
  matchResult: {
    topCandidates: MatchCandidate[];
    approvedIndividual: string | null;
    reviewStatus: 'pending' | 'approved' | 'rejected';
  };
  encounterFields: EncounterFields;
  /**
   * The Ganesha backend submission id returned once this detection has been
   * successfully synced (see `POST /projects/{id}/submissions`), or `null`
  * if it has not been submitted yet. Both approved pack matches and
  * reviewed provisional `FIELD-*` individuals receive a server submission
  * id; provisional ids are review keys and never official elephant ids.
   */
  ganeshaSubmissionId: string | null;
}

export interface MatchCandidate {
  individualId: string;
  score: number;
  source: 'pack' | 'local';
  refPhotoIndex: number;
}

export interface EncounterFields {
  locationId: string | null;
  sex: string | null;
  lifeStage: string | null;
  behavior: string | null;
  submitterId: string | null;
  projectId: string | null;
}

// === Sync Types ===

export type SyncStatus =
  | 'pending'
  | 'uploading'
  | 'synced'
  | 'failed'
  | 'failedPermanent';

/**
 * NOTE: the `wildbook*` field names are inherited from upstream off-grid-mobile,
 * which synced observations directly to a Wildbook instance. Project Ganesha's
 * sync engine currently targets the Ganesha backend (`POST /projects/{id}/submissions`)
 * instead, not Wildbook directly -- these fields are repurposed to hold Ganesha's
 * submission bookkeeping (`wildbookEncounterIds` holds the returned Ganesha
 * submission id(s), one per detection in the observation).
 *
 * This is a deliberate, undecided placeholder, not a finished design: if direct
 * Wildbook sync is added later as a *replacement* for the Ganesha sync, these
 * fields can be reused as-is (just point the write at a different endpoint). If
 * it's added as an *additional* target (dual-write to both Ganesha and Wildbook),
 * this single status/id-list pair per observation cannot represent both targets'
 * independent sync state -- that would need a second set of columns or a
 * normalized per-target sync_targets table, not a rename. Don't assume either
 * shape has already been decided; the product decision on redirect-vs-dual-write
 * had not been made as of this comment.
 */
export interface SyncQueueItem {
  observationId: string;
  status: SyncStatus;
  wildbookInstanceUrl: string;
  retryCount: number;
  lastError: string | null;
  lastAttempt: string | null;
  syncedAt: string | null;
  wildbookEncounterIds: string[];
}

// === Inference Types ===

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectionResult {
  boundingBox: BoundingBox;
  species: string;
  confidence: number;
}
