export interface LatestModelInfo {
  name: string;
  version: string;
  sha256: string;
  sizeBytes: number;
  downloadUrl: string;
}

export interface LatestPackInfo {
  projectId: string;
  displayName: string | null;
  version: string;
  sha256: string;
  sizeBytes: number;
  individualCount: number | null;
  embeddingCount: number | null;
  downloadUrl: string;
}

export interface UploadUrlInfo {
  uploadUrl: string;
  blobUrl: string;
}

/**
 * Body for `POST /projects/{project_id}/submissions` (backend/function_app.py
 * `SubmitFieldObservationRequest`). `imageUrl` must already point at an
 * uploaded blob (see `getUploadUrl` + a direct PUT to its `uploadUrl`) --
 * this endpoint does not accept raw image bytes itself.
 */
export interface SubmitObservationPayload {
  imageUrl: string;
  sourceImageUrl?: string | null;
  elephantId: string | null;
  provisionalId?: string | null;
  reviewDecision?: 'matched' | 'unknown';
  elephantName?: string | null;
  confidence?: number | null;
  alternatives?: unknown[] | null;
  detectedSpecies?: string | null;
  detectorConfidence?: number | null;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  lat?: number | null;
  long?: number | null;
  regionName?: string;
  observationDate?: string | null;
  observationNotes?: string | null;
  captureTimestamp?: string | null;
  deviceModel?: string | null;
  deviceOs?: string | null;
}

export interface SubmitObservationResult {
  submissionId: string;
  status: string;
  imageUrl: string | null;
}

/**
 * `GET`/`POST /users/profile` (backend/function_app.py `get_user_profile` /
 * `create_user_profile`). A `GET` 404 means the signed-in identity has no
 * Cosmos profile yet -- the mobile app should route to a role-selection
 * step and `POST` one, mirroring the web app's `select-role` page.
 */
export interface UserProfile {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: 'admin' | 'researcher' | 'citizen';
  orgId: string;
  approved: boolean;
  badges: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserProfilePayload {
  name: string;
}

/**
 * `unauthenticated`: no valid local session at all (never signed in, or
 * refresh failed) -- entraAuthService.getValidAccessToken() returned null,
 * so the request was never even sent. Callers should route to sign-in.
 * `unauthorized`: the backend itself rejected a token that was sent (401/403)
 * -- a real server-side rejection, distinct from having no token locally.
 */
export type GaneshaApiErrorCode =
  | 'network-error'
  | 'unauthenticated'
  | 'unauthorized'
  | 'not-found'
  | 'http-error'
  | 'parse-error';

export type GaneshaApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: GaneshaApiErrorCode; message: string; httpStatus?: number };
