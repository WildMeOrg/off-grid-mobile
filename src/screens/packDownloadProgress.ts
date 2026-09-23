export type DownloadStage = 'model' | 'pack';

export interface DownloadProgress {
  stage: DownloadStage;
  bytesWritten: number;
  contentLength: number;
}

// Same 1024-based unit as the pack card's size, so the two never disagree.
const MB = 1024 * 1024;

const STAGE_LABELS: Record<DownloadStage, { active: string; finishing: string }> = {
  model: {
    active: 'Downloading identification model...',
    finishing: 'Verifying identification model...',
  },
  pack: {
    active: 'Downloading embedding pack...',
    finishing: 'Verifying and installing embedding pack...',
  },
};

export const KEEP_APP_OPEN_HINT = 'Keep EleBook open until this finishes.';

const toMegabytes = (bytes: number): string => (bytes / MB).toFixed(1);

const isComplete = ({ bytesWritten, contentLength }: DownloadProgress): boolean =>
  contentLength > 0 && bytesWritten >= contentLength;

/**
 * Stage-level text, for the live region: it changes a handful of times per download rather
 * than every second, so a screen reader is not flooded with percentages.
 */
export function describeDownloadStage(progress: DownloadProgress | null): string {
  if (!progress) {
    return 'Preparing download...';
  }
  const labels = STAGE_LABELS[progress.stage];
  return isComplete(progress) ? labels.finishing : labels.active;
}

/**
 * The model and the pack are each around 200 MB and download back to back behind one busy
 * button. Without a byte count, a slow link and a real stall look the same.
 */
export function describeDownloadAmount(progress: DownloadProgress | null): string | null {
  if (!progress || isComplete(progress) || progress.bytesWritten <= 0) {
    return null;
  }
  const { bytesWritten, contentLength } = progress;
  if (contentLength <= 0) {
    return `${toMegabytes(bytesWritten)} MB`;
  }
  const percent = Math.floor((bytesWritten / contentLength) * 100);
  return `${percent}% (${toMegabytes(bytesWritten)} of ${toMegabytes(contentLength)} MB)`;
}

/** Adapts a download service's `onProgress(bytesWritten, contentLength)` to one stage. */
export const progressReporter =
  (stage: DownloadStage, onChange: (progress: DownloadProgress) => void) =>
  (bytesWritten: number, contentLength: number): void =>
    onChange({ stage, bytesWritten, contentLength });
