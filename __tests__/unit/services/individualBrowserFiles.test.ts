import RNFS from 'react-native-fs';
import { loadBrowserIndividuals, loadReferencePhotos, packIdentity, resolveLocalPhoto } from '../../../src/services/individualBrowser/files';
import { filterIndividuals, individualFields } from '../../../src/services/individualBrowser/model';
import { makeIndividual, makePack } from '../../utils/individualBrowserFixtures';

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/documents',
  exists: jest.fn(),
  readFile: jest.fn(),
  stat: jest.fn(),
  unlink: jest.fn(),
}));

const pack = makePack();

describe('individual browser files and catalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (RNFS.exists as jest.Mock).mockImplementation(async (path: string) => path === pack.indexFile);
    (RNFS.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ individuals: [makeIndividual()] }));
    (RNFS.stat as jest.Mock).mockImplementation(async (path: string) => ({
      canonicalPath: path,
      isDirectory: () => !/\.(jpg|json)$/.test(path),
      isFile: () => /\.(jpg|json)$/.test(path),
    }));
  });

  it('reads only the canonically contained index, never embeddings or models', async () => {
    expect(await loadBrowserIndividuals(pack)).toEqual([makeIndividual()]);
    expect(RNFS.readFile).toHaveBeenCalledTimes(1);
    expect(RNFS.readFile).toHaveBeenCalledWith(pack.indexFile, 'utf8');
  });

  it.each(['quarantined', undefined] as const)('does not browse a pack with status %s', async status => {
    await expect(loadBrowserIndividuals(makePack({ status }))).rejects.toThrow('Pack is not ready');
    expect(RNFS.readFile).not.toHaveBeenCalled();
  });

  it('fails closed for a missing index or a canonical path outside the pack', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValue(false);
    await expect(loadBrowserIndividuals(pack)).rejects.toThrow('Pack index is unavailable');
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    (RNFS.stat as jest.Mock).mockImplementation(async (path: string) => ({
      canonicalPath: path === pack.packDir ? path : '/private/outside/index.json',
      isDirectory: () => path === pack.packDir,
      isFile: () => path !== pack.packDir,
    }));
    await expect(loadBrowserIndividuals(pack)).rejects.toThrow('Pack index is unavailable');
    expect(RNFS.readFile).not.toHaveBeenCalled();
  });

  it('preserves duplicate names but rejects duplicate IDs and excludes FIELD identities', async () => {
    const second = makeIndividual({ id: 'individual-2' });
    (RNFS.readFile as jest.Mock).mockResolvedValue(JSON.stringify({
      individuals: [makeIndividual(), second, makeIndividual({ id: 'FIELD-001' })],
    }));
    expect(await loadBrowserIndividuals(pack)).toEqual([makeIndividual(), second]);
    (RNFS.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ individuals: [second, second] }));
    await expect(loadBrowserIndividuals(pack)).rejects.toThrow('duplicate individual IDs');
  });

  it('finds up to three available references without counting missing or duplicate photos', async () => {
    const individual = makeIndividual({ referencePhotos: ['missing.jpg', 'one.jpg', 'one.jpg', 'two.jpg', 'three.jpg', 'four.jpg'] });
    (RNFS.stat as jest.Mock).mockImplementation(async (path: string) => {
      if (path.endsWith('missing.jpg')) throw new Error('missing');
      return { canonicalPath: path, isDirectory: () => path === pack.packDir, isFile: () => path !== pack.packDir };
    });
    const photos = await loadReferencePhotos({ pack, individual });
    expect(photos.map(photo => photo.key)).toEqual(['reference:one.jpg', 'reference:two.jpg', 'reference:three.jpg']);
    expect(RNFS.stat).not.toHaveBeenCalledWith(expect.stringContaining('four.jpg'));
  });

  it('cancels stale reference work and never falls back to unsafe filenames', async () => {
    expect(await loadReferencePhotos({ pack, individual: makeIndividual(), isCancelled: () => true })).toEqual([]);
    expect(RNFS.stat).not.toHaveBeenCalled();
    expect(await loadReferencePhotos({ pack, individual: makeIndividual({ referencePhotos: ['../secret.jpg'] }) })).toEqual([]);
    expect(RNFS.stat).not.toHaveBeenCalled();
  });

  it('resolves only existing local files canonically inside the observation boundary', async () => {
    const path = '/mock/documents/observations/obs/original.jpg';
    expect(await resolveLocalPhoto(path)).toBe(path);
    expect(await resolveLocalPhoto(`file://${path}`)).toBe(path);
    for (const unsafe of ['/private/photo.jpg', 'https://example.invalid/a.jpg', 'content://photos/1', '/mock/documents/observations/../secret.jpg']) {
      expect(await resolveLocalPhoto(unsafe)).toBeNull();
    }
    (RNFS.stat as jest.Mock).mockRejectedValue(new Error('missing'));
    expect(await resolveLocalPhoto(path)).toBeNull();
    expect(RNFS.unlink).not.toHaveBeenCalled();
  });

  it('rejects canonical local symlink escapes', async () => {
    (RNFS.stat as jest.Mock).mockImplementation(async (path: string) => ({
      canonicalPath: path.endsWith('.jpg') ? '/private/secret.jpg' : path,
      isDirectory: () => !path.endsWith('.jpg'),
      isFile: () => path.endsWith('.jpg'),
    }));
    expect(await resolveLocalPhoto('/mock/documents/observations/obs/photo.jpg')).toBeNull();
  });

  it('rejects an observation directory redirected outside app-private documents', async () => {
    (RNFS.stat as jest.Mock).mockImplementation(async (path: string) => ({
      canonicalPath: path.replace('/mock/documents/observations', '/shared/observations'),
      isDirectory: () => !path.endsWith('.jpg'),
      isFile: () => path.endsWith('.jpg'),
    }));
    expect(await resolveLocalPhoto('/mock/documents/observations/obs/photo.jpg')).toBeNull();
    expect(RNFS.unlink).not.toHaveBeenCalled();
  });

  it('invalidates identity for version, archive, directory, or readiness changes', () => {
    for (const updated of [
      makePack({ packVersion: 'version-2' }), makePack({ artifactSha256: 'replacement' }),
      makePack({ packDir: '/replacement' }), makePack({ status: 'quarantined' }),
    ]) {
      expect(packIdentity(updated)).not.toBe(packIdentity(pack));
    }
  });

  it('searches name, stable ID and alias, filters sex, and sorts duplicate names deterministically', () => {
    const individuals = [makeIndividual({ id: 'individual-2', sex: 'male' }), makeIndividual(), makeIndividual({ id: 'other', name: null, alternateId: null, sex: null })];
    const options = { query: '', sex: 'all', sort: 'asc' } as const;
    expect(filterIndividuals(individuals, options).map(individual => individual.id)).toEqual(['individual-1', 'individual-2', 'other']);
    expect(filterIndividuals(individuals, { ...options, query: ' BUTTON ', sort: 'desc' }).map(individual => individual.id)).toEqual(['individual-2', 'individual-1']);
    expect(filterIndividuals(individuals, { ...options, query: 'alias', sex: 'female' })).toEqual([individuals[1]]);
    expect(filterIndividuals(individuals, { ...options, query: 'individual-2' })).toEqual([individuals[0]]);
    expect(filterIndividuals(individuals, { ...options, sex: 'unknown' })).toEqual([individuals[2]]);
    expect(filterIndividuals(individuals, { ...options, query: 'absent' })).toEqual([]);
  });

  it('omits absent fields, neutral counts, histories, and free-text notes', () => {
    expect(individualFields(makeIndividual({ alternateId: null, sex: null, lifeStage: 'adult', notes: 'private research notes' })))
      .toEqual([{ label: 'ID', value: 'individual-1' }, { label: 'Life stage', value: 'adult' }]);
  });
});