import { useEffect, useMemo, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { useWildlifeStore } from '../../stores/wildlifeStore';
import type { EmbeddingPack, PackIndividual } from '../../types';
import { loadBrowserIndividuals, loadReferencePhotos, packIdentity, resolveLocalPhoto } from '../../services/individualBrowser/files';
import type { ReferencePhoto } from '../../services/individualBrowser/files';
import { composeLocalEvidence } from '../../services/individualBrowser/model';
import type { LocalEvidence } from '../../services/individualBrowser/model';

export type BrowserPhoto = ReferencePhoto | LocalEvidence;

export type BrowserStatus = 'loading' | 'ready' | 'missing' | 'quarantined' | 'unvalidated' | 'error';

export function useBrowserPack(packId: string | undefined) {
  const pack = useWildlifeStore(state => state.packs.find(item => item.id === packId));
  const focused = useIsFocused();
  const identity = pack ? packIdentity(pack) : '';
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    identity: string; status: 'loading' | 'ready' | 'error'; individuals: PackIndividual[];
  }>({ identity: '', status: 'loading', individuals: [] });

  useEffect(() => {
    if (!pack || pack.status !== 'ready' || !focused) return;
    let cancelled = false;
    setResult(previous => previous.identity === identity && previous.status === 'ready'
      ? previous : { identity, status: 'loading', individuals: [] });
    loadBrowserIndividuals(pack).then(individuals => {
      if (!cancelled) setResult({ identity, status: 'ready', individuals });
    }).catch(() => {
      if (!cancelled) setResult({ identity, status: 'error', individuals: [] });
    });
    return () => { cancelled = true; };
  }, [pack, identity, focused, attempt]);

  let status: BrowserStatus = 'missing';
  if (pack?.status === 'quarantined') status = 'quarantined';
  else if (pack && pack.status !== 'ready') status = 'unvalidated';
  else if (pack) status = result.identity === identity ? result.status : 'loading';

  return {
    pack, identity, status,
    individuals: status === 'ready' ? result.individuals : [],
    retry: () => setAttempt(previous => previous + 1),
  };
}

export function useReferencePhotos(pack: EmbeddingPack | undefined, individual: PackIndividual | undefined, limit = 3) {
  const identity = pack && individual
    ? JSON.stringify([packIdentity(pack), individual.id, individual.referencePhotos, limit]) : '';
  const [result, setResult] = useState<{ identity: string; photos: ReferencePhoto[]; loading: boolean }>({
    identity: '', photos: [], loading: true,
  });

  useEffect(() => {
    if (!pack || !individual) return;
    let cancelled = false;
    setResult({ identity, photos: [], loading: true });
    loadReferencePhotos({ pack, individual, limit, isCancelled: () => cancelled }).then(photos => {
      if (!cancelled) setResult({ identity, photos, loading: false });
    }).catch(() => {
      if (!cancelled) setResult({ identity, photos: [], loading: false });
    });
    return () => { cancelled = true; };
  }, [pack, individual, identity, limit]);

  const current = Boolean(pack && individual && result.identity === identity);
  return { photos: current ? result.photos : [], loading: !current || result.loading };
}

export function useIndividualBrowser(packId: string, individualId: string) {
  const browser = useBrowserPack(packId);
  const individual = browser.individuals.find(item => item.id === individualId);
  const observations = useWildlifeStore(state => state.observations);
  const localEvidence = useMemo(() => individual
    ? composeLocalEvidence({ observations, packId, individualId }) : [],
  [individual, observations, packId, individualId]);
  const references = useReferencePhotos(individual ? browser.pack : undefined, individual);
  return { ...browser, individual, localEvidence, references, photos: [...references.photos, ...localEvidence] };
}

export function usePhotoUri(photo: BrowserPhoto | undefined) {
  const rawUri = photo?.kind !== 'reference' ? photo?.uri : undefined;
  const [resolved, setResolved] = useState<{ source: string; path: string | null }>({ source: '', path: null });
  useEffect(() => {
    if (!rawUri) return;
    let cancelled = false;
    resolveLocalPhoto(rawUri).then(path => {
      if (!cancelled) setResolved({ source: rawUri, path });
    }).catch(() => {
      if (!cancelled) setResolved({ source: rawUri, path: null });
    });
    return () => { cancelled = true; };
  }, [rawUri]);
  if (!photo) return { path: null, loading: false };
  if (photo.kind === 'reference') return { path: photo.uri, loading: false };
  return { path: resolved.source === rawUri ? resolved.path : null, loading: resolved.source !== rawUri };
}