import { packManager } from '../packManager';
import type { EmbeddingPack } from '../../types';
import logger from '../../utils/logger';

/**
 * Maps a pack individual's stable ID to the individual's display name, so
 * golden batch results are human-readable without a second
 * join against the installed packs. Reuses `packManager.loadPackIndex` --
 * no reimplementation of pack index parsing.
 */
export async function buildIndividualNameIndex(
  packs: EmbeddingPack[],
): Promise<Map<string, string>> {
  const index = new Map<string, string>();

  await Promise.all(
    packs.map(async (pack) => {
      try {
        const individuals = await packManager.loadPackIndex(pack.indexFile);
        for (const individual of individuals) {
          // Later packs win on collision -- collisions are not expected
          // (stable IDs are globally unique), but a deterministic result is
          // better than a nondeterministic one.
          index.set(individual.id, individual.name ?? individual.id);
        }
      } catch (error) {
        logger.error(
          `[GoldenBatchEvaluator] Failed to load pack index for ${pack.id}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }),
  );

  return index;
}
