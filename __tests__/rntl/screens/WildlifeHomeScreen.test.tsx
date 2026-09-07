/**
 * WildlifeHomeScreen Tests
 *
 * Tests for the wildlife home dashboard including:
 * - Screen renders with correct testID
 * - "EleBook" title display
 * - Quick capture button rendering and navigation
 * - Active packs summary with count and total individuals
 * - Empty packs state message
 * - Recent observations list (up to 3, sorted by createdAt desc)
 * - Empty observations state message
 * - Sync status counts (pending, synced, failed)
 * - Observation tap navigates to ObservationDetail
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { useWildlifeStore } from '../../../src/stores/wildlifeStore';
import type {
  EmbeddingPack,
  Observation,
  SyncQueueItem,
} from '../../../src/types/wildlife';

// Mock navigation
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
    SafeAreaView: (props: Record<string, unknown>) => <View {...props} />,
    SafeAreaProvider: (props: Record<string, unknown>) => <View {...props} />,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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
  AnimatedListItem: ({ children, onPress, testID }: any) => {
    const { TouchableOpacity } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress} testID={testID}>
        {children}
      </TouchableOpacity>
    );
  },
}));

import { WildlifeHomeScreen } from '../../../src/screens/WildlifeHomeScreen';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

const createPack = (
  overrides: Partial<EmbeddingPack> = {},
): EmbeddingPack => ({
  id: 'pack-1',
  packVersion: '2025-06-15T00:00:00Z',
  species: 'Megaptera novaeangliae',
  featureClass: 'fluke',
  displayName: 'Humpback Whale — Fluke',
  wildbookInstanceUrl: 'https://flukebook.org',
  exportDate: '2025-06-15T00:00:00Z',
  individualCount: 342,
  embeddingDim: 256,
  embeddingModelVersion: '1.0.0',
  detectorModelFile: 'detector.onnx',
  embeddingsFile: 'embeddings.bin',
  indexFile: 'index.bin',
  referencePhotosDir: '/packs/pack-1/photos',
  packDir: '/packs/pack-1',
  downloadedAt: '2025-07-01T12:00:00Z',
  sizeBytes: 52_428_800,
  ...overrides,
});

const createObservation = (
  overrides: Partial<Observation> = {},
): Observation => ({
  id: 'obs-1',
  photoUri: 'file:///photos/obs-1.jpg',
  gps: { lat: -34.5, lon: 19.2, accuracy: 5 },
  timestamp: '2025-07-10T14:30:00Z',
  deviceInfo: { model: 'iPhone 15', os: 'iOS 17' },
  fieldNotes: null,
  detections: [],
  createdAt: '2025-07-10T14:30:00Z',
  ...overrides,
});

const createSyncItem = (
  overrides: Partial<SyncQueueItem> = {},
): SyncQueueItem => ({
  observationId: 'obs-1',
  status: 'pending',
  wildbookInstanceUrl: 'https://flukebook.org',
  retryCount: 0,
  lastError: null,
  lastAttempt: null,
  syncedAt: null,
  wildbookEncounterIds: [],
  ...overrides,
});

describe('WildlifeHomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useWildlifeStore.setState({
      packs: [],
      observations: [],
      syncQueue: [],
    });
  });

  // ==========================================================================
  // Basic Rendering
  // ==========================================================================
  describe('basic rendering', () => {
    it('renders screen with testID "wildlife-home-screen"', () => {
      const { getByTestId } = render(<WildlifeHomeScreen />);
      expect(getByTestId('wildlife-home-screen')).toBeTruthy();
    });

    it('shows "EleBook" title', () => {
      const { getByText } = render(<WildlifeHomeScreen />);
      expect(getByText('EleBook')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Quick Capture Button
  // ==========================================================================
  describe('quick capture button', () => {
    it('shows capture button', () => {
      const { getByTestId } = render(<WildlifeHomeScreen />);
      expect(getByTestId('capture-button')).toBeTruthy();
    });

    it('shows "New Capture" label', () => {
      const { getByText } = render(<WildlifeHomeScreen />);
      expect(getByText('New Capture')).toBeTruthy();
    });

    it('capture button navigates to Capture', () => {
      const { getByTestId } = render(<WildlifeHomeScreen />);
      fireEvent.press(getByTestId('capture-button'));
      expect(mockNavigate).toHaveBeenCalledWith('Capture');
    });

    it('settings button navigates to Settings', () => {
      const { getByTestId } = render(<WildlifeHomeScreen />);
      fireEvent.press(getByTestId('home-settings-button'));
      expect(mockNavigate).toHaveBeenCalledWith('Settings');
    });
  });

  // ==========================================================================
  // Active Packs Summary
  // ==========================================================================
  describe('active packs summary', () => {
    it('shows packs summary card', () => {
      const { getByTestId } = render(<WildlifeHomeScreen />);
      expect(getByTestId('packs-summary')).toBeTruthy();
    });

    it('shows "No packs loaded" when empty', () => {
      const { getByText } = render(<WildlifeHomeScreen />);
      expect(getByText('No packs loaded')).toBeTruthy();
    });

    it('shows packs summary with count when packs exist', () => {
      useWildlifeStore.setState({
        packs: [
          createPack({ id: 'pack-1', individualCount: 100 }),
          createPack({ id: 'pack-2', individualCount: 200 }),
        ],
      });

      const { getByText, queryByText } = render(<WildlifeHomeScreen />);
      expect(getByText('2')).toBeTruthy();
      expect(getByText('packs')).toBeTruthy();
      expect(getByText('300')).toBeTruthy();
      expect(getByText('individuals')).toBeTruthy();
      expect(queryByText('No packs loaded')).toBeNull();
    });

    it('shows singular "pack" label for single pack', () => {
      useWildlifeStore.setState({
        packs: [createPack({ id: 'pack-1', individualCount: 50 })],
      });

      const { getByText } = render(<WildlifeHomeScreen />);
      expect(getByText('1')).toBeTruthy();
      expect(getByText('pack')).toBeTruthy();
      expect(getByText('50')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Recent Observations
  // ==========================================================================
  describe('recent observations', () => {
    it('shows "No observations yet" when empty', () => {
      const { getByText } = render(<WildlifeHomeScreen />);
      expect(getByText('No observations yet')).toBeTruthy();
    });

    it('shows recent observations (up to 3)', () => {
      const observations = [
        createObservation({
          id: 'obs-1',
          createdAt: '2025-07-10T10:00:00Z',
          detections: [],
        }),
        createObservation({
          id: 'obs-2',
          createdAt: '2025-07-10T12:00:00Z',
          detections: [],
        }),
        createObservation({
          id: 'obs-3',
          createdAt: '2025-07-10T14:00:00Z',
          detections: [],
        }),
        createObservation({
          id: 'obs-4',
          createdAt: '2025-07-10T08:00:00Z',
          detections: [],
        }),
      ];
      useWildlifeStore.setState({ observations });

      const { getByTestId, queryByTestId, queryByText } = render(
        <WildlifeHomeScreen />,
      );
      // Should show 3 items (most recent)
      expect(getByTestId('observation-item-0')).toBeTruthy();
      expect(getByTestId('observation-item-1')).toBeTruthy();
      expect(getByTestId('observation-item-2')).toBeTruthy();
      // Should not have a 4th item
      expect(queryByTestId('observation-item-3')).toBeNull();
      // Should not show empty message
      expect(queryByText('No observations yet')).toBeNull();
    });

    it('shows detection count for each observation', () => {
      const detection = {
        id: 'det-1',
        observationId: 'obs-1',
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
        species: 'whale',
        speciesConfidence: 0.9,
        croppedImageUri: 'file:///crop.jpg',
        embedding: [0.1, 0.2],
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
      };

      useWildlifeStore.setState({
        observations: [
          createObservation({
            id: 'obs-1',
            detections: [detection, { ...detection, id: 'det-2' }],
          }),
        ],
      });

      const { getByText } = render(<WildlifeHomeScreen />);
      expect(getByText('2 detections')).toBeTruthy();
    });

    it('shows singular "detection" for single detection', () => {
      const detection = {
        id: 'det-1',
        observationId: 'obs-1',
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
        species: 'whale',
        speciesConfidence: 0.9,
        croppedImageUri: 'file:///crop.jpg',
        embedding: [0.1],
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
      };

      useWildlifeStore.setState({
        observations: [
          createObservation({ id: 'obs-1', detections: [detection] }),
        ],
      });

      const { getByText } = render(<WildlifeHomeScreen />);
      expect(getByText('1 detection')).toBeTruthy();
    });

    it('tapping observation navigates to ObservationDetail', () => {
      useWildlifeStore.setState({
        observations: [
          createObservation({ id: 'obs-abc', createdAt: '2025-07-10T14:00:00Z' }),
        ],
      });

      const { getByTestId } = render(<WildlifeHomeScreen />);
      fireEvent.press(getByTestId('observation-item-0'));

      expect(mockNavigate).toHaveBeenCalledWith('ObservationDetail', {
        observationId: 'obs-abc',
      });
    });

    it('sorts observations by createdAt descending (most recent first)', () => {
      const observations = [
        createObservation({
          id: 'obs-old',
          createdAt: '2025-07-01T10:00:00Z',
        }),
        createObservation({
          id: 'obs-new',
          createdAt: '2025-07-10T10:00:00Z',
        }),
      ];
      useWildlifeStore.setState({ observations });

      const { getByTestId } = render(<WildlifeHomeScreen />);

      // Tap the first item — should be the most recent (obs-new)
      fireEvent.press(getByTestId('observation-item-0'));
      expect(mockNavigate).toHaveBeenCalledWith('ObservationDetail', {
        observationId: 'obs-new',
      });
    });
  });

  // ==========================================================================
  // Sync Status
  // ==========================================================================
  describe('sync status', () => {
    it('shows sync status card', () => {
      const { getByTestId } = render(<WildlifeHomeScreen />);
      expect(getByTestId('sync-status')).toBeTruthy();
    });

    it('shows sync status counts', () => {
      useWildlifeStore.setState({
        syncQueue: [
          createSyncItem({ observationId: 'obs-1', status: 'pending' }),
          createSyncItem({ observationId: 'obs-2', status: 'synced' }),
          createSyncItem({ observationId: 'obs-3', status: 'synced' }),
          createSyncItem({ observationId: 'obs-4', status: 'synced' }),
          createSyncItem({ observationId: 'obs-5', status: 'failed' }),
          createSyncItem({
            observationId: 'obs-6',
            status: 'failedPermanent',
          }),
        ],
      });

      const { getByText } = render(<WildlifeHomeScreen />);
      // pending = 1
      expect(getByText('1')).toBeTruthy();
      expect(getByText('pending')).toBeTruthy();
      // synced = 3
      expect(getByText('3')).toBeTruthy();
      expect(getByText('synced')).toBeTruthy();
      // failed + failedPermanent = 2
      expect(getByText('2')).toBeTruthy();
      expect(getByText('failed')).toBeTruthy();
    });

    it('shows zero counts when sync queue is empty', () => {
      const { getAllByText, getByText } = render(<WildlifeHomeScreen />);
      // All counts should be "0"
      const zeros = getAllByText('0');
      expect(zeros.length).toBeGreaterThanOrEqual(3);
      expect(getByText('pending')).toBeTruthy();
      expect(getByText('synced')).toBeTruthy();
      expect(getByText('failed')).toBeTruthy();
    });
  });
});
