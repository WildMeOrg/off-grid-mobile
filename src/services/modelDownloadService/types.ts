// Re-exported from the shared fileDownloadService — this file's types moved
// there so packDownloadService (embedding pack .zip) can share the identical
// integrity/retry contract with modelDownloadService (MiewID .onnx). Kept as
// a re-export, not deleted, so every existing `from './modelDownloadService'`
// / `from '../modelDownloadService'` import keeps working unchanged.
export type {
  DownloadErrorCode,
  DownloadOutcome,
  DownloadOptions,
} from '../fileDownloadService/types';
