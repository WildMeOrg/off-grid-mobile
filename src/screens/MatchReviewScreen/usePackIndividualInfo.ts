import { useEffect, useState } from 'react';
import type { EmbeddingPack, MatchCandidate } from '../../types';
import { packManager } from '../../services/packManager';
import { resolvePackPhoto } from '../../services/packManager/paths';
import logger from '../../utils/logger';

/** Resolved from a pack's `embeddings/index.json` -- display name + ref photo. */
export interface PackIndividualInfo {
  name: string;
  refPhotoUri: string | null;
}

/**
 * Resolve one pack's individuals into a name/photo lookup for the given
 * candidate IDs still pending resolution. Extracted from the hook below so
 * a broken pack index can be caught and logged per-pack without aborting
 * resolution for the others.
 */
async function resolvePackIndividuals(
  pack: EmbeddingPack,
  packCandidates: MatchCandidate[],
  pendingIds: Set<string>,
): Promise<Record<string, PackIndividualInfo>> {
  const resolved: Record<string, PackIndividualInfo> = {};
  try {
    const individuals = await packManager.loadPackIndex(pack.indexFile);
    for (const individual of individuals) {
      if (!pendingIds.has(individual.id)) {
        continue;
      }
      const matchingCandidate = packCandidates.find(
        c => c.individualId === individual.id,
      );
      const refPhotoFilename =
        individual.referencePhotos[matchingCandidate?.refPhotoIndex ?? 0] ??
        individual.referencePhotos[0];
      resolved[individual.id] = {
        name: individual.name ?? individual.id,
        refPhotoUri: refPhotoFilename
          ? await resolvePackPhoto(pack.packDir, individual, refPhotoFilename)
          : null,
      };
    }
  } catch (error) {
    logger.warn(
      `[MatchReview] Failed to resolve pack index for ${pack.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return resolved;
}

/**
 * Pack individuals' display name and reference photo live in the pack's
 * embeddings/index.json, not in the match candidate itself, so they are
 * resolved asynchronously here rather than inline in the render path.
 */
export function usePackIndividualInfo(
  candidates: MatchCandidate[],
  packs: EmbeddingPack[],
): Record<string, PackIndividualInfo> {
  const [packIndividualInfo, setPackIndividualInfo] = useState<
    Record<string, PackIndividualInfo>
  >({});

  useEffect(() => {
    const packCandidates = candidates.filter(c => c.source === 'pack');
    const pendingIds = new Set(
      packCandidates
        .filter(c => !packIndividualInfo[c.individualId])
        .map(c => c.individualId),
    );
    if (pendingIds.size === 0) {
      return;
    }

    let cancelled = false;

    (async () => {
      const resolved: Record<string, PackIndividualInfo> = {};
      for (const pack of packs) {
        Object.assign(
          resolved,
          await resolvePackIndividuals(pack, packCandidates, pendingIds),
        );
      }
      if (!cancelled && Object.keys(resolved).length > 0) {
        setPackIndividualInfo(prev => ({ ...prev, ...resolved }));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, packs]);

  return packIndividualInfo;
}
