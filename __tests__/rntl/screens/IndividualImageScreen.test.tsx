import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { useWildlifeStore } from '../../../src/stores/wildlifeStore';
import { loadBrowserIndividuals, loadReferencePhotos, resolveLocalPhoto } from '../../../src/services/individualBrowser/files';
import { makeDetection, makeIndividual, makeObservation, makePack } from '../../utils/individualBrowserFixtures';
import { IndividualImageScreen } from '../../../src/screens/IndividualImageScreen';

const mockGoBack = jest.fn();
const mockSetParams = jest.fn();
let mockImageKey = 'reference:one.jpg';
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ goBack: mockGoBack, setParams: mockSetParams }),
  useRoute: () => ({ params: { packId: 'project-1', individualId: 'individual-1', imageKey: mockImageKey } }),
  useIsFocused: () => true,
}));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-vector-icons/Feather', () => 'Icon');
jest.mock('react-native-gesture-handler', () => {
  const gesture = () => ({
    onStart: jest.fn().mockReturnThis(), onUpdate: jest.fn().mockReturnThis(), averageTouches: jest.fn().mockReturnThis(),
  });
  return { GestureHandlerRootView: 'View', GestureDetector: 'View', Gesture: { Pinch: gesture, Pan: gesture, Simultaneous: jest.fn() } };
});
jest.mock('../../../src/services/individualBrowser/files', () => ({
  ...jest.requireActual('../../../src/services/individualBrowser/files'),
  loadBrowserIndividuals: jest.fn(), loadReferencePhotos: jest.fn(), resolveLocalPhoto: jest.fn(),
}));

const reference = { key: 'reference:one.jpg', kind: 'reference', uri: '/mock/documents/embedding_packs/test/reference_photos/individual-1/one.jpg' };

describe('IndividualImageScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockImageKey = reference.key;
    (loadBrowserIndividuals as jest.Mock).mockReset().mockResolvedValue([makeIndividual()]);
    (loadReferencePhotos as jest.Mock).mockReset().mockResolvedValue([reference]);
    (resolveLocalPhoto as jest.Mock).mockReset().mockImplementation(async (uri: string) => uri);
    await act(async () => { useWildlifeStore.setState({ packs: [makePack()], observations: [makeObservation()] }); });
  });

  it('fits the complete image and offers zoom, image navigation and a single back action', async () => {
    const screen = render(<IndividualImageScreen />);
    const image = await screen.findByTestId('inspected-image', {}, { timeout: 5000 });
    expect(image.props.resizeMode).toBe('contain');
    expect(image.props.source.uri).toBe(`file://${reference.uri}`);
    fireEvent.press(screen.getByLabelText('Zoom in'));
    fireEvent.press(screen.getByLabelText('Zoom out'));
    fireEvent.press(screen.getByLabelText('Fit image'));
    expect(screen.getByLabelText('Previous image')).toBeDisabled();
    fireEvent.press(screen.getByLabelText('Next image'));
    expect(mockSetParams).toHaveBeenCalledWith({ imageKey: JSON.stringify(['source', 'observation-1']) });
    fireEvent.press(screen.getByTestId('browser-back'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('removes an open local image immediately after a review correction', async () => {
    mockImageKey = JSON.stringify(['crop', 'observation-1', 'detection-1']);
    const screen = render(<IndividualImageScreen />);
    await screen.findByTestId('inspected-image');
    expect(screen.getByText('Local detection crop')).toBeTruthy();
    expect(screen.getByText('Local field-review links are not WhiskerBook identity confirmation.')).toBeTruthy();
    const detection = makeDetection();
    await act(async () => {
      useWildlifeStore.setState({ observations: [makeObservation([makeDetection({
        matchResult: { ...detection.matchResult, approvedIndividual: 'individual-2' },
      })])] });
    });
    expect(screen.queryByTestId('inspected-image')).toBeNull();
    expect(screen.getByText('Image no longer available for this individual')).toBeTruthy();
  });

  it('removes an open source photo when its observation is deleted', async () => {
    mockImageKey = JSON.stringify(['source', 'observation-1']);
    const screen = render(<IndividualImageScreen />);
    await screen.findByTestId('inspected-image');
    await act(async () => { useWildlifeStore.setState({ observations: [] }); });
    expect(screen.queryByTestId('inspected-image')).toBeNull();
  });

  it('does not retain old references after a pack replacement or removal', async () => {
    const screen = render(<IndividualImageScreen />);
    await screen.findByTestId('inspected-image');
    (loadReferencePhotos as jest.Mock).mockResolvedValue([]);
    await act(async () => { useWildlifeStore.setState({ packs: [makePack({ packVersion: 'version-2' })] }); });
    await screen.findByText('Image no longer available for this individual');
    expect(screen.queryByTestId('inspected-image')).toBeNull();
    await act(async () => { useWildlifeStore.setState({ packs: [] }); });
    expect(screen.getByText('Pack removed or unavailable')).toBeTruthy();
  });

  it('shows a missing or undecodable image without touching stored evidence', async () => {
    const screen = render(<IndividualImageScreen />);
    fireEvent(await screen.findByTestId('inspected-image'), 'error');
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(useWildlifeStore.getState().observations).toEqual([makeObservation()]);
    screen.unmount();
    mockImageKey = JSON.stringify(['crop', 'observation-1', 'detection-1']);
    (resolveLocalPhoto as jest.Mock).mockResolvedValue(null);
    const missing = render(<IndividualImageScreen />);
    await missing.findByText('Image unavailable');
    expect(missing.queryByTestId('inspected-image')).toBeNull();
  });
});