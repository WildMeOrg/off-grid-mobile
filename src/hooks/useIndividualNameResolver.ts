import { useCallback } from 'react';
import type { EmbeddingPack, LocalIndividual, MatchCandidate } from '../types';
import { usePackIndividualInfo } from '../screens/MatchReviewScreen/usePackIndividualInfo';

/**
 * Resolves an approved/candidate individual id to a display name, covering
 * both pack individuals (resolved async from the pack's embeddings/index.json
 * via usePackIndividualInfo) and local provisional `FIELD-*` individuals
 * (resolved from the store's localIndividuals). Shared by Observation Detail
 * and Sync so both screens show the same name for the same individual
 * instead of each re-implementing this lookup.
 */
export function useIndividualNameResolver(
  candidates: MatchCandidate[],
  packs: EmbeddingPack[],
  localIndividuals: LocalIndividual[],
): (individualId: string | null) => string | null {
  const packIndividualInfo = usePackIndividualInfo(candidates, packs);

  return useCallback(
    (individualId: string | null): string | null => {
      if (!individualId) {
        return null;
      }
      if (individualId.startsWith('FIELD-')) {
        const local = localIndividuals.find((ind) => ind.localId === individualId);
        return local?.userLabel ?? `New sighting (${individualId})`;
      }
      return packIndividualInfo[individualId]?.name ?? individualId;
    },
    [localIndividuals, packIndividualInfo],
  );
}
