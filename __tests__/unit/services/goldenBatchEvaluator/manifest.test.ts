import { validateGoldenBatchRequest } from '../../../../src/services/goldenBatchEvaluator/manifest';
import type { GoldenBatchManifestItem } from '../../../../src/services/goldenBatchEvaluator/types';

function makeItem(
  overrides: Partial<GoldenBatchManifestItem> = {},
): GoldenBatchManifestItem {
  return {
    stagedPath: 'Belle/IMG_001.jpg',
    expectedFolder: 'Belle',
    expectedName: 'IMG_001.jpg',
    expectedStableId: 'WB-ELE-001',
    knownStatus: 'known',
    captureDateIso: '2026-03-01T10:00:00Z',
    cutoffIso: '2026-02-23T00:00:00Z',
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<{
    formatVersion: unknown;
    runId: unknown;
    createdAt: unknown;
    items: unknown;
    matchThreshold: unknown;
  }> = {},
): Record<string, unknown> {
  return {
    formatVersion: '1',
    runId: 'run-2026-08-24-001',
    createdAt: '2026-08-24T12:00:00Z',
    items: [makeItem()],
    ...overrides,
  };
}

describe('validateGoldenBatchRequest', () => {
  it('accepts a well-formed request', () => {
    const result = validateGoldenBatchRequest(makeRequest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.runId).toBe('run-2026-08-24-001');
      expect(result.request.items).toHaveLength(1);
    }
  });

  it('rejects a non-object payload', () => {
    const result = validateGoldenBatchRequest('not an object');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe('not-an-object');
    }
  });

  it('rejects an unsupported format version', () => {
    const result = validateGoldenBatchRequest(makeRequest({ formatVersion: '2' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'invalid-format-version')).toBe(true);
    }
  });

  it('rejects a missing or path-unsafe runId', () => {
    const missing = validateGoldenBatchRequest(makeRequest({ runId: '' }));
    expect(missing.ok).toBe(false);

    const traversal = validateGoldenBatchRequest(
      makeRequest({ runId: '../escape' }),
    );
    expect(traversal.ok).toBe(false);

    const withSlash = validateGoldenBatchRequest(
      makeRequest({ runId: 'a/b' }),
    );
    expect(withSlash.ok).toBe(false);
  });

  it('rejects an empty items array', () => {
    const result = validateGoldenBatchRequest(makeRequest({ items: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe('empty-items');
    }
  });

  it('rejects a non-array items field', () => {
    const result = validateGoldenBatchRequest(makeRequest({ items: 'nope' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe('invalid-items');
    }
  });

  it('rejects an item with an absolute stagedPath', () => {
    const result = validateGoldenBatchRequest(
      makeRequest({ items: [makeItem({ stagedPath: '/etc/passwd' })] }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an item whose stagedPath traverses out of the staged directory', () => {
    const result = validateGoldenBatchRequest(
      makeRequest({
        items: [makeItem({ stagedPath: '../../outside.jpg' })],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an item with a Windows drive-letter stagedPath', () => {
    const result = validateGoldenBatchRequest(
      makeRequest({ items: [makeItem({ stagedPath: 'C:\\evil.jpg' })] }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a 'known' item with a null expectedStableId", () => {
    const result = validateGoldenBatchRequest(
      makeRequest({
        items: [makeItem({ knownStatus: 'known', expectedStableId: null })],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts an 'unknown' (open-set) item with a null expectedStableId", () => {
    const result = validateGoldenBatchRequest(
      makeRequest({
        items: [
          makeItem({
            expectedFolder: 'Taffy',
            expectedName: 'IMG_900.jpg',
            knownStatus: 'unknown',
            expectedStableId: null,
          }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an 'unknown' item that declares a non-null expectedStableId", () => {
    const result = validateGoldenBatchRequest(
      makeRequest({
        items: [
          makeItem({ knownStatus: 'unknown', expectedStableId: 'WB-ELE-001' }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an item with an invalid knownStatus value', () => {
    const result = validateGoldenBatchRequest(
      makeRequest({
        items: [makeItem({ knownStatus: 'maybe' as unknown as 'known' })],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an item with a non-ISO cutoffIso', () => {
    const result = validateGoldenBatchRequest(
      makeRequest({ items: [makeItem({ cutoffIso: 'not-a-date' })] }),
    );
    expect(result.ok).toBe(false);
  });

  it('accepts a null captureDateIso (EXIF-less staged image)', () => {
    const result = validateGoldenBatchRequest(
      makeRequest({ items: [makeItem({ captureDateIso: null })] }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects an out-of-range matchThreshold', () => {
    const result = validateGoldenBatchRequest(
      makeRequest({ matchThreshold: 1.5 }),
    );
    expect(result.ok).toBe(false);
  });

  it('accepts a valid matchThreshold', () => {
    const result = validateGoldenBatchRequest(
      makeRequest({ matchThreshold: 0.65 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.matchThreshold).toBe(0.65);
    }
  });

  it('accumulates multiple errors instead of stopping at the first', () => {
    const result = validateGoldenBatchRequest(
      makeRequest({
        formatVersion: '9',
        runId: '',
        items: [makeItem({ expectedFolder: '' })],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(1);
    }
  });
});
