/** Outcome of attempting to sync one observation's reviewed detections. */
export type SyncObservationOutcome =
  /** All eligible detections (see index.ts doc comment) now have a Ganesha submission id. */
  | { status: 'synced'; submittedCount: number }
  /** At least one detection in the observation hasn't been reviewed yet -- left untouched. */
  | { status: 'waiting-for-review' }
  /** Upload or submit failed partway through; sync_queue was updated with the error/retry count. */
  | { status: 'failed'; submittedCount: number; message: string };

export type SyncObservationResult = SyncObservationOutcome & { observationId: string };

/** Aggregate result of draining the whole sync queue (the "Sync All" action). */
export interface SyncAllResult {
  synced: number;
  /**
   * Total detections actually uploaded across every synced observation --
   * distinct from `synced` (a count of observations), since an observation
   * can be marked "synced" with zero uploads (e.g. it had no elephant
   * detections at all, so there was nothing to submit). Surfacing this
   * separately avoids the misleading impression that every "synced"
   * observation sent real data to the backend.
   */
  uploaded: number;
  waitingForReview: number;
  failed: number;
}
