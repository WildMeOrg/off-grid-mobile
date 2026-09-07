/**
 * MatchReviewScreen Tests
 *
 * Tests for the match review screen including:
 * - Renders match review screen with testID
 * - Shows cropped detection image
 * - Shows candidates list
 * - Shows approve buttons on each candidate
 * - Shows "No Match" and "Skip" buttons
 * - Approve updates store and navigates back
 * - Approve for local individual accumulates embedding
 * - Approve for pack individual does not accumulate embedding
 * - No Match creates a new LocalIndividual and approves it
 * - No Match includes firstSeen timestamp
 * - No Match uses field ID from getNextFieldId
 * - Skip navigates back without updating store
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import RNFS from 'react-native-fs';

// ---------------------------------------------------------------------------
// Navigation mocks (must be before component import)
// ---------------------------------------------------------------------------
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: mockGoBack,
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    useRoute: () => ({
      params: { observationId: 'obs-1', detectionId: 'det-1' },
    }),
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

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------
const makeCandidate = (overrides: Record<string, any> = {}) => ({
  individualId: 'ind-1',
  score: 0.92,
  source: 'pack' as const,
  refPhotoIndex: 0,
  ...overrides,
});

const makeDetection = (overrides: Record<string, any> = {}) => ({
  id: 'det-1',
  observationId: 'obs-1',
  boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  species: 'zebra_plains',
  speciesConfidence: 0.95,
  croppedImageUri: 'file:///crops/det-1.jpg',
  embedding: [0.1, 0.2, 0.3],
  matchResult: {
    topCandidates: [
      makeCandidate({ individualId: 'ind-1', score: 0.92, source: 'pack' }),
      makeCandidate({ individualId: 'ind-2', score: 0.85, source: 'local' }),
    ],
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

const makeObservation = (
  detections: ReturnType<typeof makeDetection>[] = [makeDetection()],
) => ({
  id: 'obs-1',
  photoUri: 'file:///test/photo.jpg',
  gps: null,
  timestamp: '2025-01-01T00:00:00Z',
  deviceInfo: { model: 'test', os: 'test' },
  fieldNotes: null,
  detections,
  createdAt: '2025-01-01T00:00:00Z',
});

// ---------------------------------------------------------------------------
// Wildlife store mock
// ---------------------------------------------------------------------------
const mockUpdateDetection = jest.fn();
const mockAddLocalIndividual = jest.fn();
const mockAddEmbeddingToLocalIndividual = jest.fn();
const mockGetNextFieldId = jest.fn(() => 'FIELD-001');
const mockLoadPackIndex = jest.fn().mockResolvedValue([]);
let mockObservations = [makeObservation()];
let mockPacks: Array<Record<string, any>> = [];
const mockLocalIndividuals = [
  {
    localId: 'ind-2',
    userLabel: 'Stripe Boy',
    species: 'zebra_plains',
    embeddings: [],
    referencePhotos: ['file:///refs/ind-2.jpg'],
    firstSeen: '2025-01-01T00:00:00Z',
    encounterCount: 3,
    syncStatus: 'pending' as const,
    wildbookId: null,
  },
];

const mockGetState = () => ({
  observations: mockObservations,
  localIndividuals: mockLocalIndividuals,
  packs: mockPacks,
  updateDetection: mockUpdateDetection,
  addLocalIndividual: mockAddLocalIndividual,
  addEmbeddingToLocalIndividual: mockAddEmbeddingToLocalIndividual,
  getNextFieldId: mockGetNextFieldId,
});

jest.mock('../../../src/stores/wildlifeStore', () => {
  const hook = (selector?: any) => {
    const state = mockGetState();
    return selector ? selector(state) : state;
  };
  hook.getState = () => mockGetState();
  return { useWildlifeStore: hook };
});

jest.mock('../../../src/services/packManager', () => ({
  packManager: {
    loadPackIndex: (...args: any[]) => mockLoadPackIndex(...args),
  },
}));

// ---------------------------------------------------------------------------
// Import component under test
// ---------------------------------------------------------------------------
import { MatchReviewScreen } from '../../../src/screens/MatchReviewScreen';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MatchReviewScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadPackIndex.mockResolvedValue([]);
    mockObservations = [makeObservation()];
    mockPacks = [];
  });

  // ==========================================================================
  // Rendering
  // ==========================================================================

  it('renders screen with testID "match-review-screen"', () => {
    const { getByTestId } = render(<MatchReviewScreen />);
    expect(getByTestId('match-review-screen')).toBeTruthy();
  });

  it('shows cropped detection image', () => {
    const { getByTestId } = render(<MatchReviewScreen />);
    expect(getByTestId('cropped-detection-image')).toBeTruthy();
  });

  it('shows detection species without a confidence percentage', () => {
    const { getByText, queryByText } = render(<MatchReviewScreen />);
    expect(getByText('zebra_plains')).toBeTruthy();
    expect(queryByText('95%')).toBeNull();
  });

  it('shows candidates list', () => {
    const { getByTestId } = render(<MatchReviewScreen />);
    expect(getByTestId('candidates-list')).toBeTruthy();
  });

  it('shows candidate cards for each candidate', () => {
    const { getByTestId } = render(<MatchReviewScreen />);
    expect(getByTestId('candidate-ind-1')).toBeTruthy();
    expect(getByTestId('candidate-ind-2')).toBeTruthy();
  });

  it('shows a High confidence band and a confirmation-required notice instead of a raw score', () => {
    const { getByText, getAllByText, queryByText } = render(<MatchReviewScreen />);
    expect(getByText('High \u00b7 Candidate 1')).toBeTruthy();
    expect(getByText('High \u00b7 Candidate 2')).toBeTruthy();
    expect(getAllByText('Researcher confirmation required')).toHaveLength(2);
    expect(queryByText('92%')).toBeNull();
    expect(queryByText('85%')).toBeNull();
  });

  it('shows a Medium confidence band for a candidate scored 0.60-0.79', () => {
    mockObservations = [
      makeObservation([
        makeDetection({
          matchResult: {
            topCandidates: [makeCandidate({ individualId: 'ind-1', score: 0.65, source: 'pack' })],
            approvedIndividual: null,
            reviewStatus: 'pending' as const,
          },
        }),
      ]),
    ];
    const { getByText } = render(<MatchReviewScreen />);
    expect(getByText('Medium \u00b7 Candidate 1')).toBeTruthy();
  });

  it('shows a Low confidence band for a candidate scored below 0.60', () => {
    mockObservations = [
      makeObservation([
        makeDetection({
          matchResult: {
            topCandidates: [makeCandidate({ individualId: 'ind-1', score: 0.4, source: 'pack' })],
            approvedIndividual: null,
            reviewStatus: 'pending' as const,
          },
        }),
      ]),
    ];
    const { getByText } = render(<MatchReviewScreen />);
    expect(getByText('Low \u00b7 Candidate 1')).toBeTruthy();
  });

  it('shows source badges on candidates', () => {
    const { getAllByText } = render(<MatchReviewScreen />);
    expect(getAllByText('pack').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('local').length).toBeGreaterThanOrEqual(1);
  });

  it('resolves local individual name from store', () => {
    const { getByText } = render(<MatchReviewScreen />);
    expect(getByText('Stripe Boy')).toBeTruthy();
  });

  it('resolves pack individual name and reference photo from the pack index', async () => {
    (RNFS.stat as jest.Mock).mockImplementation(async (filepath: string) => ({
      canonicalPath: filepath,
      isFile: () => filepath.endsWith('.jpg'),
      isDirectory: () => filepath === '/data/packs/example-project',
    }));
    mockPacks = [
      {
        id: 'example-project',
        packDir: '/data/packs/example-project',
        species: 'zebra_plains',
        referencePhotosDir: '/data/packs/example-project/reference_photos',
        indexFile: '/data/packs/example-project/embeddings/index.json',
      },
    ];
    mockLoadPackIndex.mockResolvedValue([
      {
        id: 'ind-1',
        name: 'Thomas',
        alternateId: null,
        sex: 'male',
        lifeStage: 'adult',
        firstSeen: null,
        lastSeen: null,
        encounterCount: 5,
        embeddingCount: 10,
        embeddingOffset: 0,
        referencePhotos: ['ref_01.jpg', 'ref_02.jpg'],
        notes: null,
      },
    ]);

    const { getByText, getByTestId } = render(<MatchReviewScreen />);

    await waitFor(() => expect(getByText('Thomas')).toBeTruthy());
    expect(mockLoadPackIndex).toHaveBeenCalledWith(
      '/data/packs/example-project/embeddings/index.json',
    );
    expect(getByTestId('candidate-photo-ind-1').props.source.uri).toBe(
      'file:///data/packs/example-project/reference_photos/ind-1/ref_01.jpg',
    );
  });

  // ==========================================================================
  // Approve buttons
  // ==========================================================================

  it('shows approve buttons on each candidate', () => {
    const { getByTestId } = render(<MatchReviewScreen />);
    expect(getByTestId('approve-ind-1')).toBeTruthy();
    expect(getByTestId('approve-ind-2')).toBeTruthy();
  });

  // ==========================================================================
  // Actions
  // ==========================================================================

  it('shows "No Match" and "Skip" buttons', () => {
    const { getByTestId, getByText } = render(<MatchReviewScreen />);
    expect(getByTestId('no-match-button')).toBeTruthy();
    expect(getByText(/No Match/)).toBeTruthy();
    expect(getByTestId('skip-button')).toBeTruthy();
    expect(getByText('Skip')).toBeTruthy();
  });

  it('approve updates store and navigates back', () => {
    const { getByTestId } = render(<MatchReviewScreen />);
    fireEvent.press(getByTestId('approve-ind-1'));

    expect(mockUpdateDetection).toHaveBeenCalledWith('obs-1', 'det-1', {
      matchResult: expect.objectContaining({
        approvedIndividual: 'ind-1',
        reviewStatus: 'approved',
      }),
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('approve for local individual accumulates embedding', () => {
    const { getByTestId } = render(<MatchReviewScreen />);
    // ind-2 is the local candidate in our test data
    fireEvent.press(getByTestId('approve-ind-2'));

    expect(mockAddEmbeddingToLocalIndividual).toHaveBeenCalledWith(
      'ind-2',
      [0.1, 0.2, 0.3],
      'file:///crops/det-1.jpg',
    );
    expect(mockUpdateDetection).toHaveBeenCalledWith('obs-1', 'det-1', {
      matchResult: expect.objectContaining({
        approvedIndividual: 'ind-2',
        reviewStatus: 'approved',
      }),
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('approve for pack individual does not accumulate embedding', () => {
    const { getByTestId } = render(<MatchReviewScreen />);
    // ind-1 is the pack candidate in our test data
    fireEvent.press(getByTestId('approve-ind-1'));

    expect(mockAddEmbeddingToLocalIndividual).not.toHaveBeenCalled();
    expect(mockUpdateDetection).toHaveBeenCalledWith('obs-1', 'det-1', {
      matchResult: expect.objectContaining({
        approvedIndividual: 'ind-1',
        reviewStatus: 'approved',
      }),
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('No Match creates a new local individual and approves it', () => {
    const { getByTestId } = render(<MatchReviewScreen />);
    fireEvent.press(getByTestId('no-match-button'));

    // Should have called getNextFieldId to generate an ID
    expect(mockGetNextFieldId).toHaveBeenCalled();

    // Should create a new local individual with the detection's data
    expect(mockAddLocalIndividual).toHaveBeenCalledWith(
      expect.objectContaining({
        localId: 'FIELD-001',
        userLabel: null,
        species: 'zebra_plains',
        embeddings: [[0.1, 0.2, 0.3]],
        referencePhotos: ['file:///crops/det-1.jpg'],
        encounterCount: 1,
        syncStatus: 'pending',
        wildbookId: null,
      }),
    );

    // Should update detection with new individual ID and approved status
    expect(mockUpdateDetection).toHaveBeenCalledWith('obs-1', 'det-1', {
      matchResult: expect.objectContaining({
        approvedIndividual: 'FIELD-001',
        reviewStatus: 'approved',
      }),
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('No Match includes firstSeen timestamp in new individual', () => {
    const fixedDate = '2026-02-28T12:00:00.000Z';
    jest.spyOn(Date.prototype, 'toISOString').mockReturnValue(fixedDate);

    const { getByTestId } = render(<MatchReviewScreen />);
    fireEvent.press(getByTestId('no-match-button'));

    expect(mockAddLocalIndividual).toHaveBeenCalledWith(
      expect.objectContaining({
        firstSeen: fixedDate,
      }),
    );

    jest.restoreAllMocks();
  });

  it('No Match uses field ID from getNextFieldId in detection update', () => {
    mockGetNextFieldId.mockReturnValueOnce('FIELD-042');

    const { getByTestId } = render(<MatchReviewScreen />);
    fireEvent.press(getByTestId('no-match-button'));

    expect(mockAddLocalIndividual).toHaveBeenCalledWith(
      expect.objectContaining({
        localId: 'FIELD-042',
      }),
    );
    expect(mockUpdateDetection).toHaveBeenCalledWith('obs-1', 'det-1', {
      matchResult: expect.objectContaining({
        approvedIndividual: 'FIELD-042',
      }),
    });
  });

  it('Skip navigates back without updating store', () => {
    const { getByTestId } = render(<MatchReviewScreen />);
    fireEvent.press(getByTestId('skip-button'));

    expect(mockUpdateDetection).not.toHaveBeenCalled();
    expect(mockAddLocalIndividual).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  // ==========================================================================
  // Bottom inset (Android gesture/navigation bar regression)
  // ==========================================================================

  it('pushes the footer (No Match / Skip) above the device bottom inset instead of a fixed padding', () => {
    const { useSafeAreaInsets } = require('react-native-safe-area-context');
    (useSafeAreaInsets as jest.Mock).mockReturnValue({
      top: 0,
      right: 0,
      bottom: 48,
      left: 0,
    });

    const { getByTestId } = render(<MatchReviewScreen />);
    const footer = getByTestId('match-review-footer');
    const flattened = Object.assign(
      {},
      ...(Array.isArray(footer.props.style) ? footer.props.style : [footer.props.style]),
    );
    expect(flattened.paddingBottom).toBeGreaterThanOrEqual(48);
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  it('shows empty state when no candidates', () => {
    mockObservations = [
      makeObservation([
        makeDetection({
          matchResult: {
            topCandidates: [],
            approvedIndividual: null,
            reviewStatus: 'pending' as const,
          },
        }),
      ]),
    ];

    const { getByText } = render(<MatchReviewScreen />);
    expect(getByText('No candidates found.')).toBeTruthy();
  });

  it('shows header when detection not found', () => {
    mockObservations = [makeObservation([])];

    const { getByText } = render(<MatchReviewScreen />);
    expect(getByText('Detection not found.')).toBeTruthy();
  });

  it('navigates back when back button pressed', () => {
    const { getByTestId } = render(<MatchReviewScreen />);
    fireEvent.press(getByTestId('back-button'));

    expect(mockGoBack).toHaveBeenCalled();
  });
});
