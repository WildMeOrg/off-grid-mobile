import { act, renderHook, waitFor } from '@testing-library/react-native';
import { loadBrowserIndividuals } from '../../../src/services/individualBrowser/files';
import { resolvePackPhoto } from '../../../src/services/packManager/paths';
import { usePackIndividualInfo } from '../../../src/screens/MatchReviewScreen/usePackIndividualInfo';
import type { EmbeddingPack, MatchCandidate, PackIndividual } from '../../../src/types';
import { makeIndividual, makePack } from '../../utils/individualBrowserFixtures';

jest.mock('../../../src/services/individualBrowser/files', () => ({
  ...jest.requireActual('../../../src/services/individualBrowser/files'), loadBrowserIndividuals: jest.fn(),
}));
jest.mock('../../../src/services/packManager/paths', () => ({
  ...jest.requireActual('../../../src/services/packManager/paths'), resolvePackPhoto: jest.fn(),
}));
const candidates: MatchCandidate[] = [{ individualId: 'individual-1', source: 'pack', refPhotoIndex: 0, score: 0.9 }];

describe('usePackIndividualInfo scope and invalidation', () => {
  beforeEach(() => {
    (loadBrowserIndividuals as jest.Mock).mockReset().mockResolvedValue([makeIndividual()]);
    (resolvePackPhoto as jest.Mock).mockReset().mockResolvedValue(null);
  });

  it('does not resolve an ID that exists in multiple projects', async () => {
    const { result } = renderHook(() => usePackIndividualInfo(candidates, [makePack(), makePack({ id: 'project-2' })]));
    await waitFor(() => expect(loadBrowserIndividuals).toHaveBeenCalledTimes(2));
    expect(result.current).toEqual({});
  });

  it('clears stale data on replacement and removal even if names or IDs are unchanged', async () => {
    const { result, rerender } = renderHook(({ packs }: { packs: EmbeddingPack[] }) => usePackIndividualInfo(candidates, packs), { initialProps: { packs: [makePack()] } });
    await waitFor(() => expect(result.current['individual-1']?.name).toBe('Button'));
    (loadBrowserIndividuals as jest.Mock).mockResolvedValue([makeIndividual({ name: 'Updated' })]);
    rerender({ packs: [makePack({ artifactSha256: 'new-archive' })] });
    expect(result.current).toEqual({});
    await waitFor(() => expect(result.current['individual-1']?.name).toBe('Updated'));
    rerender({ packs: [] });
    expect(result.current).toEqual({});
  });

  it('discards a late index result from a previous project', async () => {
    let finish: (individuals: PackIndividual[]) => void = () => undefined;
    (loadBrowserIndividuals as jest.Mock).mockImplementationOnce(() => new Promise<PackIndividual[]>(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ packs }: { packs: EmbeddingPack[] }) => usePackIndividualInfo(candidates, packs), { initialProps: { packs: [makePack()] } });
    (loadBrowserIndividuals as jest.Mock).mockResolvedValue([makeIndividual({ name: 'Other project' })]);
    rerender({ packs: [makePack({ id: 'project-2' })] });
    await waitFor(() => expect(result.current['individual-1']?.packId).toBe('project-2'));
    await act(async () => { finish([makeIndividual({ name: 'Stale' })]); });
    expect(result.current['individual-1']?.name).toBe('Other project');
  });

  it('keeps names without inventing a reference path if resolution fails', async () => {
    const packs = [makePack()];
    const { result } = renderHook(() => usePackIndividualInfo(candidates, packs));
    await waitFor(() => expect(result.current['individual-1']?.refPhotoUri).toBeNull());
  });
});