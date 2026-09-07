import RNFS from 'react-native-fs';
import type { EmbeddingPackManifest, PackIndividual } from '../../types';

export function isSafePackRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || /[\\:%?#]/.test(value)) {
    return false;
  }
  if (Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    return false;
  }
  return value.split('/').every(segment => (
    segment.length > 0 && segment !== '.' && segment !== '..' && segment.trim() === segment
  ));
}

export function hasSafeIndividualPhotoPaths(individual: Pick<PackIndividual, 'id' | 'referencePhotos'>): boolean {
  return Boolean(individual)
    && isSafePackRelativePath(individual.id)
    && !individual.id.includes('/')
    && Array.isArray(individual.referencePhotos)
    && individual.referencePhotos.every(isSafePackRelativePath);
}

export function unsafeManifestPaths(manifest: EmbeddingPackManifest): string[] {
  return [
    manifest.detectorModel.filename,
    manifest.detectorModel.configFile,
    ...Object.keys(manifest.checksums ?? {}),
  ].filter(name => !isSafePackRelativePath(name));
}

export async function containedPackFile(packDir: string, relativePath: string): Promise<string | null> {
  if (!isSafePackRelativePath(relativePath)) {
    return null;
  }
  try {
    const [root, file] = await Promise.all([
      RNFS.stat(packDir),
      RNFS.stat(`${packDir}/${relativePath}`),
    ]);
    const canonicalRoot = root.canonicalPath;
    const canonicalFile = file.canonicalPath;
    if (typeof canonicalRoot !== 'string' || typeof canonicalFile !== 'string'
      || !canonicalRoot.startsWith('/') || !root.isDirectory() || !file.isFile()) {
      return null;
    }
    return canonicalFile.startsWith(`${canonicalRoot.replace(/\/+$/, '')}/`) ? canonicalFile : null;
  } catch {
    return null;
  }
}

export async function resolvePackPhoto(
  packDir: string,
  individual: Pick<PackIndividual, 'id' | 'referencePhotos'>,
  filename: string,
): Promise<string | null> {
  if (!hasSafeIndividualPhotoPaths(individual) || !isSafePackRelativePath(filename)) {
    return null;
  }
  return containedPackFile(packDir, `reference_photos/${individual.id}/${filename}`);
}

export async function resolvePackFile(packDir: string, name: string): Promise<string | null> {
  if (!isSafePackRelativePath(name)) {
    return null;
  }
  const candidates = name.includes('/')
    ? [name]
    : [
        name,
        `embeddings/${name}`,
        `models/${name}`,
        `config/${name}`,
      ];
  for (const candidate of candidates) {
    if (await RNFS.exists(`${packDir}/${candidate}`)) {
      return containedPackFile(packDir, candidate);
    }
  }
  return null;
}