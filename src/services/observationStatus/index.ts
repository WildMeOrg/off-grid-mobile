import type { Observation, SyncQueueItem } from '../../types';
import { eligibleDetections, allSubmissionIds } from '../syncEngine';

/**
 * Shared status wording for Observations, Observation Detail, and Upload.
 *
 * `Received by EleBook` records API acknowledgement, not downstream
 * Wildbook/WhiskerBook ingestion or scientific identity confirmation.
 *
 * `Needs attention` covers the failedPermanent retry-count threshold.
 * This status derivation does not check whether local evidence files exist.
 */
export type ObservationPresentationStatus =
  | 'needs-review'
  | 'ready-to-upload'
  | 'uploading'
  | 'received-by-elebook'
  | 'complete-locally'
  | 'upload-failed'
  | 'needs-attention';

export interface ObservationStatusCopy {
  label: string;
  description: string;
  action: string;
  /**
   * Semantic severity, theme-agnostic on purpose (this module intentionally
   * does not import theme/ types) -- each screen maps this to its own color
   * tokens (e.g. statusSuccess/statusWarning/statusError, or a neutral
   * text color for 'informational').
   */
  severity: 'action' | 'progress' | 'success' | 'informational' | 'error';
}

export const OBSERVATION_STATUS_COPY: Record<ObservationPresentationStatus, ObservationStatusCopy> = {
  'needs-review': {
    label: 'Needs review',
    description: 'One or more detections have no field decision.',
    action: 'Continue review',
    severity: 'action',
  },
  'ready-to-upload': {
    label: 'Ready to upload',
    description: 'Review is complete and eligible evidence remains local.',
    action: 'Upload observation',
    severity: 'action',
  },
  uploading: {
    label: 'Uploading',
    description: 'Evidence is currently being transferred.',
    action: 'Uploading',
    severity: 'progress',
  },
  'received-by-elebook': {
    label: 'Received by EleBook',
    description: 'Ganesha acknowledged every eligible submitted detection.',
    action: 'View receipt',
    severity: 'success',
  },
  'complete-locally': {
    label: 'Complete locally',
    description: 'This record has no eligible evidence to upload, such as all detections rejected.',
    action: 'No upload needed',
    severity: 'informational',
  },
  'upload-failed': {
    label: 'Upload failed',
    description: 'A retryable transfer or API error occurred.',
    action: 'Retry',
    severity: 'error',
  },
  'needs-attention': {
    label: 'Needs attention',
    description: 'Automatic retry policy is exhausted. This record is retained locally.',
    action: 'Review and retry',
    severity: 'error',
  },
};

export interface ObservationStatusPresentation extends ObservationStatusCopy {
  status: ObservationPresentationStatus;
  /** ISO timestamp of the backend receipt; only set for 'received-by-elebook'. */
  receiptTime: string | null;
  /** Count of detections with a real Ganesha submission id. */
  submissionCount: number;
  /**
   * Ready-to-render, field-plain summary of submissionCount (for example
   * "2 elephants confirmed received"), only set for 'received-by-elebook'.
   * Screens render this directly instead of formatting submissionCount
   * themselves, so the wording -- and its singular/plural grammar -- cannot
   * drift between Sync and Observation Detail.
   */
  submissionSummary: string | null;
}

/**
 * One observation (one photo) can contain more than one elephant; each
 * reviewed-and-approved detection is uploaded and acknowledged individually
 * (see allSubmissionIds doc comment in syncEngine). Naming the unit
 * "elephant" here instead of the backend term "submission" is deliberate --
 * it ties the count back to something a field user already sees on this
 * card (the detection/elephant count), rather than an unexplained noun.
 */
function formatSubmissionSummary(count: number): string {
  return count === 1 ? '1 elephant confirmed received' : `${count} elephants confirmed received`;
}

/**
 * Derives the shared presentation status from the underlying observation and
 * (if one exists) its sync_queue row. Mirrors the precedence syncEngine
 * itself already uses (see syncObservation): unreviewed detections always
 * win first, then any in-flight/failed transfer state, then the fact-based
 * local-vs-remote outcome -- computed from the observation's own detections
 * rather than solely trusting the queue's coarse `status` enum, so the
 * answer is correct even for a `pending` row that has not been touched by a
 * sync attempt yet, or for an observation with no queue row at all (e.g.
 * data captured before sync-queue auto-enqueue existed).
 */
export function deriveObservationStatus(
  observation: Observation,
  syncItem: SyncQueueItem | undefined,
): ObservationPresentationStatus {
  const hasUnreviewedDetections = observation.detections.some(
    (detection) => detection.matchResult.reviewStatus === 'pending',
  );
  if (hasUnreviewedDetections) {
    return 'needs-review';
  }

  if (syncItem?.status === 'uploading') {
    return 'uploading';
  }
  if (syncItem?.status === 'failed') {
    return 'upload-failed';
  }
  if (syncItem?.status === 'failedPermanent') {
    return 'needs-attention';
  }

  if (allSubmissionIds(observation).length > 0) {
    return 'received-by-elebook';
  }
  if (eligibleDetections(observation).length === 0) {
    return 'complete-locally';
  }
  return 'ready-to-upload';
}

/** Derived status plus its shared copy and the receipt details Observation Detail/Sync need to render. */
export function getObservationStatusPresentation(
  observation: Observation,
  syncItem: SyncQueueItem | undefined,
): ObservationStatusPresentation {
  const status = deriveObservationStatus(observation, syncItem);
  const submissionIds = allSubmissionIds(observation);
  const isReceived = status === 'received-by-elebook';
  return {
    status,
    ...OBSERVATION_STATUS_COPY[status],
    receiptTime: isReceived ? (syncItem?.syncedAt ?? null) : null,
    submissionCount: isReceived ? submissionIds.length : 0,
    submissionSummary: isReceived ? formatSubmissionSummary(submissionIds.length) : null,
  };
}
