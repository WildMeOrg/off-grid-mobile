/**
 * ObservationsScreen Tests
 *
 * Tests for the observations list screen including:
 * - Renders screen with testID "observations-screen"
 * - Shows filter chips (All, Pending, Reviewed, Synced)
 * - Shows observation list with thumbnails
 * - Shows detection counts
 * - Shows review status
 * - Filter changes list
 * - Tapping observation navigates to ObservationDetail
 * - Empty state when no observations
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Navigation mocks (must be before component import)
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
    useSafeAreaInsets: jest.fn(() => ({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    })),
  };
});

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return (props: Record<string, unknown>) => <Text>{String(props.name)}</Text>;
});

jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));

jest.mock('../../../src/components/AnimatedListItem', () => ({
  AnimatedListItem: ({ children, onPress, style, testID }: any) => {
    const { TouchableOpacity } = require('react-native');
    return (
      <TouchableOpacity style={style} onPress={onPress} testID={testID}>
        {children}
      </TouchableOpacity>
    );
  },
}));

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------
const makeDetection = (overrides: Record<string, any> = {}) => ({
  id: 'det-1',
  observationId: 'obs-1',
  boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  species: 'zebra_plains',
  speciesConfidence: 0.95,
  croppedImageUri: 'file:///crops/det-1.jpg',
  embedding: [],
  matchResult: {
    topCandidates: [],
    approvedIndividual: null,
    reviewStatus: 'pending' as const,
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

const makeObservation = (overrides: Record<string, any> = {}) => ({
  id: 'obs-1',
  photoUri: 'file:///test/photo1.jpg',
  gps: null,
  timestamp: '2025-06-15T10:30:00Z',
  deviceInfo: { model: 'test', os: 'test' },
  fieldNotes: null,
  detections: [makeDetection()],
  createdAt: '2025-06-15T10:30:00Z',
  ...overrides,
});

const makeSyncQueueItem = (overrides: Record<string, any> = {}) => ({
  observationId: 'obs-1',
  status: 'pending' as const,
  wildbookInstanceUrl: 'https://flukebook.org',
  retryCount: 0,
  lastError: null,
  lastAttempt: null,
  syncedAt: null,
  wildbookEncounterIds: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Wildlife store mock
// ---------------------------------------------------------------------------
let mockObservations = [makeObservation()];
let mockSyncQueue: ReturnType<typeof makeSyncQueueItem>[] = [];

jest.mock('../../../src/stores/wildlifeStore', () => ({
  useWildlifeStore: jest.fn((selector?: any) => {
    const state = {
      observations: mockObservations,
      syncQueue: mockSyncQueue,
    };
    return selector ? selector(state) : state;
  }),
}));

// ---------------------------------------------------------------------------
// Import component under test
// ---------------------------------------------------------------------------
import { ObservationsScreen } from '../../../src/screens/ObservationsScreen';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ObservationsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockObservations = [makeObservation()];
    mockSyncQueue = [];
  });

  // ==========================================================================
  // Rendering
  // ==========================================================================

  it('renders screen with testID "observations-screen"', () => {
    const { getByTestId } = render(<ObservationsScreen />);
    expect(getByTestId('observations-screen')).toBeTruthy();
  });

  it('shows "Observations" title', () => {
    const { getByText } = render(<ObservationsScreen />);
    expect(getByText('Observations')).toBeTruthy();
  });

  // ==========================================================================
  // Filter Chips
  // ==========================================================================

  it('shows all filter chips', () => {
    const { getByText } = render(<ObservationsScreen />);
    expect(getByText('All')).toBeTruthy();
    expect(getByText('Pending')).toBeTruthy();
    expect(getByText('Reviewed')).toBeTruthy();
    expect(getByText('Synced')).toBeTruthy();
  });

  it('has filter chip testIDs', () => {
    const { getByTestId } = render(<ObservationsScreen />);
    expect(getByTestId('filter-all')).toBeTruthy();
    expect(getByTestId('filter-pending')).toBeTruthy();
    expect(getByTestId('filter-reviewed')).toBeTruthy();
    expect(getByTestId('filter-synced')).toBeTruthy();
  });

  // ==========================================================================
  // Observation List
  // ==========================================================================

  it('shows observation thumbnails', () => {
    const { getByTestId } = render(<ObservationsScreen />);
    expect(getByTestId('observation-thumbnail-0')).toBeTruthy();
  });

  it('shows detection count', () => {
    mockObservations = [
      makeObservation({
        detections: [
          makeDetection({ id: 'det-1' }),
          makeDetection({ id: 'det-2' }),
          makeDetection({ id: 'det-3' }),
        ],
      }),
    ];
    const { getByText } = render(<ObservationsScreen />);
    expect(getByText('3 detections')).toBeTruthy();
  });

  it('shows singular detection count', () => {
    mockObservations = [
      makeObservation({ detections: [makeDetection()] }),
    ];
    const { getByText } = render(<ObservationsScreen />);
    expect(getByText('1 detection')).toBeTruthy();
  });

  it('shows "Needs review" status when some detections are still pending', () => {
    mockObservations = [
      makeObservation({
        detections: [
          makeDetection({
            id: 'det-1',
            matchResult: {
              topCandidates: [
                { individualId: 'ind-1', score: 0.9, source: 'pack', refPhotoIndex: 0 },
              ],
              approvedIndividual: 'ind-1',
              reviewStatus: 'approved',
            },
          }),
          makeDetection({
            id: 'det-2',
            matchResult: {
              topCandidates: [],
              approvedIndividual: null,
              reviewStatus: 'pending',
            },
          }),
          makeDetection({
            id: 'det-3',
            matchResult: {
              topCandidates: [],
              approvedIndividual: null,
              reviewStatus: 'pending',
            },
          }),
        ],
      }),
    ];
    const { getByText } = render(<ObservationsScreen />);
    expect(getByText('Needs review')).toBeTruthy();
  });

  it('shows "Ready to upload" once every detection is reviewed and eligible evidence remains local', () => {
    mockObservations = [
      makeObservation({
        detections: [
          makeDetection({
            id: 'det-1',
            matchResult: {
              topCandidates: [
                { individualId: 'ind-1', score: 0.9, source: 'pack', refPhotoIndex: 0 },
              ],
              approvedIndividual: 'ind-1',
              reviewStatus: 'approved',
            },
          }),
        ],
      }),
    ];
    const { getByText } = render(<ObservationsScreen />);
    expect(getByText('Ready to upload')).toBeTruthy();
  });

  it('renders multiple observations', () => {
    mockObservations = [
      makeObservation({ id: 'obs-1' }),
      makeObservation({ id: 'obs-2', photoUri: 'file:///test/photo2.jpg' }),
    ];
    const { getByTestId } = render(<ObservationsScreen />);
    expect(getByTestId('observation-card-0')).toBeTruthy();
    expect(getByTestId('observation-card-1')).toBeTruthy();
  });

  // ==========================================================================
  // Sorting
  // ==========================================================================

  it('defaults to showing the newest observation first', () => {
    mockObservations = [
      makeObservation({
        id: 'obs-old',
        timestamp: '2025-06-01T00:00:00Z',
        photoUri: 'file:///test/old.jpg',
      }),
      makeObservation({
        id: 'obs-new',
        timestamp: '2025-06-10T00:00:00Z',
        photoUri: 'file:///test/new.jpg',
      }),
    ];
    const { getByTestId, getByText } = render(<ObservationsScreen />);
    expect(getByText('Newest first')).toBeTruthy();
    expect(getByTestId('observation-thumbnail-0').props.source.uri).toContain('new.jpg');
    expect(getByTestId('observation-thumbnail-1').props.source.uri).toContain('old.jpg');
  });

  it('shows the oldest observation first after toggling the sort order', () => {
    mockObservations = [
      makeObservation({
        id: 'obs-old',
        timestamp: '2025-06-01T00:00:00Z',
        photoUri: 'file:///test/old.jpg',
      }),
      makeObservation({
        id: 'obs-new',
        timestamp: '2025-06-10T00:00:00Z',
        photoUri: 'file:///test/new.jpg',
      }),
    ];
    const { getByTestId, getByText } = render(<ObservationsScreen />);
    fireEvent.press(getByTestId('sort-toggle-button'));

    expect(getByText('Oldest first')).toBeTruthy();
    expect(getByTestId('observation-thumbnail-0').props.source.uri).toContain('old.jpg');
    expect(getByTestId('observation-thumbnail-1').props.source.uri).toContain('new.jpg');
  });

  // ==========================================================================
  // Filtering
  // ==========================================================================

  it('filters to show only pending observations', () => {
    mockObservations = [
      makeObservation({
        id: 'obs-pending',
        detections: [
          makeDetection({
            matchResult: {
              topCandidates: [],
              approvedIndividual: null,
              reviewStatus: 'pending',
            },
          }),
        ],
      }),
      makeObservation({
        id: 'obs-reviewed',
        detections: [
          makeDetection({
            id: 'det-reviewed',
            matchResult: {
              topCandidates: [],
              approvedIndividual: 'ind-1',
              reviewStatus: 'approved',
            },
          }),
        ],
      }),
    ];

    const { getByTestId, queryByTestId } = render(<ObservationsScreen />);

    // Before filter - both visible
    expect(getByTestId('observation-card-0')).toBeTruthy();
    expect(getByTestId('observation-card-1')).toBeTruthy();

    // Apply pending filter
    fireEvent.press(getByTestId('filter-pending'));

    // Only pending should remain
    expect(getByTestId('observation-card-0')).toBeTruthy();
    expect(queryByTestId('observation-card-1')).toBeNull();
  });

  it('filters to show only reviewed observations', () => {
    mockObservations = [
      makeObservation({
        id: 'obs-pending',
        detections: [
          makeDetection({
            matchResult: {
              topCandidates: [],
              approvedIndividual: null,
              reviewStatus: 'pending',
            },
          }),
        ],
      }),
      makeObservation({
        id: 'obs-reviewed',
        detections: [
          makeDetection({
            id: 'det-reviewed',
            matchResult: {
              topCandidates: [],
              approvedIndividual: 'ind-1',
              reviewStatus: 'approved',
            },
          }),
        ],
      }),
    ];

    const { getByTestId, queryByTestId } = render(<ObservationsScreen />);

    fireEvent.press(getByTestId('filter-reviewed'));

    // Only reviewed should remain (1 item at index 0)
    expect(getByTestId('observation-card-0')).toBeTruthy();
    expect(queryByTestId('observation-card-1')).toBeNull();
  });

  it('filters to show only synced observations', () => {
    mockObservations = [
      makeObservation({ id: 'obs-synced' }),
      makeObservation({ id: 'obs-not-synced' }),
    ];
    mockSyncQueue = [
      makeSyncQueueItem({
        observationId: 'obs-synced',
        status: 'synced',
      }),
    ];

    const { getByTestId, queryByTestId } = render(<ObservationsScreen />);

    fireEvent.press(getByTestId('filter-synced'));

    expect(getByTestId('observation-card-0')).toBeTruthy();
    expect(queryByTestId('observation-card-1')).toBeNull();
  });

  it('returns to all observations when All filter is pressed', () => {
    mockObservations = [
      makeObservation({ id: 'obs-1' }),
      makeObservation({ id: 'obs-2' }),
    ];

    const { getByTestId } = render(<ObservationsScreen />);

    // Switch to synced (no synced obs, so empty)
    fireEvent.press(getByTestId('filter-synced'));
    expect(getByTestId('empty-state')).toBeTruthy();

    // Switch back to all
    fireEvent.press(getByTestId('filter-all'));
    expect(getByTestId('observation-card-0')).toBeTruthy();
    expect(getByTestId('observation-card-1')).toBeTruthy();
  });

  // ==========================================================================
  // Navigation
  // ==========================================================================

  it('navigates to ObservationDetail when observation is tapped', () => {
    mockObservations = [makeObservation({ id: 'obs-abc' })];

    const { getByTestId } = render(<ObservationsScreen />);
    fireEvent.press(getByTestId('observation-card-0'));

    expect(mockNavigate).toHaveBeenCalledWith('ObservationDetail', {
      observationId: 'obs-abc',
    });
  });

  it('navigates with correct observationId for second observation', () => {
    mockObservations = [
      makeObservation({ id: 'obs-1' }),
      makeObservation({ id: 'obs-2' }),
    ];

    const { getByTestId } = render(<ObservationsScreen />);
    fireEvent.press(getByTestId('observation-card-1'));

    expect(mockNavigate).toHaveBeenCalledWith('ObservationDetail', {
      observationId: 'obs-2',
    });
  });

  // ==========================================================================
  // Empty State
  // ==========================================================================

  it('shows empty state when no observations exist', () => {
    mockObservations = [];

    const { getByText, getByTestId } = render(<ObservationsScreen />);
    expect(getByTestId('empty-state')).toBeTruthy();
    expect(getByText('No Observations')).toBeTruthy();
    expect(
      getByText(/Capture a photo to start recording wildlife observations/),
    ).toBeTruthy();
  });

  it('shows empty state when filter yields no results', () => {
    mockObservations = [makeObservation({ id: 'obs-1' })];
    mockSyncQueue = [];

    const { getByTestId } = render(<ObservationsScreen />);

    // Synced filter with no synced items
    fireEvent.press(getByTestId('filter-synced'));
    expect(getByTestId('empty-state')).toBeTruthy();
  });

  it('does not show empty state when observations exist', () => {
    mockObservations = [makeObservation()];

    const { queryByTestId } = render(<ObservationsScreen />);
    expect(queryByTestId('empty-state')).toBeNull();
  });
});
