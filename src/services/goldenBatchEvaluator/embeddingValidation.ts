import { EXPECTED_EMBEDDING_DIM } from './types';

/**
 * Raised when a MiewID embedding does not have the expected raw
 * dimensionality (2152 floats for v4.1, see docs/EMBEDDING_PACK_FORMAT.md).
 * A model/pipeline regression that silently truncated or resized the
 * embedding must fail loudly here instead of writing bad data into the
 * golden batch results.
 */
export class EmbeddingDimensionError extends Error {
  constructor(public readonly actualDim: number) {
    super(
      `Expected a ${EXPECTED_EMBEDDING_DIM}-dim raw MiewID v4.1 embedding, got ${actualDim}`,
    );
    this.name = 'EmbeddingDimensionError';
  }
}

/** Throws `EmbeddingDimensionError` unless `embedding` has exactly `EXPECTED_EMBEDDING_DIM` entries. */
export function assertEmbeddingDimension(embedding: number[]): void {
  if (embedding.length !== EXPECTED_EMBEDDING_DIM) {
    throw new EmbeddingDimensionError(embedding.length);
  }
}
