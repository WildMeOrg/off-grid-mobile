/**
 * CaptureScreen Tests
 *
 * Tests for the wildlife capture screen including:
 * - Renders capture screen with testID
 * - Shows "Take Photo" button
 * - Shows "Choose from Gallery" button
 * - Calls image picker when "Take Photo" pressed
 * - Calls image picker when "Choose from Gallery" pressed
 * - Shows loading state while pipeline is processing
 * - Navigates to DetectionResults after successful pipeline run
 * - Shows error alert when pipeline fails
 * - Shows cancel state when user cancels photo selection
 * - Saves observation with device info from Platform API
 * - Saves best-effort GPS metadata on observations
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import Geolocation, {
  type GeolocationError,
  type GeolocationResponse,
} from '@react-native-community/geolocation';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import DeviceInfo from 'react-native-device-info';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { wildlifePipeline } from '../../../src/services/wildlifePipeline';
import { useWildlifeStore } from '../../../src/stores/wildlifeStore';
import { initDatabase } from '../../../src/services/database';
import * as database from '../../../src/services/database';

// database is wrapped so one test can force insertObservationWithDetections
// to reject; every other test passes through to the real (op-sqlite-mocked)
// implementation unchanged.
jest.mock('../../../src/services/database', () => {
  const actual = jest.requireActual('../../../src/services/database');
  return {
    ...actual,
    insertObservationWithDetections: jest.fn(actual.insertObservationWithDetections),
  };
});

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

// Mock wildlifePipeline
jest.mock('../../../src/services/wildlifePipeline', () => ({
  wildlifePipeline: {
    processPhoto: jest.fn(),
  },
}));

// Mock packManager (used by loadDetectorConfig in useCaptureFlow)
jest.mock('../../../src/services/packManager', () => ({
  packManager: {
    loadManifest: jest.fn().mockRejectedValue(new Error('no manifest')),
  },
}));

// Mock embeddingDatabaseBuilder (used by useCaptureFlow)
jest.mock('../../../src/services/embeddingDatabaseBuilder', () => ({
  buildEmbeddingDatabase: jest.fn().mockResolvedValue([]),
}));

// Spy on Alert.alert
jest.spyOn(Alert, 'alert');

import { CaptureScreen } from '../../../src/screens/CaptureScreen';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockProcessPhoto = wildlifePipeline.processPhoto as jest.Mock;
const mockLaunchCamera = launchCamera as jest.Mock;
const mockLaunchImageLibrary = launchImageLibrary as jest.Mock;
const mockGetCurrentPosition = Geolocation.getCurrentPosition as jest.MockedFunction<
  typeof Geolocation.getCurrentPosition
>;
const mockRequestLocationPermission =
  PermissionsAndroid.request as jest.MockedFunction<
    typeof PermissionsAndroid.request
  >;

const MOCK_GPS = {
  lat: 1.2345,
  lon: 2.3456,
  accuracy: 7,
};

const makeTestPack = (overrides: Record<string, unknown> = {}) => ({
  id: 'pack-1',
  packVersion: '2026-04-25T00:00:00Z',
  species: 'horse_wild',
  featureClass: 'face',
  displayName: 'Wild Horse - Face',
  wildbookInstanceUrl: 'https://horses.wildbook.org',
  exportDate: '2026-04-25T00:00:00Z',
  individualCount: 5,
  embeddingDim: 2152,
  embeddingModelVersion: '4.1.0',
  detectorModelFile: '/packs/horse/detector.onnx',
  embeddingsFile: '/packs/horse/embeddings.bin',
  indexFile: '/packs/horse/index.json',
  referencePhotosDir: '/packs/horse/photos',
  packDir: '/packs/horse',
  downloadedAt: '2026-04-25T12:00:00Z',
  sizeBytes: 9_000_000,
  ...overrides,
});

const MOCK_PIPELINE_RESULT = {
  observationId: 'obs-123',
  photoUri: 'file:///mock/camera.jpg',
  detections: [],
  errors: [],
  totalInferenceTimeMs: 150,
};

const MOCK_DETECTION = {
  id: 'det-1',
  observationId: 'obs-123',
  boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  species: 'horse_wild',
  speciesConfidence: 0.9,
  croppedImageUri: 'file:///mock/crop.jpg',
  embedding: [0.1, 0.2],
  matchResult: {
    topCandidates: [],
    approvedIndividual: null,
    reviewStatus: 'pending',
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

describe('CaptureScreen', () => {
  const originalPlatformOsDescriptor = Object.getOwnPropertyDescriptor(
    Platform,
    'OS',
  );

  beforeAll(async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => 'android',
    });
    await initDatabase();
  });

  afterAll(() => {
    if (originalPlatformOsDescriptor) {
      Object.defineProperty(Platform, 'OS', originalPlatformOsDescriptor);
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    useWildlifeStore.setState({
      packs: [],
      observations: [],
      miewidModel: {
        path: '/mock/miewid.onnx',
        name: 'miewid',
        version: '4.1.0',
        sha256: 'abc123',
        sizeBytes: 1000,
        status: 'ready',
        verifiedAt: '2026-08-01T00:00:00.000Z',
        format: 'onnx',
      },
    });
    mockProcessPhoto.mockResolvedValue(MOCK_PIPELINE_RESULT);
    mockLaunchCamera.mockResolvedValue({
      assets: [{ uri: 'file:///mock/camera.jpg' }],
    });
    mockLaunchImageLibrary.mockResolvedValue({
      assets: [{ uri: 'file:///mock/gallery.jpg' }],
    });
    mockRequestLocationPermission.mockResolvedValue(
      PermissionsAndroid.RESULTS.GRANTED,
    );
    mockGetCurrentPosition.mockImplementation(
      (
        success: (position: GeolocationResponse) => void,
      ) => {
        success({
          coords: {
            latitude: MOCK_GPS.lat,
            longitude: MOCK_GPS.lon,
            accuracy: MOCK_GPS.accuracy,
            altitude: null,
            heading: null,
            speed: null,
            altitudeAccuracy: null,
          },
          timestamp: 0,
        });
      },
    );
  });

  // ==========================================================================
  // Rendering
  // ==========================================================================

  it('renders capture screen with testID', () => {
    const { getByTestId } = render(<CaptureScreen />);
    expect(getByTestId('capture-screen')).toBeTruthy();
  });

  it('shows "Take Photo" button', () => {
    const { getByText } = render(<CaptureScreen />);
    expect(getByText('Take Photo')).toBeTruthy();
  });

  it('shows "Choose from Gallery" button', () => {
    const { getByText } = render(<CaptureScreen />);
    expect(getByText('Choose from Gallery')).toBeTruthy();
  });

  // ==========================================================================
  // Image Picker Interactions
  // ==========================================================================

  it('calls image picker when "Take Photo" pressed', async () => {
    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(mockLaunchCamera).toHaveBeenCalledWith({
        mediaType: 'photo',
        quality: 1,
      });
    });
  });

  it('calls image picker when "Choose from Gallery" pressed', async () => {
    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('choose-gallery-button'));

    await waitFor(() => {
      expect(mockLaunchImageLibrary).toHaveBeenCalledWith({
        mediaType: 'photo',
        quality: 1,
        selectionLimit: 0,
      });
    });
  });

  // ==========================================================================
  // Processing State
  // ==========================================================================

  it('shows loading state while pipeline is processing', async () => {
    // Make processPhoto hang until we resolve it
    let resolveProcessPhoto!: (value: any) => void;
    mockProcessPhoto.mockReturnValue(
      new Promise((resolve) => {
        resolveProcessPhoto = resolve;
      }),
    );

    const { getByTestId, getByText } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(getByText('Processing...')).toBeTruthy();
    });

    // Resolve to clean up and wait for state update to settle
    await act(async () => {
      resolveProcessPhoto(MOCK_PIPELINE_RESULT);
    });
  });

  // ==========================================================================
  // Navigation After Success
  // ==========================================================================

  it('navigates to DetectionResults after successful pipeline run', async () => {
    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        'DetectionResults',
        { observationId: 'obs-123' },
      );
    });
  });

  // ==========================================================================
  // Device Info & GPS
  // ==========================================================================

  it('saves observation with device info from Platform API', async () => {
    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });

    const observations = useWildlifeStore.getState().observations;
    expect(observations).toHaveLength(1);
    expect(observations[0].deviceInfo).toEqual({
      model: Platform.OS,
      os: `${Platform.OS} ${Platform.Version}`,
    });
  });

  it('queues the new observation for sync so it is not silently unreachable from the Sync screen', async () => {
    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });

    const queueItem = useWildlifeStore
      .getState()
      .syncQueue.find(item => item.observationId === 'obs-123');
    expect(queueItem).toMatchObject({
      observationId: 'obs-123',
      status: 'pending',
      retryCount: 0,
    });
  });

  it('saves GPS coordinates in observation when location permission is granted', async () => {
    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });

    const observations = useWildlifeStore.getState().observations;
    expect(observations[0].gps).toEqual(MOCK_GPS);
    expect(mockRequestLocationPermission).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      expect.objectContaining({
        title: 'Location permission',
      }),
    );
    expect(mockGetCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({
        enableHighAccuracy: true,
        timeout: 10000,
      }),
    );
  });

  it('saves GPS as null when location permission is denied and still completes capture', async () => {
    mockRequestLocationPermission.mockResolvedValue(
      PermissionsAndroid.RESULTS.DENIED,
    );

    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        'DetectionResults',
        { observationId: 'obs-123' },
      );
    });

    const observations = useWildlifeStore.getState().observations;
    expect(observations).toHaveLength(1);
    expect(observations[0].gps).toBeNull();
    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
  });

  it('saves GPS as null when geolocation lookup fails and still completes capture', async () => {
    mockGetCurrentPosition.mockImplementation(
      (
        _success: (position: GeolocationResponse) => void,
        error?: (error: GeolocationError) => void,
      ) => {
        error?.({
          code: 3,
          message: 'Location timeout',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      },
    );

    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        'DetectionResults',
        { observationId: 'obs-123' },
      );
    });

    const observations = useWildlifeStore.getState().observations;
    expect(observations).toHaveLength(1);
    expect(observations[0].gps).toBeNull();
  });

  // ==========================================================================
  // MiewID model gate
  // ==========================================================================

  it('blocks capture when no MiewID model record exists', async () => {
    useWildlifeStore.setState({ miewidModel: null });

    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'MiewID model not ready',
        expect.any(String),
      );
    });
    expect(wildlifePipeline.processPhoto).not.toHaveBeenCalled();
  });

  it('blocks capture when the MiewID model is corrupt', async () => {
    useWildlifeStore.setState({
      miewidModel: {
        path: '/mock/miewid.onnx',
        name: 'miewid',
        version: '4.1.0',
        sha256: 'abc123',
        sizeBytes: 1000,
        status: 'corrupt',
        verifiedAt: null,
        format: 'onnx',
      },
    });

    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'MiewID model not ready',
        expect.stringContaining('corrupt'),
      );
    });
    expect(wildlifePipeline.processPhoto).not.toHaveBeenCalled();
  });

  it('excludes quarantined packs from capture', async () => {
    useWildlifeStore.setState({
      packs: [
        makeTestPack({ id: 'pack-healthy', status: 'ready' }),
        makeTestPack({ id: 'pack-broken', status: 'quarantined' }),
      ],
    });

    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(wildlifePipeline.processPhoto).toHaveBeenCalled();
    });
    const call = (wildlifePipeline.processPhoto as jest.Mock).mock.calls[0][0];
    expect(call.speciesConfigs).toHaveLength(1);
    expect(call.speciesConfigs[0].packId).toBe('pack-healthy');
  });

  it('runs one detector per compatibility group when packs share species and detector', async () => {
    useWildlifeStore.setState({
      packs: [
        makeTestPack({ id: 'pack-a' }),
        makeTestPack({ id: 'pack-b', displayName: 'Second horse pack' }),
      ],
    });

    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(wildlifePipeline.processPhoto).toHaveBeenCalled();
    });
    const call = (wildlifePipeline.processPhoto as jest.Mock).mock.calls[0][0];
    // Same {species, featureClass, detector, embeddingModelVersion} → one group
    expect(call.speciesConfigs).toHaveLength(1);
    // The merged database must have been built from BOTH packs of the group
    const { buildEmbeddingDatabase } = require('../../../src/services/embeddingDatabaseBuilder');
    const dbCall = (buildEmbeddingDatabase as jest.Mock).mock.calls[0];
    expect(dbCall[1].map((p: { id: string }) => p.id).sort()).toEqual([
      'pack-a',
      'pack-b',
    ]);
  });

  it('keeps packs with different feature classes in separate groups', async () => {
    useWildlifeStore.setState({
      packs: [
        makeTestPack({ id: 'pack-face', featureClass: 'horse_wild+face' }),
        makeTestPack({
          id: 'pack-flank',
          featureClass: 'horse_wild+flank',
          detectorModelFile: '/packs/horse/models/flank_detector.onnx',
        }),
      ],
    });

    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(wildlifePipeline.processPhoto).toHaveBeenCalled();
    });
    const call = (wildlifePipeline.processPhoto as jest.Mock).mock.calls[0][0];
    expect(call.speciesConfigs).toHaveLength(2);
  });

  it("passes the pack's embedding input config through to the pipeline", async () => {
    for (const filepath of ['/packs/horse', '/packs/horse/manifest.json', '/packs/horse', '/packs/horse/config/detector.json']) {
      (RNFS.stat as jest.Mock).mockResolvedValueOnce({
        canonicalPath: filepath,
        isFile: () => filepath.endsWith('.json'),
        isDirectory: () => filepath === '/packs/horse',
      });
    }
    const { packManager } = require('../../../src/services/packManager');
    (packManager.loadManifest as jest.Mock).mockResolvedValue({
      embeddingModel: {
        name: 'miewid-v4',
        version: '4.1.0',
        inputSize: [416, 416],
        normalize: { mean: [0.5, 0.5, 0.5], std: [0.25, 0.25, 0.25] },
      },
      detectorModel: { filename: 'detector.onnx', configFile: 'config/detector.json' },
    });
    useWildlifeStore.setState({ packs: [makeTestPack()] });

    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(wildlifePipeline.processPhoto).toHaveBeenCalled();
    });
    const call = (wildlifePipeline.processPhoto as jest.Mock).mock.calls[0][0];
    expect(call.speciesConfigs[0].embeddingInputSize).toEqual([416, 416]);
    expect(call.speciesConfigs[0].embeddingNormalize).toEqual({
      mean: [0.5, 0.5, 0.5],
      std: [0.25, 0.25, 0.25],
    });
  });

  it('excludes packs with an incompatible embedding model version', async () => {
    useWildlifeStore.setState({
      packs: [
        makeTestPack({ id: 'pack-compatible', embeddingModelVersion: '4.1.0' }),
        makeTestPack({ id: 'pack-incompatible', embeddingModelVersion: '1.0.0' }),
      ],
    });

    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(wildlifePipeline.processPhoto).toHaveBeenCalled();
    });
    const call = (wildlifePipeline.processPhoto as jest.Mock).mock.calls[0][0];
    expect(call.speciesConfigs).toHaveLength(1);
    expect(call.speciesConfigs[0].packId).toBe('pack-compatible');
  });

  it('blocks identification when every pack has a different model version', async () => {
    useWildlifeStore.setState({
      packs: [
        makeTestPack({ embeddingModelVersion: '4.1.1' }),
      ],
    });

    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Model and pack versions do not match',
        expect.stringContaining('4.1.0'),
      );
    });
    expect(wildlifePipeline.processPhoto).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Partial-success handling
  // ==========================================================================

  it('saves the observation and warns when some detections failed', async () => {
    (wildlifePipeline.processPhoto as jest.Mock).mockResolvedValue({
      ...MOCK_PIPELINE_RESULT,
      detections: [MOCK_DETECTION],
      errors: [
        { species: 'zebra_plains', stage: 'detector', message: 'ONNX error' },
      ],
    });

    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('DetectionResults', {
        observationId: 'obs-123',
      });
    });
    expect(useWildlifeStore.getState().observations).toHaveLength(1);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Some detections failed',
      expect.stringContaining('zebra_plains'),
    );
  });

  it('does not save an observation when everything failed', async () => {
    (wildlifePipeline.processPhoto as jest.Mock).mockResolvedValue({
      ...MOCK_PIPELINE_RESULT,
      detections: [],
      errors: [
        { species: null, stage: 'embedding-model', message: 'model corrupt' },
      ],
    });

    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Detection Failed',
        expect.stringContaining('model corrupt'),
      );
    });
    expect(useWildlifeStore.getState().observations).toHaveLength(0);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('deletes the just-persisted files if the SQLite save fails after they were moved', async () => {
    (wildlifePipeline.processPhoto as jest.Mock).mockResolvedValue({
      ...MOCK_PIPELINE_RESULT,
      detections: [MOCK_DETECTION],
    });
    (database.insertObservationWithDetections as jest.Mock).mockRejectedValueOnce(
      new Error('disk full'),
    );
    // deleteObservationFiles only unlinks a directory that exists.
    (RNFS.exists as jest.Mock).mockResolvedValueOnce(true);

    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Detection Failed', 'disk full');
    });

    // The observation must not linger in memory once the durable save failed...
    expect(useWildlifeStore.getState().observations).toHaveLength(0);
    // ...and the photo/crop files that were already moved into durable
    // storage must be cleaned up rather than left as an orphaned directory.
    expect(RNFS.unlink).toHaveBeenCalledWith(
      expect.stringContaining('/observations/obs-123'),
    );
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  it('shows error alert when pipeline fails', async () => {
    mockProcessPhoto.mockRejectedValue(new Error('Detection model failed'));

    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Detection Failed',
        'Detection model failed',
      );
    });
  });

  // ==========================================================================
  // Cancel State
  // ==========================================================================

  it('does not process when user cancels photo selection', async () => {
    mockLaunchCamera.mockResolvedValue({ didCancel: true });

    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('take-photo-button'));

    await waitFor(() => {
      expect(mockLaunchCamera).toHaveBeenCalled();
    });

    expect(mockProcessPhoto).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Batch Import From Gallery
  // ==========================================================================

  describe('batch import from gallery', () => {
    it('still processes a single selected gallery photo through the normal single-photo flow', async () => {
      mockLaunchImageLibrary.mockResolvedValue({
        assets: [{ uri: 'file:///mock/gallery.jpg' }],
      });

      const { getByTestId } = render(<CaptureScreen />);
      fireEvent.press(getByTestId('choose-gallery-button'));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('DetectionResults', {
          observationId: 'obs-123',
        });
      });
    });

    it('processes multiple selected photos sequentially and lands on the Observations tab', async () => {
      mockLaunchImageLibrary.mockResolvedValue({
        assets: [
          { uri: 'file:///mock/gallery-1.jpg' },
          { uri: 'file:///mock/gallery-2.jpg' },
          { uri: 'file:///mock/gallery-3.jpg' },
        ],
      });
      let callCount = 0;
      mockProcessPhoto.mockImplementation(() => {
        callCount += 1;
        return Promise.resolve({
          ...MOCK_PIPELINE_RESULT,
          observationId: `obs-batch-${callCount}`,
          photoUri: `file:///mock/gallery-${callCount}.jpg`,
        });
      });

      const { getByTestId } = render(<CaptureScreen />);
      fireEvent.press(getByTestId('choose-gallery-button'));

      await waitFor(() => expect(mockProcessPhoto).toHaveBeenCalledTimes(3));
      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'ObservationsTab' }),
      );
      expect(Alert.alert).toHaveBeenCalledWith(
        'Batch import complete',
        expect.stringContaining('Saved 3 of 3'),
      );
      expect(useWildlifeStore.getState().observations).toHaveLength(3);
    });

    it('shows batch progress while processing multiple photos', async () => {
      mockLaunchImageLibrary.mockResolvedValue({
        assets: [
          { uri: 'file:///mock/gallery-1.jpg' },
          { uri: 'file:///mock/gallery-2.jpg' },
        ],
      });
      let resolveFirst!: (value: unknown) => void;
      let callCount = 0;
      mockProcessPhoto.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return new Promise(resolve => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve({
          ...MOCK_PIPELINE_RESULT,
          observationId: `obs-batch-${callCount}`,
          photoUri: `file:///mock/gallery-${callCount}.jpg`,
        });
      });

      const { getByTestId, getByText } = render(<CaptureScreen />);
      fireEvent.press(getByTestId('choose-gallery-button'));

      await waitFor(() => expect(getByText('Processing 1 of 2...')).toBeTruthy());

      await act(async () => {
        resolveFirst({
          ...MOCK_PIPELINE_RESULT,
          observationId: 'obs-batch-1',
          photoUri: 'file:///mock/gallery-1.jpg',
        });
      });

      await waitFor(() => expect(mockProcessPhoto).toHaveBeenCalledTimes(2));
    });

    it('continues past a photo that fails and reports it in the batch summary', async () => {
      mockLaunchImageLibrary.mockResolvedValue({
        assets: [
          { uri: 'file:///mock/gallery-1.jpg' },
          { uri: 'file:///mock/gallery-2.jpg' },
        ],
      });
      let callCount = 0;
      mockProcessPhoto.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.reject(new Error('disk full'));
        }
        return Promise.resolve({
          ...MOCK_PIPELINE_RESULT,
          observationId: `obs-batch-${callCount}`,
          photoUri: `file:///mock/gallery-${callCount}.jpg`,
        });
      });

      const { getByTestId } = render(<CaptureScreen />);
      fireEvent.press(getByTestId('choose-gallery-button'));

      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'ObservationsTab' }),
      );
      expect(Alert.alert).toHaveBeenCalledWith(
        'Batch import finished with errors',
        expect.stringContaining('Photo 1'),
      );
      expect(useWildlifeStore.getState().observations).toHaveLength(1);
    });

    it('warns and waits for confirmation before a batch when storage is low', async () => {
      mockLaunchImageLibrary.mockResolvedValue({
        assets: [
          { uri: 'file:///mock/gallery-1.jpg' },
          { uri: 'file:///mock/gallery-2.jpg' },
        ],
      });
      (DeviceInfo.getFreeDiskStorage as jest.Mock).mockResolvedValueOnce(100 * 1024 * 1024);
      (Alert.alert as jest.Mock).mockImplementationOnce(
        (_title: string, _message: string, buttons?: Array<{ text: string; onPress?: () => void }>) => {
          buttons?.find(b => b.text === 'Continue')?.onPress?.();
        },
      );

      const { getByTestId } = render(<CaptureScreen />);
      fireEvent.press(getByTestId('choose-gallery-button'));

      await waitFor(() =>
        expect(Alert.alert).toHaveBeenCalledWith(
          'Before processing this batch',
          expect.stringContaining('Storage is low'),
          expect.any(Array),
        ),
      );
      await waitFor(() => expect(mockProcessPhoto).toHaveBeenCalledTimes(2));
    });

    it('does not process the batch when the user cancels the low-storage warning', async () => {
      mockLaunchImageLibrary.mockResolvedValue({
        assets: [
          { uri: 'file:///mock/gallery-1.jpg' },
          { uri: 'file:///mock/gallery-2.jpg' },
        ],
      });
      (DeviceInfo.getFreeDiskStorage as jest.Mock).mockResolvedValueOnce(100 * 1024 * 1024);
      (Alert.alert as jest.Mock).mockImplementationOnce(
        (_title: string, _message: string, buttons?: Array<{ text: string; onPress?: () => void }>) => {
          buttons?.find(b => b.text === 'Cancel')?.onPress?.();
        },
      );

      const { getByTestId } = render(<CaptureScreen />);
      fireEvent.press(getByTestId('choose-gallery-button'));

      await waitFor(() =>
        expect(Alert.alert).toHaveBeenCalledWith(
          'Before processing this batch',
          expect.stringContaining('Storage is low'),
          expect.any(Array),
        ),
      );
      expect(mockProcessPhoto).not.toHaveBeenCalled();
    });
  });
});
