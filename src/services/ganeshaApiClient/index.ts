import { GANESHA_API_BASE_URL } from '../../config/ganeshaApi';
import type {
  CreateUserProfilePayload,
  GaneshaApiErrorCode,
  GaneshaApiResult,
  LatestModelInfo,
  LatestPackInfo,
  SubmitObservationPayload,
  SubmitObservationResult,
  UploadUrlInfo,
  UserProfile,
} from './types';
import { entraAuthService } from '../entraAuthService';
import logger from '../../utils/logger';

/**
 * Thin client for the Ganesha backend's model/pack distribution and field
 * sync endpoints (backend/function_app.py: GET /models/{model_name}/latest,
 * GET /projects/{project_id}/packs/latest, POST /projects/{project_id}/upload-url,
 * POST /projects/{project_id}/submissions). Every call returns a typed
 * ok/err result rather than throwing, matching modelDownloadService's
 * DownloadOutcome convention -- callers branch on `.ok`, never try/catch.
 *
 * Auth is a real Entra ID access token from entraAuthService (which handles
 * refresh transparently) -- the header injection point is centralized here
 * so this is the only place that needs to change if the auth mechanism ever
 * changes again.
 *
 * Uploading the image bytes themselves (a direct PUT to the blob SAS URL
 * `getUploadUrl` returns) is deliberately NOT part of this client -- that
 * request goes straight to Azure Blob Storage, not the Ganesha backend, and
 * needs different headers (`x-ms-blob-type`) than any call here. See
 * `services/syncEngine` for that step.
 */
/**
 * Every request gets a deadline. Without one, a connection that is accepted
 * but never answered -- a captive portal, a dropped cellular handover, a
 * backend that stalls mid-response -- leaves the promise pending forever.
 * Callers render that as a spinner with no way out and no error to report,
 * which is exactly what it looked like in the field on iOS.
 *
 * 30s is deliberately generous: these calls are small JSON reads, but they
 * can be the first request after an Azure Function cold start.
 */
export const GANESHA_REQUEST_TIMEOUT_MS = 30_000;

class GaneshaApiClient {
  async getLatestModel(modelName: string): Promise<GaneshaApiResult<LatestModelInfo>> {
    return this.request<LatestModelInfo>(`/models/${encodeURIComponent(modelName)}/latest`);
  }

  async getLatestPack(projectId: string): Promise<GaneshaApiResult<LatestPackInfo>> {
    return this.request<LatestPackInfo>(
      `/projects/${encodeURIComponent(projectId)}/packs/latest`,
    );
  }

  async getUploadUrl(projectId: string, filename: string): Promise<GaneshaApiResult<UploadUrlInfo>> {
    return this.request<UploadUrlInfo>(
      `/projects/${encodeURIComponent(projectId)}/upload-url`,
      { method: 'POST', body: { filename } },
    );
  }

  async submitObservation(
    projectId: string,
    payload: SubmitObservationPayload,
  ): Promise<GaneshaApiResult<SubmitObservationResult>> {
    return this.request<SubmitObservationResult>(
      `/projects/${encodeURIComponent(projectId)}/submissions`,
      { method: 'POST', body: payload },
    );
  }

  /** Returns the signed-in user's Cosmos profile, or a `not-found` result if they haven't completed role selection yet. */
  async getUserProfile(): Promise<GaneshaApiResult<UserProfile>> {
    return this.request<UserProfile>('/users/profile');
  }

  /** Creates or updates the signed-in profile; the backend assigns organization and access. */
  async createUserProfile(payload: CreateUserProfilePayload): Promise<GaneshaApiResult<UserProfile>> {
    return this.request<UserProfile>('/users/profile', { method: 'POST', body: payload });
  }

  private async request<T>(
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown } = {},
  ): Promise<GaneshaApiResult<T>> {
    const accessToken = await entraAuthService.getValidAccessToken();
    if (!accessToken) {
      logger.warn(`[GaneshaApiClient] No valid session for ${path} -- sign-in is required.`);
      return { ok: false, code: 'unauthenticated', message: 'Not signed in' };
    }

    let response: Response;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), GANESHA_REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(`${GANESHA_API_BASE_URL}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: ['Bearer', accessToken].join(' '),
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      // A timeout surfaces as an AbortError from the signal above. Report it
      // separately from a refused connection: one means "no network", the
      // other means "the server took the call and went quiet", and the person
      // in the field can act on that difference.
      if (controller.signal.aborted) {
        const message = `Request timed out after ${GANESHA_REQUEST_TIMEOUT_MS / 1000}s`;
        logger.warn(`[GaneshaApiClient] ${path} timed out`);
        return { ok: false, code: 'timeout', message };
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[GaneshaApiClient] Network error for ${path}: ${message}`);
      return { ok: false, code: 'network-error', message };
    } finally {
      clearTimeout(deadline);
    }

    const errorCode = this.errorCodeFor(response.status);
    if (errorCode) {
      logger.warn(`[GaneshaApiClient] ${path} returned HTTP ${response.status}`);
      return { ok: false, code: errorCode, message: `HTTP ${response.status}`, httpStatus: response.status };
    }

    try {
      const data = (await response.json()) as T;
      return { ok: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[GaneshaApiClient] Malformed JSON from ${path}: ${message}`);
      return { ok: false, code: 'parse-error', message };
    }
  }

  private errorCodeFor(status: number): GaneshaApiErrorCode | null {
    if (status === 401 || status === 403) {
      return 'unauthorized';
    }
    if (status === 404) {
      return 'not-found';
    }
    if (status < 200 || status >= 300) {
      return 'http-error';
    }
    return null;
  }
}

export const ganeshaApiClient = new GaneshaApiClient();
export type {
  LatestModelInfo,
  LatestPackInfo,
  UploadUrlInfo,
  SubmitObservationPayload,
  SubmitObservationResult,
  UserProfile,
  CreateUserProfilePayload,
  GaneshaApiResult,
  GaneshaApiErrorCode,
} from './types';
