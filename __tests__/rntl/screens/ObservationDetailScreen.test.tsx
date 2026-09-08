/**
 * ObservationDetailScreen Tests
 *
 * Tests for the observation detail screen including:
 * - Renders screen with testID "observation-detail-screen"
 * - Shows source photo, capture time, safe (rounded) location summary, notes
 * - Shows per-detection crop, species, and decision text
 * - Shows candidate evidence ranked without percentage formatting
 * - Shows the shared observation-presentation status
 * - Primary action per status: Continue review / Upload observation / Retry
 * - Not-found fallback when the observationId does not resolve
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { useWildlifeStore } from '../../../src/stores/wildlifeStore';
import { initDatabase } from '../../../src/services/database';
import type { Detection, MatchCandidate, SyncQueueItem } from '../../../src/types/wildlife';
import type { Observation } from '../../../src/types';

jest.mock('../../../src/services/syncEngine', () => {
  const actual = jest.requireActual('../../../src/services/syncEngine');
  return {
    ...actual,
    syncObservation: jest.fn(),
  };
});

jest.mock('../../../src/services/packManager', () => ({
  packManager: { loadPackIndex: jest.fn() },
}));

jest.mock('../../../src/utils/authGate', () => ({
  ensureSignedIn: jest.fn(),
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: { observationId: string } = { observationId: 'obs-1' };
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }: any) => children,
    SafeAreaView: ({ children, testID, style }: any) => (
      <View testID={testID} style={style}>
        {children}
      </View>
    ),
    useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
  };
});

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return (props: Record<string, unknown>) => <Text>{String(props.name)}</Text>;
});

import { ObservationDetailScreen } from '../../../src/screens/ObservationDetailScreen';
import { syncObservation } from '../../../src/services/syncEngine';
import { ensureSignedIn } from '../../../src/utils/authGate';

const mockSyncObservation = syncObservation as jest.Mock;
const mockEnsureSignedIn = ensureSignedIn as jest.Mock;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

const createCandidate = (overrides: Partial<MatchCandidate> = {}): MatchCandidate => ({
  individualId: 'elephant-thomas',
  score: 0.95,
  source: 'pack',
  refPhotoIndex: 0,
  ...overrides,
});

const createDetection = (overrides: Partial<Detection> = {}): Detection => ({
  id: 'det-1',
  observationId: 'obs-1',
  boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  species: 'elephant',
  speciesConfidence: 0.95,
  croppedImageUri: '/data/crops/det-1.jpg',
  embedding: [0.1, 0.2, 0.3],
  matchResult: {
    topCandidates: [createCandidate()],
    approvedIndividual: 'elephant-thomas',
    reviewStatus: 'approved',
  },
  encounterFields: {
    locationId: null,
    sex: null,
    lifeStage: null,
    behavior: null,
    submitterId: null,
    projectId: null,
  },
  ganeshaSubmissionId: null,
  ...overrides,
});

const createObservation = (overrides: Partial<Observation> = {}): Observation => ({
  id: 'obs-1',
  photoUri: 'file:///photo.jpg',
  gps: { lat: -33.5123, lon: 26.9456, accuracy: 5 },
  timestamp: '2026-08-23T10:00:00Z',
  deviceInfo: { model: 'Pixel 9a', os: 'Android 16' },
  fieldNotes: null,
  detections: [createDetection()],
  createdAt: '2026-08-23T10:00:00Z',
  ...overrides,
});

const createSyncItem = (overrides: Partial<SyncQueueItem> = {}): SyncQueueItem => ({
  observationId: 'obs-1',
  status: 'pending',
  wildbookInstanceUrl: '',
  retryCount: 0,
  lastError: null,
  lastAttempt: null,
  syncedAt: null,
  wildbookEncounterIds: [],
  ...overrides,
});

describe('ObservationDetailScreen', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { observationId: 'obs-1' };
    useWildlifeStore.setState({
      observations: [],
      syncQueue: [],
      packs: [],
      localIndividuals: [],
    });
    mockEnsureSignedIn.mockResolvedValue(true);
  });

  // ==========================================================================
  // Not found
  // ==========================================================================

  it('shows a not-found message when the observation does not exist', () => {
    const { getByTestId, getByText } = render(<ObservationDetailScreen />);
    expect(getByTestId('observation-detail-screen')).toBeTruthy();
    expect(getByText('Observation not found.')).toBeTruthy();
  });

  it('back button navigates back', () => {
    const { getByTestId } = render(<ObservationDetailScreen />);
    fireEvent.press(getByTestId('back-button'));
    expect(mockGoBack).toHaveBeenCalled();
  });

  // ==========================================================================
  // Core record content
  // ==========================================================================

  it('shows the source photo, capture time, safe location summary, and notes', () => {
    useWildlifeStore.setState({
      observations: [
        createObservation({ fieldNotes: 'Calm herd near the eastern waterhole.' }),
      ],
    });

    const { getByTestId, getByText } = render(<ObservationDetailScreen />);
    expect(getByTestId('observation-detail-photo')).toBeTruthy();
    expect(getByText('Calm herd near the eastern waterhole.')).toBeTruthy();
    // Rounded to ~2 decimal degrees -- not the raw 4-decimal GPS fix.
    expect(getByText('~-33.51, 26.95 (\u00b15m)')).toBeTruthy();
  });

  it('shows "No location recorded" when GPS is unavailable', () => {
    useWildlifeStore.setState({
      observations: [createObservation({ gps: null })],
    });

    const { getByText } = render(<ObservationDetailScreen />);
    expect(getByText('No location recorded')).toBeTruthy();
  });

  it('shows per-detection crop, species, and decision text', () => {
    useWildlifeStore.setState({
      observations: [createObservation()],
    });

    const { getByTestId } = render(<ObservationDetailScreen />);
    expect(getByTestId('detection-crop-0')).toBeTruthy();
    expect(getByTestId('detection-decision-0').props.children).toContain('elephant-thomas');
  });

  it('shows "Not yet reviewed" for a pending detection', () => {
    useWildlifeStore.setState({
      observations: [
        createObservation({
          detections: [
            createDetection({
              matchResult: { topCandidates: [], approvedIndividual: null, reviewStatus: 'pending' },
            }),
          ],
        }),
      ],
    });

    const { getByTestId } = render(<ObservationDetailScreen />);
    expect(getByTestId('detection-decision-0').props.children).toBe('Not yet reviewed');
  });

  it('shows ranked candidate evidence without percentage formatting', () => {
    useWildlifeStore.setState({
      observations: [
        createObservation({
          detections: [
            createDetection({
              matchResult: {
                topCandidates: [
                  createCandidate({ individualId: 'elephant-thomas', score: 0.95 }),
                  createCandidate({ individualId: 'elephant-bella', score: 0.6 }),
                ],
                approvedIndividual: 'elephant-thomas',
                reviewStatus: 'approved',
              },
            }),
          ],
        }),
      ],
    });

    const { getByTestId, queryByText } = render(<ObservationDetailScreen />);
    expect(getByTestId('detection-0-candidate-0').props.children).toContain('Candidate 1');
    expect(getByTestId('detection-0-candidate-0').props.children).toContain('(selected)');
    expect(getByTestId('detection-0-candidate-1').props.children).toContain('Candidate 2');
    expect(queryByText(/%/)).toBeNull();
  });

  // ==========================================================================
  // Shared status + primary action
  // ==========================================================================

  it('shows "Needs review" with "Continue review" and navigates to MatchReview', () => {
    useWildlifeStore.setState({
      observations: [
        createObservation({
          detections: [
            createDetection({
              id: 'det-pending',
              matchResult: { topCandidates: [], approvedIndividual: null, reviewStatus: 'pending' },
            }),
          ],
        }),
      ],
    });

    const { getByTestId, getByText } = render(<ObservationDetailScreen />);
    expect(getByText('Needs review')).toBeTruthy();
    fireEvent.press(getByTestId('detail-action-button'));
    expect(mockNavigate).toHaveBeenCalledWith('MatchReview', {
      observationId: 'obs-1',
      detectionId: 'det-pending',
    });
  });

  it('shows "Ready to upload" and calls the sync engine on Upload observation', async () => {
    mockSyncObservation.mockResolvedValue({ observationId: 'obs-1', status: 'synced', submittedCount: 1 });
    useWildlifeStore.setState({
      observations: [createObservation()],
      syncQueue: [createSyncItem({ status: 'pending' })],
    });

    const { getByTestId, getByText } = render(<ObservationDetailScreen />);
    expect(getByText('Ready to upload')).toBeTruthy();
    fireEvent.press(getByTestId('detail-action-button'));

    await waitFor(() =>
      expect(mockSyncObservation).toHaveBeenCalledWith(expect.objectContaining({ id: 'obs-1' })),
    );
  });

  it('does not upload when not signed in', async () => {
    mockEnsureSignedIn.mockResolvedValue(false);
    useWildlifeStore.setState({
      observations: [createObservation()],
      syncQueue: [createSyncItem({ status: 'pending' })],
    });

    const { getByTestId } = render(<ObservationDetailScreen />);
    fireEvent.press(getByTestId('detail-action-button'));

    await waitFor(() => expect(mockEnsureSignedIn).toHaveBeenCalled());
    expect(mockSyncObservation).not.toHaveBeenCalled();
  });

  it('shows "Received by EleBook" with receipt time and submission count, no action button', () => {
    useWildlifeStore.setState({
      observations: [
        createObservation({
          detections: [createDetection({ ganeshaSubmissionId: 'sub-1' })],
        }),
      ],
      syncQueue: [
        createSyncItem({
          status: 'synced',
          syncedAt: '2026-08-23T11:00:00Z',
          wildbookEncounterIds: ['sub-1'],
        }),
      ],
    });

    const { getByText, queryByTestId } = render(<ObservationDetailScreen />);
    expect(getByText('Received by EleBook')).toBeTruthy();
    expect(getByText(/1 elephant confirmed received/)).toBeTruthy();
    expect(queryByTestId('detail-action-button')).toBeNull();
  });

  it('shows "Upload failed" with the error message and a Retry action', () => {
    useWildlifeStore.setState({
      observations: [createObservation()],
      syncQueue: [createSyncItem({ status: 'failed', lastError: 'Network timeout' })],
    });

    const { getByText, getByTestId } = render(<ObservationDetailScreen />);
    expect(getByText('Upload failed')).toBeTruthy();
    expect(getByText('Network timeout')).toBeTruthy();
    expect(getByTestId('detail-action-button')).toBeTruthy();
  });

  it('shows "Complete locally" with no action button', () => {
    useWildlifeStore.setState({
      observations: [
        createObservation({
          detections: [
            createDetection({
              matchResult: { topCandidates: [], approvedIndividual: null, reviewStatus: 'rejected' },
            }),
          ],
        }),
      ],
      syncQueue: [createSyncItem({ status: 'synced' })],
    });

    const { getByText, queryByTestId } = render(<ObservationDetailScreen />);
    expect(getByText('Complete locally')).toBeTruthy();
    expect(queryByTestId('detail-action-button')).toBeNull();
  });
});
