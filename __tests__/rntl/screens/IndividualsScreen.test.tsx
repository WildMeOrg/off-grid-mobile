import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useWildlifeStore } from '../../../src/stores/wildlifeStore';
import { loadBrowserIndividuals, loadReferencePhotos } from '../../../src/services/individualBrowser/files';
import type { PackIndividual } from '../../../src/types';
import { makeIndividual, makePack } from '../../utils/individualBrowserFixtures';
import { IndividualsScreen } from '../../../src/screens/IndividualsScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: { packId?: string } = { packId: 'project-1' };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ name: 'Individuals', params: mockRouteParams }),
  useIsFocused: () => true,
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context/jest/mock').default,
}));
jest.mock('react-native-vector-icons/Feather', () => 'Icon');
jest.mock('../../../src/components', () => ({
  ...jest.requireActual('../../../src/components'),
  AppSheet: ({ visible, children }: React.PropsWithChildren<{ visible: boolean }>) => visible ? children : null,
}));
jest.mock('../../../src/services/individualBrowser/files', () => ({
  ...jest.requireActual('../../../src/services/individualBrowser/files'),
  loadBrowserIndividuals: jest.fn(),
  loadReferencePhotos: jest.fn(),
}));

const roster = [
  makeIndividual({ id: 'individual-2', sex: 'male' }),
  makeIndividual(),
  makeIndividual({ id: 'individual-3', name: 'Zola', sex: null, alternateId: null }),
];

describe('IndividualsScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockRouteParams = { packId: 'project-1' };
    (loadBrowserIndividuals as jest.Mock).mockReset().mockResolvedValue(roster);
    (loadReferencePhotos as jest.Mock).mockReset().mockResolvedValue([]);
    await act(async () => {
      useWildlifeStore.setState({ packs: [makePack()], observations: [], miewidModel: null });
    });
  });

  it('searches name, ID and alias, sorts, and filters without an inference model', async () => {
    const screen = render(<IndividualsScreen />);
    await screen.findByText('3 individuals', {}, { timeout: 5000 });
    const rowIds = () => screen.getAllByTestId(/^individual-row-/).map(row => row.props.testID);
    expect(rowIds()).toEqual(['individual-row-individual-1', 'individual-row-individual-2', 'individual-row-individual-3']);
    fireEvent.press(screen.getByLabelText('Sort name Z to A'));
    expect(rowIds()[0]).toBe('individual-row-individual-3');
    fireEvent.changeText(screen.getByLabelText('Search individuals'), 'button');
    await waitFor(() => expect(screen.queryByTestId('individual-row-individual-3')).toBeNull());
    fireEvent.changeText(screen.getByLabelText('Search individuals'), 'individual-1');
    await waitFor(() => expect(screen.queryByTestId('individual-row-individual-2')).toBeNull());
    fireEvent.changeText(screen.getByLabelText('Search individuals'), 'alias');
    await waitFor(() => expect(screen.getByTestId('individual-row-individual-2')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Filter by sex'));
    fireEvent.press(screen.getByText('Female'));
    expect(rowIds()).toEqual(['individual-row-individual-1']);
  });

  it('navigates with stable IDs and goes back predictably', async () => {
    const screen = render(<IndividualsScreen />);
    fireEvent.press(await screen.findByTestId('individual-row-individual-2'));
    expect(mockNavigate).toHaveBeenCalledWith('IndividualDetail', { packId: 'project-1', individualId: 'individual-2' });
    fireEvent.press(screen.getByTestId('browser-back'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('shows empty search and does not offer sex filtering when unsupported', async () => {
    (loadBrowserIndividuals as jest.Mock).mockResolvedValue([makeIndividual({ sex: null })]);
    const screen = render(<IndividualsScreen />);
    await screen.findByTestId('individual-row-individual-1');
    expect(screen.queryByLabelText('Filter by sex')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Search individuals'), 'absent');
    await screen.findByText('No individuals match your search');
    fireEvent.press(screen.getByLabelText('Clear search'));
    await screen.findByTestId('individual-row-individual-1');
  });

  it('selects another installed pack without mixing its roster into the current one', async () => {
    useWildlifeStore.setState({ packs: [makePack(), makePack({ id: 'project-2', displayName: 'Second pack' })] });
    const screen = render(<IndividualsScreen />);
    await screen.findByText('3 individuals');
    (loadBrowserIndividuals as jest.Mock).mockResolvedValue([makeIndividual({ name: 'Other project' })]);
    fireEvent.press(screen.getByLabelText('Select pack'));
    fireEvent.press(screen.getByLabelText('Select Second pack'));
    await screen.findByText('Other project');
    expect(screen.queryByText('Zola')).toBeNull();
    fireEvent.press(screen.getByTestId('individual-row-individual-1'));
    expect(mockNavigate).toHaveBeenCalledWith('IndividualDetail', { packId: 'project-2', individualId: 'individual-1' });
  });

  it('handles loading, failed index retry and an empty usable pack', async () => {
    (loadBrowserIndividuals as jest.Mock).mockRejectedValueOnce(new Error('bad index'));
    const screen = render(<IndividualsScreen />);
    expect(screen.getByTestId('browser-loading')).toBeTruthy();
    await screen.findByText('Pack index unavailable');
    (loadBrowserIndividuals as jest.Mock).mockResolvedValue([]);
    fireEvent.press(screen.getByLabelText('Retry'));
    await screen.findByText('No individuals in this pack');
  });

  it('shows no-pack and quarantined states without reading an index', async () => {
    mockRouteParams = {};
    useWildlifeStore.setState({ packs: [] });
    const screen = render(<IndividualsScreen />);
    expect(screen.getByText('No installed packs')).toBeTruthy();
    await act(async () => { useWildlifeStore.setState({ packs: [makePack({ status: 'quarantined' })] }); });
    expect(screen.getByText('Pack quarantined. Browsing is unavailable.')).toBeTruthy();
    expect(loadBrowserIndividuals).not.toHaveBeenCalled();
  });

  it('discards late results after replacement and removes stale rows immediately on removal', async () => {
    let finishOldLoad: (individuals: PackIndividual[]) => void = () => undefined;
    (loadBrowserIndividuals as jest.Mock).mockImplementationOnce(() => new Promise<PackIndividual[]>(resolve => { finishOldLoad = resolve; }));
    const screen = render(<IndividualsScreen />);
    (loadBrowserIndividuals as jest.Mock).mockResolvedValue([makeIndividual({ name: 'Replacement' })]);
    await act(async () => { useWildlifeStore.setState({ packs: [makePack({ packVersion: 'version-2' })] }); });
    await screen.findByText('Replacement');
    await act(async () => { finishOldLoad(roster); });
    expect(screen.queryByText('Zola')).toBeNull();
    await act(async () => { useWildlifeStore.setState({ packs: [] }); });
    expect(screen.getByText('Pack removed or unavailable')).toBeTruthy();
    expect(screen.queryByText('Replacement')).toBeNull();
  });

  it('shows an unavailable thumbnail without constructing a fallback URI', async () => {
    const screen = render(<IndividualsScreen />);
    await screen.findByTestId('individual-row-individual-1');
    await waitFor(() => expect(screen.getAllByLabelText('Image unavailable')).toHaveLength(3));
  });
});