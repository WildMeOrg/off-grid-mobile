/**
 * SyncScreen Tests
 *
 * Tests for the sync queue screen including:
 * - Screen renders with correct testID
 * - Header title "Sync Queue"
 * - Sync All delegates to services/syncEngine (mocked here; the engine
 *   itself has its own unit tests)
 * - Sync queue rows show a recognizable observation summary (thumbnail,
 *   capture time, identity/detection count, notes preview) and the shared
 *   observation-presentation status instead of a GUID-first raw status
 * - Per-status primary action (Continue review / Upload observation / Retry)
 * - Technical details disclosure hides the raw observation id by default
 * - Orphaned queue rows (no matching observation) degrade gracefully
 * - Empty state
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { useWildlifeStore } from '../../../src/stores/wildlifeStore';
import { initDatabase } from '../../../src/services/database';
import type { Detection, MatchCandidate, SyncQueueItem } from '../../../src/types/wildlife';
import type { Observation } from '../../../src/types';

jest.mock('../../../src/services/syncEngine', () => {
  const actual = jest.requireActual('../../../src/services/syncEngine');
  return {
    ...actual,
    syncAllObservations: jest.fn(),
    syncObservation: jest.fn(),
  };
});

jest.mock('../../../src/services/packManager', () => ({
  packManager: { loadPackIndex: jest.fn() },
}));

jest.mock('../../../src/utils/authGate', () => ({
  ensureSignedIn: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: jest.fn(),
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    useRoute: () => ({ params: {} }),
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

import { SyncScreen } from '../../../src/screens/SyncScreen';
import { syncAllObservations, syncObservation } from '../../../src/services/syncEngine';
import { ensureSignedIn } from '../../../src/utils/authGate';

const mockSyncAllObservations = syncAllObservations as jest.Mock;
const mockSyncObservation = syncObservation as jest.Mock;
const mockEnsureSignedIn = ensureSignedIn as jest.Mock;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

const createSyncItem = (
  overrides: Partial<SyncQueueItem> = {},
): SyncQueueItem => ({
  observationId: 'obs-abc123def456',
  status: 'pending',
  wildbookInstanceUrl: '',
  retryCount: 0,
  lastError: null,
  lastAttempt: null,
  syncedAt: null,
  wildbookEncounterIds: [],
  ...overrides,
});

const createCandidate = (overrides: Partial<MatchCandidate> = {}): MatchCandidate => ({
  individualId: 'elephant-thomas',
  score: 0.95,
  source: 'pack',
  refPhotoIndex: 0,
  ...overrides,
});

const createDetection = (overrides: Partial<Detection> = {}): Detection => ({
  id: 'det-1',
  observationId: 'obs-abc123def456',
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
  id: 'obs-abc123def456',
  photoUri: 'file:///photo.jpg',
  gps: null,
  timestamp: '2026-08-23T10:00:00Z',
  deviceInfo: { model: 'test', os: 'test' },
  fieldNotes: null,
  detections: [createDetection()],
  createdAt: '2026-08-23T10:00:00Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SyncScreen', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    useWildlifeStore.setState({
      syncQueue: [],
      observations: [],
      packs: [],
      localIndividuals: [],
    });
    mockEnsureSignedIn.mockResolvedValue(true);
  });

  // ==========================================================================
  // Screen structure
  // ==========================================================================

  it('renders screen with testID "sync-screen"', () => {
    const { getByTestId } = render(<SyncScreen />);
    expect(getByTestId('sync-screen')).toBeTruthy();
  });

  it('shows "Upload Queue" title', () => {
    const { getByText } = render(<SyncScreen />);
    expect(getByText('Upload Queue')).toBeTruthy();
  });

  // ==========================================================================
  // Upload All button
  // ==========================================================================

  it('shows "Upload All" button', () => {
    const { getByTestId, getByText } = render(<SyncScreen />);
    expect(getByTestId('sync-all-button')).toBeTruthy();
    expect(getByText('Upload All')).toBeTruthy();
  });

  it('Upload All calls the sync engine and shows a summary alert', async () => {
    mockSyncAllObservations.mockResolvedValue({ synced: 2, uploaded: 1, waitingForReview: 1, failed: 0 });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByTestId } = render(<SyncScreen />);

    fireEvent.press(getByTestId('sync-all-button'));

    await waitFor(() => expect(mockSyncAllObservations).toHaveBeenCalled());
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Upload', '2 up to date (1 uploaded), 1 waiting on review'),
    );
  });

  it('does not sync when not signed in', async () => {
    mockEnsureSignedIn.mockResolvedValue(false);
    const { getByTestId } = render(<SyncScreen />);

    fireEvent.press(getByTestId('sync-all-button'));

    await waitFor(() => expect(mockEnsureSignedIn).toHaveBeenCalled());
    expect(mockSyncAllObservations).not.toHaveBeenCalled();
  });

  it('Upload All shows a generic message when there is nothing queued', async () => {
    mockSyncAllObservations.mockResolvedValue({ synced: 0, uploaded: 0, waitingForReview: 0, failed: 0 });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByTestId } = render(<SyncScreen />);

    fireEvent.press(getByTestId('sync-all-button'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Upload', 'Nothing to upload'));
  });

  // ==========================================================================
  // Recognizable observation summaries (thumbnail, time, identity, notes)
  // ==========================================================================

  it('shows a recognizable summary instead of a GUID-first row', () => {
    useWildlifeStore.setState({
      syncQueue: [createSyncItem()],
      observations: [
        createObservation({ fieldNotes: 'Seen near the eastern waterhole, calm herd.' }),
      ],
    });

    const { getByTestId, getByText, queryByText } = render(<SyncScreen />);
    expect(getByTestId('sync-thumbnail-0')).toBeTruthy();
    expect(getByTestId('sync-identity-0')).toBeTruthy();
    expect(getByText('Seen near the eastern waterhole, calm herd.')).toBeTruthy();
    // Raw GUID must not be visible until technical details is expanded.
    expect(queryByText('obs-abc123def456')).toBeNull();
  });

  it('hides the raw observation id under a technical details toggle until expanded', () => {
    useWildlifeStore.setState({
      syncQueue: [createSyncItem({ observationId: 'obs-abc123def456' })],
      observations: [createObservation({ id: 'obs-abc123def456' })],
    });

    const { getByTestId, getByText, queryByText } = render(<SyncScreen />);
    expect(queryByText('obs-abc123def456')).toBeNull();

    fireEvent.press(getByTestId('sync-technical-toggle-0'));
    expect(getByText('obs-abc123def456')).toBeTruthy();

    fireEvent.press(getByTestId('sync-technical-toggle-0'));
    expect(queryByText('obs-abc123def456')).toBeNull();
  });

  it('shows the identity summary with the detection count', () => {
    useWildlifeStore.setState({
      syncQueue: [createSyncItem()],
      observations: [createObservation()],
    });

    const { getByTestId } = render(<SyncScreen />);
    expect(getByTestId('sync-identity-0').props.children).toContain('1 detection');
  });

  // ==========================================================================
  // Shared status per row
  // ==========================================================================

  it('shows "Needs review" with a "Continue review" action for unreviewed detections', () => {
    useWildlifeStore.setState({
      syncQueue: [createSyncItem({ status: 'pending' })],
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

    const { getByText } = render(<SyncScreen />);
    expect(getByText('Needs review')).toBeTruthy();
    expect(getByText('Continue review')).toBeTruthy();
  });

  it('"Continue review" navigates to MatchReview for the first pending detection', () => {
    useWildlifeStore.setState({
      syncQueue: [createSyncItem({ observationId: 'obs-review' })],
      observations: [
        createObservation({
          id: 'obs-review',
          detections: [
            createDetection({
              id: 'det-pending',
              observationId: 'obs-review',
              matchResult: { topCandidates: [], approvedIndividual: null, reviewStatus: 'pending' },
            }),
          ],
        }),
      ],
    });

    const { getByTestId } = render(<SyncScreen />);
    fireEvent.press(getByTestId('sync-action-0'));

    expect(mockNavigate).toHaveBeenCalledWith('MatchReview', {
      observationId: 'obs-review',
      detectionId: 'det-pending',
    });
  });

  it('shows "Ready to upload" with an "Upload observation" action once reviewed', () => {
    useWildlifeStore.setState({
      syncQueue: [createSyncItem({ status: 'pending' })],
      observations: [createObservation()],
    });

    const { getByText } = render(<SyncScreen />);
    expect(getByText('Ready to upload')).toBeTruthy();
    expect(getByText('Upload observation')).toBeTruthy();
  });

  it('"Upload observation" calls the sync engine for that observation', async () => {
    mockSyncObservation.mockResolvedValue({ observationId: 'obs-abc123def456', status: 'synced', submittedCount: 1 });
    useWildlifeStore.setState({
      syncQueue: [createSyncItem({ status: 'pending' })],
      observations: [createObservation()],
    });

    const { getByTestId } = render(<SyncScreen />);
    fireEvent.press(getByTestId('sync-action-0'));

    await waitFor(() =>
      expect(mockSyncObservation).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'obs-abc123def456' }),
      ),
    );
  });

  it('shows "Received by EleBook" with receipt details once acknowledged', () => {
    useWildlifeStore.setState({
      syncQueue: [
        createSyncItem({
          status: 'synced',
          syncedAt: '2026-08-23T11:00:00Z',
          wildbookEncounterIds: ['sub-1'],
        }),
      ],
      observations: [
        createObservation({
          detections: [createDetection({ ganeshaSubmissionId: 'sub-1' })],
        }),
      ],
    });

    const { getByText, queryByTestId } = render(<SyncScreen />);
    expect(getByText('Received by EleBook')).toBeTruthy();
    expect(getByText(/1 elephant confirmed received/)).toBeTruthy();
    // Informational only -- no action button for an already-received row.
    expect(queryByTestId('sync-action-0')).toBeNull();
  });

  it('shows "Upload failed" with a Retry action and the error message', () => {
    useWildlifeStore.setState({
      syncQueue: [createSyncItem({ status: 'failed', lastError: 'Network timeout' })],
      observations: [createObservation()],
    });

    const { getByText } = render(<SyncScreen />);
    expect(getByText('Upload failed')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
    expect(getByText('Network timeout')).toBeTruthy();
  });

  it('retry re-attempts sync via the sync engine and alerts on repeated failure', async () => {
    useWildlifeStore.setState({
      syncQueue: [createSyncItem({ status: 'failed' })],
      observations: [createObservation()],
    });
    mockSyncObservation.mockResolvedValue({
      observationId: 'obs-abc123def456',
      status: 'failed',
      submittedCount: 0,
      message: 'blob upload failed: HTTP 500',
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByTestId } = render(<SyncScreen />);
    fireEvent.press(getByTestId('sync-action-0'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Upload failed', 'blob upload failed: HTTP 500'),
    );
  });

  it('retry does not sync when not signed in', async () => {
    mockEnsureSignedIn.mockResolvedValue(false);
    useWildlifeStore.setState({
      syncQueue: [createSyncItem({ status: 'failed' })],
      observations: [createObservation()],
    });

    const { getByTestId } = render(<SyncScreen />);
    fireEvent.press(getByTestId('sync-action-0'));

    await waitFor(() => expect(mockEnsureSignedIn).toHaveBeenCalled());
    expect(mockSyncObservation).not.toHaveBeenCalled();
  });

  it('shows "Needs attention" once the retry policy is exhausted, with a manual retry action', () => {
    useWildlifeStore.setState({
      syncQueue: [createSyncItem({ status: 'failedPermanent', retryCount: 5 })],
      observations: [createObservation()],
    });

    const { getByText } = render(<SyncScreen />);
    expect(getByText('Needs attention')).toBeTruthy();
    expect(getByText('Review and retry')).toBeTruthy();
  });

  it('shows "Complete locally" with no action when nothing was ever eligible to upload', () => {
    useWildlifeStore.setState({
      syncQueue: [createSyncItem({ status: 'synced' })],
      observations: [
        createObservation({
          detections: [
            createDetection({
              matchResult: { topCandidates: [], approvedIndividual: null, reviewStatus: 'rejected' },
            }),
          ],
        }),
      ],
    });

    const { getByText, queryByTestId } = render(<SyncScreen />);
    expect(getByText('Complete locally')).toBeTruthy();
    expect(queryByTestId('sync-action-0')).toBeNull();
  });

  // ==========================================================================
  // Orphaned queue rows (no matching observation)
  // ==========================================================================

  it('degrades gracefully for a queue row with no matching observation', () => {
    useWildlifeStore.setState({
      syncQueue: [createSyncItem({ observationId: 'obs-missing', status: 'pending' })],
      observations: [],
    });

    const { getByTestId, getByText } = render(<SyncScreen />);
    expect(getByTestId('sync-item-0')).toBeTruthy();
    expect(getByText('Pending')).toBeTruthy();
  });

  // ==========================================================================
  // Empty state
  // ==========================================================================

  it('shows empty state when no queue items', () => {
    useWildlifeStore.setState({ syncQueue: [] });

    const { getByText } = render(<SyncScreen />);
    expect(getByText('No observations to upload')).toBeTruthy();
  });

  it('does not show empty state when queue has items', () => {
    useWildlifeStore.setState({
      syncQueue: [createSyncItem()],
      observations: [createObservation()],
    });

    const { queryByText } = render(<SyncScreen />);
    expect(queryByText('No observations to upload')).toBeNull();
  });
});
