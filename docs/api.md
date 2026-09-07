# API

This is the mobile client's contract, grounded in [ganeshaApiClient](../src/services/ganeshaApiClient/index.ts) and its [types](../src/services/ganeshaApiClient/types.ts). The backend is not included here; client code alone cannot establish server authorization, retention, or downstream delivery guarantees.

## Connection and authentication

The six public deployment fields are documented in [setup](setup.md). All backend paths below are appended to `apiBaseUrl`, which includes any required `/api` prefix. Model names and project IDs in paths are URL-encoded. Uploads use the configured `projectId`.

Backend requests carry `Authorization: Bearer <access-token>`. POST bodies are JSON with `Content-Type: application/json`. The mobile client does not send a client secret, API key, or the web app's `x-ms-client-principal` header.

[entraAuthService](../src/services/entraAuthService.ts) uses browser-based public-client sign-in with PKCE and the fixed native redirect. It requests `openid`, `profile`, `offline_access`, and `api://<apiClientId>/access_as_user`. Before each backend call, it obtains a valid access token, refreshing within 60 seconds of expiry. Missing refresh credentials or refresh failure clear the local token entry and require sign-in again.

Tokens are in OS secure storage under a namespace containing all six public deployment fields. Legacy shared tokens are not reused. This does not isolate or migrate profiles, packs, observations, or SQLite state; follow the [existing-data precautions](setup.md#sign-in-and-existing-data).

## Backend requests

| Client method | HTTP method and path | Request body | Successful JSON body |
| --- | --- | --- | --- |
| `getLatestModel(modelName)` | `GET /models/{modelName}/latest` | None | `LatestModelInfo` |
| `getLatestPack(projectId)` | `GET /projects/{projectId}/packs/latest` | None | `LatestPackInfo` |
| `getUploadUrl(projectId, filename)` | `POST /projects/{projectId}/upload-url` | `{ "filename": "example-detection.jpg" }` | `UploadUrlInfo` |
| `submitObservation(projectId, payload)` | `POST /projects/{projectId}/submissions` | Reviewed detection evidence, described below | `SubmitObservationResult` |
| `getUserProfile()` | `GET /users/profile` | None | `UserProfile` |
| `createUserProfile(payload)` | `POST /users/profile` | `{ "name": "Example observer" }` | `UserProfile` |

For example, the neutral base resolves a pack request to `https://api.example.invalid/api/projects/example-project/packs/latest`. It is not a live service.

## Response and error handling

The HTTP success body is the response object itself, not an `ok/data` envelope. After a 2xx response parses as JSON, the client exposes `{ ok: true, data }`. Handled failures expose `{ ok: false, code, message, httpStatus? }`:

| `code` | Client behavior |
| --- | --- |
| `unauthenticated` | No valid local access token; no backend request is sent. |
| `unauthorized` | Backend returned 401 or 403. |
| `not-found` | Backend returned 404. |
| `http-error` | Any other non-2xx status. |
| `network-error` | The backend `fetch` call rejected. |
| `parse-error` | A 2xx body could not be parsed as JSON, including an empty body. |

HTTP failures report `HTTP <status>` and `httpStatus`; error response bodies are not parsed. There is no automatic HTTP retry or second attempt after a 401/403. The generic client casts successful JSON to TypeScript types rather than validating its structure at runtime. Native authentication/storage exceptions can still reject before the HTTP handling block.

## Profile completion

After browser sign-in, [SignInScreen](../src/screens/SignInScreen.tsx) fetches `/users/profile`. A 404 opens [profile completion](../src/screens/SelectRoleScreen.tsx), which posts only a trimmed, non-empty `name`. Despite that screen's internal `SelectRole` name, the request does not choose a role or organization.

`UserProfile` contains string fields `id`, `userId`, `email`, `name`, `orgId`, `createdAt`, and `updatedAt`; `role` is `admin`, `researcher`, or `citizen`; `approved` is a boolean; `badges` is a string array. Role, organization, and approval are response data, not public deployment fields or client-assigned access. The backend's actual assignment and enforcement policy must be verified separately.

## Model and pack publication

These are the publication descriptors the client expects, not a backend publishing procedure:

| Response | Fields |
| --- | --- |
| `LatestModelInfo` | `name`, `version`, `sha256`, `downloadUrl`: strings; `sizeBytes`: number. |
| `LatestPackInfo` | `projectId`, `version`, `sha256`, `downloadUrl`: strings; `displayName`: string or null; `sizeBytes`: number; `individualCount`, `embeddingCount`: number or null. |

`sha256` identifies the exact downloaded artifact; `sizeBytes` describes its bytes. Pack metadata describes the ZIP archive, not its extracted size. Do not substitute model version, pack version, and checksums for one another.

[modelSourceResolver](../src/services/modelSourceResolver/index.ts) requests `miewid` by default; `miewid-litert` is the Android LiteRT model key. The response has no `format` field: a `.tflite` filename in `downloadUrl`, ignoring its query string, selects LiteRT; other filenames default to ONNX. A configured model key is not evidence that the backend has published that artifact.

Resolve metadata immediately before acquisition. `downloadUrl` and the upload `uploadUrl` are ephemeral signed URLs, not durable configuration. Do not publish, log, or cache them across acquisitions. The client contract specifies no expiry duration; obtain fresh metadata/upload URLs when needed. Artifact downloads and blob uploads use the returned URLs directly, without forwarding the backend Bearer token.

[Pack acquisition](../src/services/packDownloadService/index.ts) stages downloads and requires valid pack contents plus a ready, compatible embedding model before activation. It compares both pack version and artifact hash when checking for an update. [Candidate preparation](../src/services/packDownloadService/candidate.ts) requires a 64-digit hexadecimal SHA-256 and limits project IDs and pack versions to 1-40 UTF-16 code units.

The shared [file downloader](../src/services/fileDownloadService/index.ts) verifies SHA-256 and checks length when the expected size is positive. By default, it makes up to three attempts for network, length/checksum, or 5xx failures, with backoff; 4xx responses are not retried. This is separate from the backend HTTP client's no-retry behavior. ZIP contents and model compatibility are specified in the [embedding pack contract](EMBEDDING_PACK_FORMAT.md).

## Reviewed observation uploads

Upload All, per-observation Upload/Retry in [SyncScreen](../src/screens/SyncScreen.tsx), and the upload action in [ObservationDetailScreen](../src/screens/ObservationDetailScreen.tsx) explicitly invoke the sync engine. Capturing or reviewing a sighting is not consent to upload it. The [auth gate](../src/utils/authGate.ts) stops an action when it sends the user to sign-in; the user retries that action afterwards. Offline capture and review do not themselves require sign-in, although identification needs installed model and pack assets.

[syncEngine](../src/services/syncEngine/index.ts) processes observations and their eligible detections sequentially:

1. If any detection is still `pending` review, return `waiting-for-review` without uploading or updating the queue.
2. For each eligible detection, request an upload URL with its filename, then stream its JPEG crop directly to the returned `uploadUrl`.
3. The direct request is `PUT`, with raw file bytes, `Content-Type: image/jpeg`, and `x-ms-blob-type: BlockBlob`. It is not multipart and does not use the backend Bearer header. A non-2xx upload fails the attempt.
4. Submit JSON evidence to `/projects/{projectId}/submissions`, using the returned `blobUrl` as `imageUrl`, not the signed upload URL.
5. Persist the returned `submissionId` on that detection before continuing.

`UploadUrlInfo` contains `uploadUrl` and `blobUrl`, both strings. A provisional detection also triggers upload of the original photo once per sync attempt, using `<observationId>-source.jpg`; crop filenames are `<detectionId>.jpg`. `sourceImageUrl` starts as null and is included in that provisional submission and any later submissions in the same attempt. A pack match alone does not trigger original-photo upload.

| Local decision | Submission mapping |
| --- | --- |
| Approved `FIELD-*` identity | `elephantId: null`, `provisionalId: <FIELD-id>`, `reviewDecision: "unknown"`, `elephantName: null`. It is not an official identity. |
| Approved non-provisional identity present among candidates with `source: "pack"` | `elephantId: <approvedIndividual>`, `provisionalId: null`, `reviewDecision: "matched"`; name resolved from installed pack data, or null. |
| Rejected, otherwise ineligible, or already carrying `ganeshaSubmissionId` | Not resubmitted. Any pending detection blocks the entire observation first. |

The current evidence payload contains:

| Fields | Values sent by sync |
| --- | --- |
| `imageUrl`, `sourceImageUrl` | Crop and optional original-photo blob references, as above. |
| `elephantId`, `provisionalId`, `reviewDecision`, `elephantName` | Human field decision, using the mapping above. |
| `confidence`, `alternatives` | Selected candidate's score or null, and the full stored `topCandidates` array. |
| `detectedSpecies`, `detectorConfidence`, `boundingBox` | Detection species, detector score, and unchanged numeric `{ x, y, width, height }` box. |
| `lat`, `long` | Stored GPS latitude and longitude, or null. These are not rounded like the on-screen location summary. |
| `observationDate`, `captureTimestamp` | Both use the observation timestamp. |
| `observationNotes` | Observation field notes. |
| `deviceModel`, `deviceOs` | Stored device model and OS. |

The type additionally permits `regionName`, but this sync path does not populate it. It does not send raw embeddings or the per-detection `encounterFields` object. Review the [privacy policy](PRIVACY_POLICY.md) before uploading location and photographic evidence.

The elephant model is a feature extractor producing raw 2152-dimensional embeddings, not identity names. The [pipeline](../src/services/wildlifePipeline/index.ts) presents up to five candidates from [cosine ranking](../src/services/embeddingMatchService/index.ts) for human review. The payload's `confidence` is a selected candidate's similarity score, not a probability of a correct scientific identity; `detectorConfidence` is a separate detector score.

## Receipts and retries

`SubmitObservationResult` expects `submissionId: string`, `status: string`, and `imageUrl: string | null`. Sync stores only the submission ID as `ganeshaSubmissionId`; it does not interpret the returned status or image URL as an identity confirmation.

The [receipt presentation](../src/services/observationStatus/index.ts) derives "Received by EleBook" from stored submission IDs and local queue state. This means backend acknowledgement, not proof of Wildbook/WhiskerBook ingestion or a confirmed scientific identity. There is no downstream ingestion receipt endpoint in this client. Receipt counts are detections with stored IDs; the displayed time comes from local `syncedAt`, not a server-supplied receipt timestamp. The legacy queue field `wildbookEncounterIds` also stores these backend submission IDs, not verified Wildbook encounter IDs.

An observation can be marked `synced` with zero uploads when nothing is eligible. "Complete locally" is not a remote receipt. The sync result distinguishes observation counts (`synced`) from submitted detection counts (`uploaded`).

On upload or submission failure, sync stops that observation and retains earlier persisted IDs; later attempts skip those detections. Each failed attempt increments `retryCount`; the fifth failure marks `failedPermanent` and presents "Needs attention", but explicit Retry and Upload All still include those rows. These upload retries are user-triggered, not a background reconnect service.

Stored IDs prevent resending acknowledged detections only after the local write succeeds. There is no client-supplied idempotency key or server-side deduplication guarantee in this contract: a lost acknowledgement or failed local receipt write can still lead to a duplicate submission on retry. Keep local evidence until the required review and handoff are independently confirmed.