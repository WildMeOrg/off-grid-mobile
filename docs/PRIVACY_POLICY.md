# Privacy policy for EleBook

*Updated: 2026-09-07 - Reflects offline wildlife identification and user-initiated uploads.*

## Overview

EleBook supports offline wildlife identification. After a valid model and embedding pack are installed, detection, embedding extraction, matching, and review run on the device. Sign-in, profile requests, downloads, update checks, and uploads use network services.

This policy describes the mobile client's behavior. The organization operating your configured backend is responsible for its account, storage, access, and retention policies; those server implementations are not included in this repository.

## Data stored on the device

EleBook stores:

- A copy of each observation's source photo and its detection crops in app-private files. The source image in the photo library or picker is not deleted by this copy.
- Observation timestamps, available GPS coordinates and accuracy, device platform/OS metadata, field notes, detections, embeddings, match candidates, review decisions, and upload bookkeeping. Observations and the upload queue are persisted in SQLite.
- Downloaded models, packs, reference photographs, local provisional `FIELD-*` individuals, and settings. Pack metadata and local individuals also use local application storage.
- Account profile information, including identity, name, email, role, and organization information supplied by the backend. Authentication tokens use OS secure storage separately from observation data.

Photos, precise locations, movement patterns, notes, timestamps, and device metadata can be sensitive even without a person's name.

### Gallery imports and metadata

Gallery imports record the import-time timestamp and the device's current GPS location, when available. A batch uses one GPS lookup. The app does not use the photo's EXIF capture time or location for these observation fields, so they may not describe when or where the photograph was taken. Location permission can be declined; unavailable GPS is stored as absent.

The persistence step copies the source image and stores generated crops. It does not guarantee that embedded image metadata has been stripped or anonymized. Do not assume imported photos, crops, or observation metadata are anonymous.

## Accounts and deployment configuration

Sign-in uses Microsoft Entra authorization-code authentication with PKCE in the system browser. The mobile app has no client secret. Public API URLs, project IDs, tenant/client IDs, and redirect URLs are configuration, not credentials. API requests use access tokens; refresh tokens and ID tokens are also stored locally in OS secure storage.

Token storage is namespaced by six deployment fields: API base URL, project ID, tenant ID, mobile client ID, API client ID, and redirect URL. The authentication service does not read the legacy shared token service. This is token isolation only: it does not isolate or migrate saved profiles, SQLite observations, local individuals, or packs between deployments. Changing deployment configuration is not a safe data-reset mechanism. See [setup](setup.md) for configuration.

## Model and pack downloads

The app requests artifact metadata from the configured backend, then downloads from the returned URLs. The embedding model is separate from the per-species detector pack. The current workflow does not automatically fetch models from a pack's Hugging Face provenance field or download packs directly from Wildbook.

Signed download and upload URLs grant time-limited bearer access. Anyone holding a usable URL may exercise its granted permissions until it expires or is otherwise invalidated. Keep these URLs out of public issues, shared screenshots, and logs. Authorization to obtain them and private storage/artifact policies must be enforced by the deployment's servers.

## Uploads

Capture adds observations to a local queue. In the current field workflow, a user starts transfer through **Upload** or **Upload All** while signed in; adding an observation to the queue is not an automatic background upload. An observation waits until every detection has a review decision. Approved pack matches and approved provisional `FIELD-*` identities without an existing submission receipt are eligible.

Uploads send detection crops to the backend-provided storage destination and submit their URLs with the selected or provisional identity, candidate identities and scores, species, bounding box, available GPS coordinates, notes, timestamps, and device metadata. Provisional unknown submissions also upload the original observation photo. These images may contain sensitive background details or embedded metadata.

**Received by EleBook** means the configured API returned submission receipts. It does not confirm Wildbook/WhiskerBook ingestion or scientifically confirmed identity. Similarity scores are not calibrated identity probabilities, and `FIELD-*` IDs remain provisional review identifiers. See [API behavior](api.md) for the request contract.

## Local controls and deletion

**Settings > Security** provides a local passphrase lock and account sign-out. New passphrase verifiers use PBKDF2-HMAC-SHA-256 with 600,000 iterations, a native-generated 16-byte random salt, and a 32-byte derived hash in OS secure storage. No insecure random fallback is used. This protects the stored verifier; it does not encrypt photos, packs, or SQLite data or replace device-level security.

An existing legacy lock is upgraded after successful legacy verification. The new entry must be stored and read back before the old entry is removed. Failed attempts or failed migration writes do not remove the legacy entry. Once a current-format entry exists, verification never falls back to the legacy hash. Unreadable lock storage keeps the lock enabled. Legacy verification retains its original weaknesses until migration; change the passphrase after upgrading. Do not downgrade to an older app after migration, because older builds do not understand the new lock entry.

Sign-out clears tokens for the current deployment and attempts server-side access-token revocation on a best-effort basis. It does not erase observations, profile data, models, or packs, and does not guarantee that a server token or browser session is immediately invalidated. Resetting onboarding is not data deletion either.

Local state resets and file removal are distinct operations; they are not a guarantee of secure erasure. Pack updates can leave previous version directories on the device. Removing local app data does not delete photo-library originals or records already uploaded. Use the device's storage controls when retiring a device, and contact the deployment operator about server-side access, deletion, and retention. This client policy does not establish a server retention period or promise removal from backups.

## Services, diagnostics, and conservation privacy

The configured identity provider, backend, and artifact/storage hosts receive requests needed for their functions and may retain operational or security records under their own policies. The app's JavaScript logger emits output only in development builds; this is not a guarantee that native libraries, the OS, or servers produce no diagnostics. Treat development logs as potentially sensitive.

Deployment operators should restrict photos, precise sightings, and movement information to authorized users. Citizen and public views should not expose precise locations. Client-side filtering alone is not sufficient authorization, and this policy is not an audit of server RBAC or storage configuration.

## Contact

For questions about uploaded data, account access, or retention, contact the organization operating your deployment.

The upstream project's issue tracker remains https://github.com/alichherawalla/off-grid-mobile/issues. Do not include private photos, precise coordinates, tokens, signed URLs, or identifiable field records in public issues.

## Changes

Any changes to this policy will be reflected in this document with an updated date.
