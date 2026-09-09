import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { useWildlifeStore } from '../../../src/stores/wildlifeStore';
import { loadBrowserIndividuals } from '../../../src/services/individualBrowser/files';
import { makeDetection, makeIndividual, makeObservation, makePack } from '../../utils/individualBrowserFixtures';
import { ObservationDetailScreen } from '../../../src/screens/ObservationDetailScreen';
import { PackDetailScreen } from '../../../src/screens/PackDetailScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { observationId: 'observation-1', packId: 'project-1' } }),
  useIsFocused: () => true,
}));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-vector-icons/Feather', () => 'Icon');
jest.mock('../../../src/services/individualBrowser/files', () => ({
  ...jest.requireActual('../../../src/services/individualBrowser/files'), loadBrowserIndividuals: jest.fn(),
}));

describe('Individual browser entry points', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    (loadBrowserIndividuals as jest.Mock).mockReset().mockResolvedValue([makeIndividual()]);
    await act(async () => {
      useWildlifeStore.setState({ packs: [makePack()], observations: [makeObservation()], syncQueue: [], localIndividuals: [] });
    });
  });

  it('opens the installed pack roster from pack details and supports back navigation', () => {
    const screen = render(<PackDetailScreen />);
    fireEvent.press(screen.getByTestId('browse-pack-individuals'));
    expect(mockNavigate).toHaveBeenCalledWith('Individuals', { packId: 'project-1' });
    fireEvent.press(screen.getByTestId('browser-back'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('opens an approved observation identity within its recorded project', async () => {
    const screen = render(<ObservationDetailScreen />);
    fireEvent.press(await screen.findByLabelText('View individual individual-1', {}, { timeout: 5000 }));
    expect(mockNavigate).toHaveBeenCalledWith('IndividualDetail', { packId: 'project-1', individualId: 'individual-1' });
    await act(async () => { useWildlifeStore.setState({ packs: [] }); });
    expect(screen.queryByLabelText('View individual individual-1')).toBeNull();
  });

  it.each(['pending', 'rejected'] as const)('does not expose a candidate or %s decision as a linked identity', async reviewStatus => {
    const detection = makeDetection();
    useWildlifeStore.setState({ observations: [makeObservation([makeDetection({
      matchResult: { ...detection.matchResult, reviewStatus },
    })])] });
    const screen = render(<ObservationDetailScreen />);
    await act(async () => {});
    expect(screen.queryByLabelText('View individual individual-1')).toBeNull();
  });

  it.each([null, 'other-project'])('does not join another installed project to provenance %s', async projectId => {
    const detection = makeDetection();
    useWildlifeStore.setState({ observations: [makeObservation([makeDetection({
      encounterFields: { ...detection.encounterFields, projectId },
    })])] });
    const screen = render(<ObservationDetailScreen />);
    await act(async () => {});
    expect(screen.queryByLabelText('View individual individual-1')).toBeNull();
    expect(screen.queryByText('Button')).toBeNull();
    expect(loadBrowserIndividuals).not.toHaveBeenCalled();
  });

  it('keeps FIELD identities provisional without a pack profile link', async () => {
    const detection = makeDetection();
    useWildlifeStore.setState({ observations: [makeObservation([makeDetection({
      matchResult: { ...detection.matchResult, approvedIndividual: 'FIELD-001' },
    })])] });
    const screen = render(<ObservationDetailScreen />);
    await act(async () => {});
    expect(screen.queryByLabelText('View individual FIELD-001')).toBeNull();
    expect(screen.getByTestId('detection-decision-0').props.children).toBe('New sighting (FIELD-001)');
  });
});