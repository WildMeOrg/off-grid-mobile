import {
  assertEmbeddingDimension,
  EmbeddingDimensionError,
} from '../../../../src/services/goldenBatchEvaluator/embeddingValidation';
import { EXPECTED_EMBEDDING_DIM } from '../../../../src/services/goldenBatchEvaluator/types';

describe('assertEmbeddingDimension', () => {
  it('does not throw for exactly 2152 floats', () => {
    const embedding = new Array(EXPECTED_EMBEDDING_DIM).fill(0.1);
    expect(() => assertEmbeddingDimension(embedding)).not.toThrow();
  });

  it('throws EmbeddingDimensionError for a shorter embedding', () => {
    const embedding = new Array(2048).fill(0.1);
    expect(() => assertEmbeddingDimension(embedding)).toThrow(
      EmbeddingDimensionError,
    );
  });

  it('throws EmbeddingDimensionError for a longer embedding', () => {
    const embedding = new Array(4096).fill(0.1);
    expect(() => assertEmbeddingDimension(embedding)).toThrow(
      EmbeddingDimensionError,
    );
  });

  it('throws for an empty embedding', () => {
    expect(() => assertEmbeddingDimension([])).toThrow(EmbeddingDimensionError);
  });

  it('reports the actual dimension on the error', () => {
    try {
      assertEmbeddingDimension(new Array(512).fill(0));
      fail('expected assertEmbeddingDimension to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingDimensionError);
      expect((error as EmbeddingDimensionError).actualDim).toBe(512);
      expect((error as Error).message).toContain('2152');
      expect((error as Error).message).toContain('512');
    }
  });
});
