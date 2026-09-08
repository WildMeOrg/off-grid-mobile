import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useWildlifeStore } from '../../../src/stores/wildlifeStore';
import { loadBrowserIndividuals, loadReferencePhotos, resolveLocalPhoto } from '../../../src/services/individualBrowser/files';
import { makeDetection, makeIndividual, makeObservation, makePack } from '../../utils/individualBrowserFixtures';
import { IndividualDetailScreen } from '../../../src/screens/IndividualDetailScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { packId: 'project-1', individualId: 'individual-1' } }),
  useIsFocused: () => true,
}));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-vector-icons/Feather', () => 'Icon');
jest.mock('../../../src/services/individualBrowser/files', () => ({
  ...jest.requireActual('../../../src/services/individualBrowser/files'),
  loadBrowserIndividuals: jest.fn(), loadReferencePhotos: jest.fn(), resolveLocalPhoto: jest.fn(),
}));

const references = [
  { key: 'reference:one.jpg', kind: 'reference', uri: '/mock/documents/embedding_packs/test/reference_photos/individual-1/one.jpg' },
  { key: 'reference:two.jpg', kind: 'reference', uri: '/mock/documents/embedding_packs/test/reference_photos/individual-1/two.jpg' },
];

describe('IndividualDetailScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    (loadBrowserIndividuals as jest.Mock).mockReset().mockResolvedValue([makeIndividual()]);
    (loadReferencePhotos as jest.Mock).mockReset().mockResolvedValue(references);
    (resolveLocalPhoto as jest.Mock).mockReset().mockImplementation(async (uri: string) => uri);
    await act(async () => {
      useWildlifeStore.setState({ packs: [makePack()], observations: [makeObservation()], miewidModel: null });
    });
  });

  it('separates pack references from approved local source photos and crops without invented fields', async () => {
    const screen = render(<IndividualDetailScreen />);
    await screen.findByText('Pack references', {}, { timeout: 5000 });
    expect(screen.getByText('Locally reviewed photos')).toBeTruthy();
    expect(screen.getByText('Local field-review links are not WhiskerBook identity confirmation.')).toBeTruthy();
    expect(screen.getByText('Alias One')).toBeTruthy();
    expect(screen.getByText('female')).toBeTruthy();
    expect(screen.getByText('Local source photo')).toBeTruthy();
    expect(screen.getByText('Local detection crop')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('Pack reference')).toHaveLength(2));
    for (const absent of ['Age', 'Herd', 'First seen', 'Last seen', 'Encounter count', 'Notes', 'Location']) {
      expect(screen.queryByText(absent)).toBeNull();
    }
  });

  it('opens images by stable scope/key and preserves back navigation', async () => {
    const screen = render(<IndividualDetailScreen />);
    fireEvent.press(await screen.findByTestId('photo-reference:two.jpg'));
    expect(mockNavigate).toHaveBeenCalledWith('IndividualImage', {
      packId: 'project-1', individualId: 'individual-1', imageKey: 'reference:two.jpg',
    });
    await waitFor(() => expect(screen.getByLabelText('Inspect Local source photo')).not.toBeDisabled());
    fireEvent.press(screen.getByLabelText('Inspect Local source photo'));
    expect(mockNavigate).toHaveBeenLastCalledWith('IndividualImage', expect.objectContaining({
      packId: 'project-1', individualId: 'individual-1', imageKey: JSON.stringify(['source', 'observation-1']),
    }));
    fireEvent.press(screen.getByTestId('browser-back'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('removes reassigned and deleted evidence even when the ID remains a top candidate', async () => {
    const screen = render(<IndividualDetailScreen />);
    await screen.findByText('Local detection crop');
    const original = makeDetection();
    const corrected = makeDetection({ matchResult: { ...original.matchResult, approvedIndividual: 'individual-2' } });
    await act(async () => { useWildlifeStore.setState({ observations: [makeObservation([corrected])] }); });
    expect(screen.queryByText('Local detection crop')).toBeNull();
    expect(screen.getByText('No approved local photos for this individual')).toBeTruthy();
    await act(async () => { useWildlifeStore.setState({ observations: [makeObservation()] }); });
    expect(screen.getByText('Local source photo')).toBeTruthy();
    await act(async () => { useWildlifeStore.setState({ observations: [] }); });
    expect(screen.queryByText('Local source photo')).toBeNull();
  });

  it('does not link same IDs from other projects or unscoped legacy observations', async () => {
    const base = makeDetection();
    useWildlifeStore.setState({ observations: [makeObservation([
      makeDetection({ encounterFields: { ...base.encounterFields, projectId: 'project-2' } }),
      makeDetection({ encounterFields: { ...base.encounterFields, projectId: null } }),
    ])] });
    const screen = render(<IndividualDetailScreen />);
    await screen.findByText('No approved local photos for this individual');
    expect(screen.queryByText('Local detection crop')).toBeNull();
  });

  it('deduplicates the source but retains distinct reviewed detection crops', async () => {
    useWildlifeStore.setState({ observations: [makeObservation([
      makeDetection(), makeDetection({ id: 'detection-2', croppedImageUri: '/mock/documents/observations/observation-1/crop_detection-2.jpg' }),
    ])] });
    const screen = render(<IndividualDetailScreen />);
    await screen.findByText('Local source photo');
    expect(screen.getAllByText('Local source photo')).toHaveLength(1);
    expect(screen.getAllByText('Local detection crop')).toHaveLength(2);
  });

  it('handles missing files and decode failures without replacing or deleting evidence', async () => {
    (resolveLocalPhoto as jest.Mock).mockResolvedValue(null);
    const screen = render(<IndividualDetailScreen />);
    await screen.findByTestId('image-reference:one.jpg');
    fireEvent(screen.getByTestId('image-reference:one.jpg'), 'error');
    expect(screen.queryByTestId('image-reference:one.jpg')).toBeNull();
    await waitFor(() => expect(screen.getAllByText('Image unavailable')).toHaveLength(3));
    expect(useWildlifeStore.getState().observations).toEqual([makeObservation()]);
  });

  it('invalidates the detail and images when the same-version archive is replaced or removed', async () => {
    const screen = render(<IndividualDetailScreen />);
    await screen.findByTestId('photo-reference:one.jpg');
    (loadBrowserIndividuals as jest.Mock).mockResolvedValue([makeIndividual({ id: 'replacement-only' })]);
    await act(async () => { useWildlifeStore.setState({ packs: [makePack({ artifactSha256: 'new-archive' })] }); });
    await screen.findByText('Individual unavailable in this pack');
    expect(screen.queryByTestId('photo-reference:one.jpg')).toBeNull();
    expect(screen.queryByText('Local source photo')).toBeNull();
    await act(async () => { useWildlifeStore.setState({ packs: [] }); });
    expect(screen.getByText('Pack removed or unavailable')).toBeTruthy();
  });

  it('shows genuinely absent reference and optional metadata states', async () => {
    (loadReferencePhotos as jest.Mock).mockResolvedValue([]);
    (loadBrowserIndividuals as jest.Mock).mockResolvedValue([makeIndividual({ name: null, sex: null, alternateId: null })]);
    const screen = render(<IndividualDetailScreen />);
    await screen.findByText('No reference images available');
    expect(screen.queryByText('Alias')).toBeNull();
    expect(screen.queryByText('Sex')).toBeNull();
  });
});