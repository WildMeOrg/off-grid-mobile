import RNFS from 'react-native-fs';

/** Filesystem layout for the debug-only golden batch evaluator. All paths live under the app's private document directory -- never external/shared storage. */

export function batchDir(): string {
  return `${RNFS.DocumentDirectoryPath}/batch`;
}

/** Where the orchestration script stages source images before triggering a run. */
export function stagedDir(): string {
  return `${batchDir()}/staged`;
}

/** The one-shot run request the evaluator watches for on startup. */
export function requestPath(): string {
  return `${batchDir()}/request.json`;
}

export function resultsRootDir(): string {
  return `${batchDir()}/results`;
}

export function runResultsDir(runId: string): string {
  return `${resultsRootDir()}/${runId}`;
}

export function statusPath(runId: string): string {
  return `${runResultsDir(runId)}/status.json`;
}

export function detectionsJsonlPath(runId: string): string {
  return `${runResultsDir(runId)}/detections.jsonl`;
}

export function summaryCsvPath(runId: string): string {
  return `${runResultsDir(runId)}/summary.csv`;
}

export function runMetadataPath(runId: string): string {
  return `${runResultsDir(runId)}/run-metadata.json`;
}

/** Where the original request is moved once consumed -- the audit record for a run. */
export function consumedRequestPath(runId: string): string {
  return `${runResultsDir(runId)}/request.json`;
}
