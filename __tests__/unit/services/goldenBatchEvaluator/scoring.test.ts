import {
  scoreDetection,
  summarizeRun,
} from '../../../../src/services/goldenBatchEvaluator/scoring';
import { DEFAULT_MATCH_THRESHOLD } from '../../../../src/services/goldenBatchEvaluator/types';
import type { GoldenBatchCandidate } from '../../../../src/services/goldenBatchEvaluator/types';

function candidate(overrides: Partial<GoldenBatchCandidate> = {}): GoldenBatchCandidate {
  return {
    stableId: 'WB-ELE-001',
    score: 0.9,
    source: 'pack',
    individualName: 'Belle',
    ...overrides,
  };
}

function detection(
  predictedStableId: string | null,
  candidateStableIds: string[] = predictedStableId
    ? [predictedStableId]
    : [],
) {
  return { predictedStableId, candidateStableIds };
}

describe('scoreDetection', () => {
  it('returns null prediction when there are no candidates', () => {
    expect(scoreDetection([])).toEqual({
      predictedStableId: null,
      predictedScore: null,
    });
  });

  it('accepts the top candidate when its score clears the threshold', () => {
    const result = scoreDetection([candidate({ score: 0.8 })], 0.5);
    expect(result).toEqual({ predictedStableId: 'WB-ELE-001', predictedScore: 0.8 });
  });

  it('rejects the top candidate when its score is below the threshold', () => {
    const result = scoreDetection([candidate({ score: 0.3 })], 0.5);
    expect(result).toEqual({ predictedStableId: null, predictedScore: 0.3 });
  });

  it('treats a score exactly at the threshold as accepted', () => {
    const result = scoreDetection([candidate({ score: 0.5 })], 0.5);
    expect(result.predictedStableId).toBe('WB-ELE-001');
  });

  it('uses the default match threshold when none is provided', () => {
    const result = scoreDetection([
      candidate({ score: DEFAULT_MATCH_THRESHOLD - 0.01 }),
    ]);
    expect(result.predictedStableId).toBeNull();
  });

  it('only considers the top-ranked candidate, ignoring the rest', () => {
    const result = scoreDetection(
      [candidate({ stableId: 'best', score: 0.9 }), candidate({ stableId: 'second', score: 0.99 })],
      0.5,
    );
    expect(result.predictedStableId).toBe('best');
  });
});

describe('summarizeRun', () => {
  it('scores a known item as correct when a detection matches the expected stable ID', () => {
    const summary = summarizeRun(
      [
        {
          knownStatus: 'known',
          expectedStableId: 'WB-ELE-001',
          detections: [detection('WB-ELE-001')],
        },
      ],
      0.5,
    );
    expect(summary.knownCorrect).toBe(1);
    expect(summary.knownIncorrect).toBe(0);
    expect(summary.accuracyKnown).toBe(1);
  });

  it('scores a known item as incorrect when every detection predicts the wrong individual', () => {
    const summary = summarizeRun([
      {
        knownStatus: 'known',
        expectedStableId: 'WB-ELE-001',
        detections: [detection('WB-ELE-002')],
      },
    ]);
    expect(summary.knownIncorrect).toBe(1);
    expect(summary.knownCorrect).toBe(0);
    expect(summary.accuracyKnown).toBe(0);
  });

  it('counts a known item with zero detections separately from incorrect', () => {
    const summary = summarizeRun([
      { knownStatus: 'known', expectedStableId: 'WB-ELE-001', detections: [] },
    ]);
    expect(summary.knownNoDetection).toBe(1);
    expect(summary.knownCorrect).toBe(0);
    expect(summary.knownIncorrect).toBe(0);
    // No-detection items are excluded from the accuracy denominator.
    expect(summary.accuracyKnown).toBeNull();
  });

  it('credits a known item as correct if ANY detection (of several) matches', () => {
    const summary = summarizeRun([
      {
        knownStatus: 'known',
        expectedStableId: 'WB-ELE-001',
        detections: [
          detection(null, ['WB-ELE-999']),
          detection('WB-ELE-001'),
        ],
      },
    ]);
    expect(summary.knownCorrect).toBe(1);
    expect(summary.knownTop1).toBe(1);
    expect(summary.knownTop5).toBe(1);
  });

  it('reports threshold-independent top-1 and top-5 retrieval', () => {
    const summary = summarizeRun([
      {
        knownStatus: 'known',
        expectedStableId: 'WB-ELE-001',
        detections: [
          detection(null, ['WB-ELE-002', 'WB-ELE-001', 'WB-ELE-003']),
        ],
      },
    ]);

    expect(summary.knownCorrect).toBe(0);
    expect(summary.knownTop1).toBe(0);
    expect(summary.knownTop5).toBe(1);
    expect(summary.knownTop1Rate).toBe(0);
    expect(summary.knownTop5Rate).toBe(1);
  });

  it('scores an unknown (open-set) item as correctly rejected when nothing matches', () => {
    const summary = summarizeRun([
      {
        knownStatus: 'unknown',
        expectedStableId: null,
        detections: [detection(null, ['WB-ELE-003'])],
      },
    ]);
    expect(summary.unknownCorrectlyRejected).toBe(1);
    expect(summary.unknownFalseAccept).toBe(0);
    expect(summary.openSetRejectionRate).toBe(1);
  });

  it('scores an unknown item as a false accept when a detection matches a pack individual', () => {
    const summary = summarizeRun([
      {
        knownStatus: 'unknown',
        expectedStableId: null,
        detections: [detection('WB-ELE-003')],
      },
    ]);
    expect(summary.unknownFalseAccept).toBe(1);
    expect(summary.unknownCorrectlyRejected).toBe(0);
    expect(summary.openSetRejectionRate).toBe(0);
  });

  it('counts an unknown item with zero detections separately from a correct rejection', () => {
    const summary = summarizeRun([
      { knownStatus: 'unknown', expectedStableId: null, detections: [] },
    ]);
    expect(summary.unknownNoDetection).toBe(1);
    expect(summary.unknownCorrectlyRejected).toBe(0);
    expect(summary.openSetRejectionRate).toBeNull();
  });

  it('produces the documented six-elephant known + Taffy open-set mix', () => {
    const knownNames = ['Belle', 'Bentley', 'Janky', 'Jumbo', 'Ntando', 'Ntlanu'];
    const knownItems = knownNames.map((name) => ({
      knownStatus: 'known' as const,
      expectedStableId: `WB-${name.toUpperCase()}`,
      detections: [
        detection(`WB-${name.toUpperCase()}`),
      ],
    }));
    const taffyItems = Array.from({ length: 3 }, () => ({
      knownStatus: 'unknown' as const,
      expectedStableId: null,
      detections: [detection(null, ['WB-NOT-TAFFY'])],
    }));

    const summary = summarizeRun([...knownItems, ...taffyItems]);
    expect(summary.knownItems).toBe(6);
    expect(summary.unknownItems).toBe(3);
    expect(summary.knownCorrect).toBe(6);
    expect(summary.knownTop1).toBe(6);
    expect(summary.knownTop5).toBe(6);
    expect(summary.accuracyKnown).toBe(1);
    expect(summary.unknownCorrectlyRejected).toBe(3);
    expect(summary.openSetRejectionRate).toBe(1);
  });

  it('returns null rates for an empty run rather than dividing by zero', () => {
    const summary = summarizeRun([]);
    expect(summary.accuracyKnown).toBeNull();
    expect(summary.openSetRejectionRate).toBeNull();
    expect(summary.totalItems).toBe(0);
  });
});
