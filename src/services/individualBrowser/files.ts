import RNFS from 'react-native-fs';
import type { EmbeddingPack, PackIndividual } from '../../types';
import { packManager } from '../packManager';
import { containedPackFile, resolvePackFile, resolvePackPhoto } from '../packManager/paths';

export interface ReferencePhoto {
  key: string;
  kind: 'reference';
  uri: string;
}

export function packIdentity(pack: EmbeddingPack): string {
  return JSON.stringify([
    pack.id, pack.packVersion, pack.artifactSha256, pack.packDir,
    pack.indexFile, pack.status, pack.validatedAt, pack.downloadedAt,
  ]);
}

export async function loadBrowserIndividuals(pack: EmbeddingPack): Promise<PackIndividual[]> {
  if (pack.status !== 'ready') {
    throw new Error('Pack is not ready');
  }
  const indexPath = await resolvePackFile(pack.packDir, 'index.json');
  if (!indexPath) {
    throw new Error('Pack index is unavailable');
  }
  const individuals = await packManager.loadPackIndex(indexPath);
  const seenIds = new Set<string>();
  for (const individual of individuals) {
    if (seenIds.has(individual.id)) {
      throw new Error('Pack contains duplicate individual IDs');
    }
    seenIds.add(individual.id);
  }
  return individuals.filter(individual => !individual.id.startsWith('FIELD-'));
}

export async function loadReferencePhotos(context: {
  pack: EmbeddingPack;
  individual: PackIndividual;
  limit?: number;
  isCancelled?: () => boolean;
}): Promise<ReferencePhoto[]> {
  const { pack, individual, isCancelled } = context;
  if (pack.status !== 'ready') return [];
  const photos: ReferencePhoto[] = [];
  const paths = new Set<string>();
  const limit = Math.min(3, Math.max(1, context.limit ?? 3));
  for (const filename of new Set(individual.referencePhotos)) {
    if (isCancelled?.()) return [];
    const uri = await resolvePackPhoto(pack.packDir, individual, filename);
    if (uri && !paths.has(uri)) {
      paths.add(uri);
      photos.push({ key: `reference:${filename}`, kind: 'reference', uri });
    }
    if (photos.length === limit) break;
  }
  return isCancelled?.() ? [] : photos;
}

export async function resolveLocalPhoto(uri: string): Promise<string | null> {
  const root = `${RNFS.DocumentDirectoryPath}/observations`;
  const path = uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
  if (!path.startsWith(`${root}/`)) return null;
  const resolved = await containedPackFile(root, path.slice(root.length + 1));
  if (!resolved) return null;
  try {
    const documents = await RNFS.stat(RNFS.DocumentDirectoryPath);
    return documents.isDirectory() && typeof documents.canonicalPath === 'string'
      && resolved.startsWith(`${documents.canonicalPath.replace(/\/+$/, '')}/observations/`)
      ? resolved : null;
  } catch {
    return null;
  }
}