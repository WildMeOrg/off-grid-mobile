import RNFS from 'react-native-fs';
import type { EmbeddingPack, EmbeddingPackManifest, PackIndividual } from '../../types';
import type { PackIndexFile } from './types';
import { validatePack } from './validator';
import type { PackValidationResult } from './validator';
import { hasSafeIndividualPhotoPaths } from './paths';
import logger from '../../utils/logger';

const PACKS_DIR = `${RNFS.DocumentDirectoryPath}/embedding_packs`;

class PackManager {
  async initialize(): Promise<void> {
    const exists = await RNFS.exists(PACKS_DIR);
    if (!exists) {
      await RNFS.mkdir(PACKS_DIR);
    }
    logger.log('[PackManager] Initialized packs directory');
  }

  async loadPackIndex(indexFilePath: string): Promise<PackIndividual[]> {
    const content = await RNFS.readFile(indexFilePath, 'utf8');
    const parsed: PackIndexFile = JSON.parse(content);
    if (!parsed || !Array.isArray(parsed.individuals) || !parsed.individuals.every(hasSafeIndividualPhotoPaths)) {
      throw new Error('Pack index contains unsafe individual or reference-photo paths');
    }
    return parsed.individuals;
  }

  async loadManifest(manifestPath: string): Promise<EmbeddingPackManifest> {
    const content = await RNFS.readFile(manifestPath, 'utf8');
    return JSON.parse(content);
  }

  getEmbeddingsForIndividual(
    allEmbeddings: Float32Array,
    individual: PackIndividual,
    embeddingDim: number,
  ): number[][] {
    // Defense-in-depth behind the pack validator: a silent short slice here
    // would flow NaN cosine scores into match results.
    const { embeddingOffset, embeddingCount } = individual;
    if (
      embeddingOffset < 0 ||
      embeddingCount < 0 ||
      (embeddingOffset + embeddingCount) * embeddingDim > allEmbeddings.length
    ) {
      throw new RangeError(
        `Embedding range for individual ${individual.id} (offset ${embeddingOffset}, count ${embeddingCount}, dim ${embeddingDim}) exceeds buffer of ${allEmbeddings.length} floats`,
      );
    }
    const result: number[][] = [];
    for (let i = 0; i < embeddingCount; i++) {
      const start = (embeddingOffset + i) * embeddingDim;
      const vec = Array.from(allEmbeddings.slice(start, start + embeddingDim));
      result.push(vec);
    }
    return result;
  }

  /**
   * Fully validate a pack directory before it is admitted to the store.
   * The single entry point for pack installation: callers build the
   * EmbeddingPack record (status 'ready', validatedAt now) from the
   * returned manifest on success.
   */
  async installPack(packDir: string): Promise<PackValidationResult> {
    const result = await validatePack(packDir);
    if (!result.ok) {
      logger.warn(
        `[PackManager] Pack at ${packDir} failed validation: ${result.errors
          .map((e) => e.code)
          .join(', ')}`,
      );
    }
    return result;
  }

  /**
   * Re-validate persisted packs against the filesystem on startup.
   * Packs that already passed a full check get the cheap mode (existence +
   * size + bounds, no hashing); never-validated packs get the full check.
   * Failures are quarantined in place — files are kept on disk for recovery.
   */
  async reconcilePacks(packs: EmbeddingPack[]): Promise<EmbeddingPack[]> {
    return Promise.all(
      packs.map(async (pack) => {
        const result = await validatePack(pack.packDir, {
          skipChecksums: Boolean(pack.validatedAt),
        });
        if (result.ok) {
          return {
            ...pack,
            status: 'ready' as const,
            validationErrors: undefined,
            validatedAt: pack.validatedAt ?? new Date().toISOString(),
          };
        }
        logger.warn(
          `[PackManager] Quarantining pack ${pack.id}: ${result.errors
            .map((e) => e.code)
            .join(', ')}`,
        );
        return {
          ...pack,
          status: 'quarantined' as const,
          validationErrors: result.errors.map((e) => `${e.code}: ${e.detail}`),
        };
      }),
    );
  }

  async deletePack(packDir: string): Promise<void> {
    const exists = await RNFS.exists(packDir);
    if (exists) {
      await RNFS.unlink(packDir);
      logger.log(`[PackManager] Deleted pack: ${packDir}`);
    }
  }

  getPacksDir(): string {
    return PACKS_DIR;
  }
}

export const packManager = new PackManager();
