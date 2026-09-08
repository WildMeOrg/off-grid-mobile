import type {
  GoldenBatchManifestItem,
  GoldenBatchRunRequest,
} from './types';

/**
 * Structural validation for the one-shot golden batch run request. Hand
 * rolled (no runtime schema dependency in this project, see
 * `packManager/validator.ts` for the same convention) -- errors accumulate
 * rather than short-circuiting so a caller sees every problem at once.
 */

export type GoldenBatchValidationErrorCode =
  | 'not-an-object'
  | 'invalid-format-version'
  | 'invalid-run-id'
  | 'invalid-items'
  | 'empty-items'
  | 'invalid-item'
  | 'invalid-match-threshold';

export interface GoldenBatchValidationError {
  code: GoldenBatchValidationErrorCode;
  detail: string;
}

export type GoldenBatchValidationResult =
  | { ok: true; request: GoldenBatchRunRequest }
  | { ok: false; errors: GoldenBatchValidationError[] };

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isIsoDateString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));

/**
 * A staged-path must be a relative path under `batch/staged/` -- no leading
 * slash, no drive letter, and no `..` traversal segment. Guards the device
 * orchestration contract: the evaluator only ever reads inside its own
 * `batch/staged/` directory.
 */
function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  if (value.startsWith('/') || value.startsWith('\\')) {
    return false;
  }
  if (/^[a-zA-Z]:/.test(value)) {
    return false;
  }
  const segments = value.split(/[/\\]/);
  return segments.every((segment) => segment !== '..' && segment !== '.');
}

const KNOWN_STATUSES = ['known', 'unknown'] as const;

function findItemFieldErrors(
  record: Record<string, unknown>,
  prefix: string,
): GoldenBatchValidationError[] {
  const errors: GoldenBatchValidationError[] = [];

  if (!isSafeRelativePath(record.stagedPath)) {
    errors.push({
      code: 'invalid-item',
      detail: `${prefix}.stagedPath must be a relative path with no '..' traversal`,
    });
  }
  if (!isNonEmptyString(record.expectedFolder)) {
    errors.push({
      code: 'invalid-item',
      detail: `${prefix}.expectedFolder must be a non-empty string`,
    });
  }
  if (!isNonEmptyString(record.expectedName)) {
    errors.push({
      code: 'invalid-item',
      detail: `${prefix}.expectedName must be a non-empty string`,
    });
  }
  if (
    record.expectedStableId !== null &&
    !isNonEmptyString(record.expectedStableId)
  ) {
    errors.push({
      code: 'invalid-item',
      detail: `${prefix}.expectedStableId must be a non-empty string or null`,
    });
  }
  if (!KNOWN_STATUSES.includes(record.knownStatus as 'known' | 'unknown')) {
    errors.push({
      code: 'invalid-item',
      detail: `${prefix}.knownStatus must be 'known' or 'unknown'`,
    });
  }
  if (record.captureDateIso !== null && !isIsoDateString(record.captureDateIso)) {
    errors.push({
      code: 'invalid-item',
      detail: `${prefix}.captureDateIso must be an ISO date string or null`,
    });
  }
  if (!isIsoDateString(record.cutoffIso)) {
    errors.push({
      code: 'invalid-item',
      detail: `${prefix}.cutoffIso must be an ISO date string`,
    });
  }

  return errors;
}

/**
 * An "unknown" (open-set) item asserting an expected stable ID contradicts
 * itself -- open-set items exist precisely because they have no stable ID,
 * and a "known" item without one has nothing to score against.
 */
function findKnownStatusConsistencyErrors(
  record: Record<string, unknown>,
  prefix: string,
): GoldenBatchValidationError[] {
  const errors: GoldenBatchValidationError[] = [];

  if (record.knownStatus === 'unknown' && record.expectedStableId !== null) {
    errors.push({
      code: 'invalid-item',
      detail: `${prefix} is 'unknown' but declares a non-null expectedStableId`,
    });
  }
  if (record.knownStatus === 'known' && record.expectedStableId === null) {
    errors.push({
      code: 'invalid-item',
      detail: `${prefix} is 'known' but declares a null expectedStableId`,
    });
  }

  return errors;
}

function findItemErrors(
  item: unknown,
  index: number,
): GoldenBatchValidationError[] {
  const prefix = `items[${index}]`;

  if (typeof item !== 'object' || item === null) {
    return [{ code: 'invalid-item', detail: `${prefix} is not an object` }];
  }
  const record = item as Record<string, unknown>;

  return [
    ...findItemFieldErrors(record, prefix),
    ...findKnownStatusConsistencyErrors(record, prefix),
  ];
}

/**
 * Validate an unknown JSON value as a `GoldenBatchRunRequest`. Returns every
 * structural problem found -- callers should treat any error as "do not
 * run", not just the first one.
 */
export function validateGoldenBatchRequest(
  input: unknown,
): GoldenBatchValidationResult {
  if (typeof input !== 'object' || input === null) {
    return {
      ok: false,
      errors: [{ code: 'not-an-object', detail: 'request is not an object' }],
    };
  }
  const record = input as Record<string, unknown>;
  const errors: GoldenBatchValidationError[] = [];

  if (record.formatVersion !== '1') {
    errors.push({
      code: 'invalid-format-version',
      detail: `formatVersion must be '1', got ${JSON.stringify(record.formatVersion)}`,
    });
  }
  if (!isSafeRelativePath(record.runId) || record.runId.includes('/')) {
    errors.push({
      code: 'invalid-run-id',
      detail: 'runId must be a non-empty string with no path separators',
    });
  }
  if (
    record.matchThreshold !== undefined &&
    (typeof record.matchThreshold !== 'number' ||
      record.matchThreshold < -1 ||
      record.matchThreshold > 1)
  ) {
    errors.push({
      code: 'invalid-match-threshold',
      detail: 'matchThreshold must be a number between -1 and 1 when provided',
    });
  }

  if (!Array.isArray(record.items)) {
    errors.push({ code: 'invalid-items', detail: "'items' must be an array" });
  } else if (record.items.length === 0) {
    errors.push({ code: 'empty-items', detail: "'items' must not be empty" });
  } else {
    record.items.forEach((item, index) => {
      errors.push(...findItemErrors(item, index));
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    request: {
      formatVersion: '1',
      runId: record.runId as string,
      createdAt: isIsoDateString(record.createdAt)
        ? (record.createdAt as string)
        : new Date().toISOString(),
      items: record.items as GoldenBatchManifestItem[],
      matchThreshold: record.matchThreshold as number | undefined,
    },
  };
}
