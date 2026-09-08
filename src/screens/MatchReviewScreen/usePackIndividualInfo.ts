import { useEffect, useState } from 'react';
import type { EmbeddingPack, MatchCandidate } from '../../types';
import { loadBrowserIndividuals, packIdentity } from '../../services/individualBrowser/files';
import { resolvePackPhoto } from '../../services/packManager/paths';
import logger from '../../utils/logger';

/** Resolved from a pack's `embeddings/index.json` -- display name + ref photo. */
export interface PackIndividualInfo {
  name: string;
  refPhotoUri: string | null;
  packId: string;
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
    const individuals = await loadBrowserIndividuals(pack);
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
        packId: pack.id,
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
  const signature = JSON.stringify([
    candidates.map(candidate => [candidate.individualId, candidate.source, candidate.refPhotoIndex]),
    packs.map(packIdentity),
  ]);
  const [result, setResult] = useState<{ signature: string; info: Record<string, PackIndividualInfo> }>({ signature: '', info: {} });

  useEffect(() => {
    if (result.signature === signature) return;
    const packCandidates = candidates.filter(c => c.source === 'pack');
    const pendingIds = new Set(packCandidates.map(candidate => candidate.individualId));
    if (pendingIds.size === 0 || packs.length === 0) {
      return;
    }

    let cancelled = false;

    (async () => {
      const resolved: Record<string, PackIndividualInfo> = {};
      const ambiguousIds = new Set<string>();
      for (const pack of packs) {
        if (cancelled) return;
        const found = await resolvePackIndividuals(pack, packCandidates, pendingIds);
        for (const [individualId, info] of Object.entries(found)) {
          if (resolved[individualId]) ambiguousIds.add(individualId);
          resolved[individualId] = info;
        }
      }
      for (const individualId of ambiguousIds) delete resolved[individualId];
      if (!cancelled) {
        setResult({ signature, info: resolved });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [candidates, packs, signature, result.signature]);

  return result.signature === signature ? result.info : {};
}
