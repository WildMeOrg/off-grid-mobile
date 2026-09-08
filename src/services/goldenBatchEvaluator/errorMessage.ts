/** Normalizes any thrown value into a human-readable message for logs/results. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
