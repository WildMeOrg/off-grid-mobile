import RNFS from 'react-native-fs';
import { packManager } from './packManager';
import { containedPackFile } from './packManager/paths';
import { buildEmbeddingDatabase } from './embeddingDatabaseBuilder';
import { checkEmbeddingModelCompatibility } from './miewidModelManager';
import type { SpeciesConfig } from './wildlifePipeline/types';
import type {
  DetectorConfig,
  EmbeddingPack,
  EmbeddingPackManifest,
  LocalIndividual,
  MiewIDModelRecord,
} from '../types';
import logger from '../utils/logger';

/**
 * Shared production/tooling helper: turns the store's installed packs +
 * MiewID model + local individuals into the `SpeciesConfig[]` the
 * `wildlifePipeline` needs to run detect → crop → embed → match.
 *
 * Used by both the capture flow (`useCaptureFlow`) and the debug-only
 * golden batch evaluator -- extracted so neither reimplements pack
 * grouping, detector config loading, or embedding database assembly.
 */

/**
 * Fallback detector config used until packs ship real detector_config.json
 * files.
 *
 * TODO(P0): Once packs include real detector_config.json files, remove the
 * fallback and require the config to exist.
 */
const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  modelFile: '',
  architecture: 'yolov5',
  inputSize: [640, 640],
  inputChannels: 3,
  channelOrder: 'RGB',
  normalize: { mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255 },
  confidenceThreshold: 0.25,
  nmsThreshold: 0.45,
  maxDetections: 100,
  outputFormat: 'yolov5',
  classLabels: ['animal'],
  outputSpec: {
    boxFormat: 'cxcywh',
    coordinateType: 'normalized',
    layout: '[1, num_detections, 5+num_classes]',
  },
};

/** Load the detector config JSON from the pack directory, with a safe fallback. */
async function loadDetectorConfig(
  packDir: string,
  manifest: EmbeddingPackManifest | null,
): Promise<DetectorConfig> {
  try {
    if (!manifest) {
      return DEFAULT_DETECTOR_CONFIG;
    }
    const configPath = await containedPackFile(packDir, manifest.detectorModel.configFile);
    if (!configPath) {
      return DEFAULT_DETECTOR_CONFIG;
    }
    const content = await RNFS.readFile(configPath, 'utf8');
    return JSON.parse(content);
  } catch {
    // Fallback until packs ship real detector configs
    return DEFAULT_DETECTOR_CONFIG;
  }
}

/** Load a pack's manifest, or null when unreadable (fallbacks apply). */
async function loadManifestSafe(
  packDir: string,
): Promise<EmbeddingPackManifest | null> {
  try {
    const manifestPath = await containedPackFile(packDir, 'manifest.json');
    return manifestPath ? await packManager.loadManifest(manifestPath) : null;
  } catch {
    return null;
  }
}

export interface ExcludedPack {
  packId: string;
  reason: string;
}

export interface BuildSpeciesConfigsResult {
  speciesConfigs: SpeciesConfig[];
  /**
   * Packs that were installed but excluded from this run (quarantined, or
   * whose embedding model version doesn't match the installed MiewID
   * model), with a human-readable reason for logging/diagnostics.
   */
  excludedPacks: ExcludedPack[];
}

/**
 * Build the `SpeciesConfig[]` for a `wildlifePipeline.processPhoto()` run
 * from the currently installed packs, MiewID model, and local individuals.
 *
 * Filtering/grouping rules (shared by capture and golden batch tooling):
 * - Quarantined packs (failed integrity validation) are excluded.
 * - Packs whose embedding model version doesn't match the installed MiewID
 *   model are excluded -- matching across embedding spaces is meaningless.
 * - Packs sharing {species, featureClass, detector, embeddingModelVersion}
 *   are merged into one detector pass + one matching database; distinct
 *   groups each get their own pass.
 */
export async function buildActiveSpeciesConfigs(
  packs: EmbeddingPack[],
  miewidModel: MiewIDModelRecord,
  localIndividuals: LocalIndividual[],
): Promise<BuildSpeciesConfigsResult> {
  const excludedPacks: ExcludedPack[] = [];

  const healthyPacks = packs.filter((pack) => {
    if (pack.status === 'quarantined') {
      excludedPacks.push({ packId: pack.id, reason: 'quarantined' });
      return false;
    }
    return true;
  });

  const compatiblePacks = healthyPacks.filter((pack) => {
    const compatibility = checkEmbeddingModelCompatibility(
      miewidModel.version,
      pack.embeddingModelVersion,
    );
    if (compatibility !== 'compatible') {
      logger.warn(
        `[SpeciesConfigBuilder] Excluding pack ${pack.id}: embedding model ${pack.embeddingModelVersion} incompatible with installed ${miewidModel.version}`,
      );
      excludedPacks.push({
        packId: pack.id,
        reason: `embedding model ${pack.embeddingModelVersion} incompatible with installed ${miewidModel.version}`,
      });
      return false;
    }
    return true;
  });

  const groups = new Map<string, typeof compatiblePacks>();
  for (const pack of compatiblePacks) {
    const key = [
      pack.species,
      pack.featureClass,
      pack.detectorModelFile,
      pack.embeddingModelVersion,
    ].join('|');
    groups.set(key, [...(groups.get(key) ?? []), pack]);
  }

  const speciesConfigs: SpeciesConfig[] = await Promise.all(
    Array.from(groups.values()).map(async (groupPacks) => {
      const primary = groupPacks[0];
      const manifest = await loadManifestSafe(primary.packDir);
      return {
        packId: primary.id,
        projectId: groupPacks.length === 1 ? primary.id : null,
        species: primary.species,
        detectorModelPath: primary.detectorModelFile,
        detectorConfig: await loadDetectorConfig(primary.packDir, manifest),
        embeddingDatabase: await buildEmbeddingDatabase(
          primary.species,
          groupPacks,
          localIndividuals,
        ),
        embeddingInputSize: manifest?.embeddingModel.inputSize,
        embeddingNormalize: manifest?.embeddingModel.normalize,
      };
    }),
  );

  return { speciesConfigs, excludedPacks };
}
