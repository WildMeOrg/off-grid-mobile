/**
 * PacksScreen Tests
 *
 * Tests for the embedding packs list screen including:
 * - Empty state when no packs downloaded
 * - Pack card rendering with species name, individual count, export date, size
 * - Multiple packs rendering
 * - Navigation to PackDetails on pack tap
 * - Correct testIDs
 */

import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import { useWildlifeStore } from '../../../src/stores/wildlifeStore';
import { useAppStore } from '../../../src/stores/appStore';
import { MIEWID_LITERT_MODEL_NAME, MIEWID_MODEL_NAME } from '../../../src/config/modelSources';
import type {
  EmbeddingPack,
  MiewIDModelRecord,
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
    useIsFocused: () => true,
    useFocusEffect: jest.fn(),
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

jest.mock('../../../src/services/modelSourceResolver', () => ({
  resolveMiewidModelSource: jest.fn(),
}));

jest.mock('../../../src/services/miewidModelManager', () => ({
  prepareMiewidModel: jest.fn(),
}));

jest.mock('../../../src/services/packDownloadService', () => ({
  acquireLatestPack: jest.fn(),
  checkLatestPackStatus: jest.fn(),
}));

jest.mock('../../../src/utils/authGate', () => ({
  ensureSignedIn: jest.fn(),
}));

import { PacksScreen } from '../../../src/screens/PacksScreen';
import { useFocusEffect as navigationUseFocusEffect } from '@react-navigation/native';
import { resolveMiewidModelSource } from '../../../src/services/modelSourceResolver';
import { prepareMiewidModel } from '../../../src/services/miewidModelManager';
import {
  acquireLatestPack,
  checkLatestPackStatus,
} from '../../../src/services/packDownloadService';
import { ensureSignedIn } from '../../../src/utils/authGate';

const mockResolveMiewidModelSource = resolveMiewidModelSource as jest.Mock;
const mockUseFocusEffect = navigationUseFocusEffect as jest.Mock;
const mockPrepareMiewidModel = prepareMiewidModel as jest.Mock;
const mockAcquireLatestPack = acquireLatestPack as jest.Mock;
const mockCheckLatestPackStatus = checkLatestPackStatus as jest.Mock;
const mockEnsureSignedIn = ensureSignedIn as jest.Mock;

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

const createPack = (overrides: Partial<EmbeddingPack> = {}): EmbeddingPack => ({
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
  sizeBytes: 52_428_800, // 50 MB
  ...overrides,
});

const readyModel: MiewIDModelRecord = {
  path: '/mock/documents/models/miewid-4.1.0.onnx',
  name: 'miewid',
  version: '4.1.0',
  sha256: 'abc123',
  sizeBytes: 204_011_297,
  status: 'ready',
  verifiedAt: '2026-08-01T00:00:00.000Z',
  format: 'onnx',
};

const latestModelSource = {
  name: 'miewid',
  version: '4.1.0',
  url: 'https://example/model.onnx',
  expectedSha256: 'abc123',
  expectedSizeBytes: 204_011_297,
  format: 'onnx' as const,
};

describe('PacksScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFocusEffect.mockImplementation(() => undefined);
    useWildlifeStore.setState({ packs: [], miewidModel: null });
    mockEnsureSignedIn.mockResolvedValue(true);
    mockResolveMiewidModelSource.mockResolvedValue({
      ok: true,
      source: latestModelSource,
    });
  });

  // ==========================================================================
  // Empty State
  // ==========================================================================
  describe('empty state', () => {
    it('renders the screen container with correct testID', () => {
      const { getByTestId } = render(<PacksScreen />);
      expect(getByTestId('packs-screen')).toBeTruthy();
    });

    it('shows "Packs" title', () => {
      const { getByText } = render(<PacksScreen />);
      expect(getByText('Packs')).toBeTruthy();
    });

    it('shows "No Packs Downloaded" when there are no packs', () => {
      const { getByText } = render(<PacksScreen />);
      expect(getByText('No Packs Downloaded')).toBeTruthy();
    });

    it('shows empty state description', () => {
      const { getByText } = render(<PacksScreen />);
      expect(
        getByText(
          /Download an embedding pack to start identifying individuals/,
        ),
      ).toBeTruthy();
    });

    it('does not render any pack cards in empty state', () => {
      const { queryByTestId } = render(<PacksScreen />);
      expect(queryByTestId('pack-card-0')).toBeNull();
    });
  });

  // ==========================================================================
  // Pack Card Rendering
  // ==========================================================================
  describe('pack card rendering', () => {
    it('renders species display name', () => {
      const pack = createPack({ displayName: 'Humpback Whale — Fluke' });
      useWildlifeStore.setState({ packs: [pack] });

      const { getByText } = render(<PacksScreen />);
      expect(getByText('Humpback Whale — Fluke')).toBeTruthy();
    });

    it('renders individual count', () => {
      const pack = createPack({ individualCount: 342 });
      useWildlifeStore.setState({ packs: [pack] });

      const { getByText } = render(<PacksScreen />);
      expect(getByText('342 individuals')).toBeTruthy();
    });

    it('renders formatted export date', () => {
      const pack = createPack({ exportDate: '2025-06-15T00:00:00Z' });
      useWildlifeStore.setState({ packs: [pack] });

      const { getByText } = render(<PacksScreen />);
      // toLocaleDateString() format varies by locale, just check it contains "Exported:"
      expect(getByText(/Exported:/)).toBeTruthy();
    });

    it('renders formatted size in MB', () => {
      const pack = createPack({ sizeBytes: 52_428_800 }); // 50 MB
      useWildlifeStore.setState({ packs: [pack] });

      const { getByText } = render(<PacksScreen />);
      expect(getByText(/50\.0 MB/)).toBeTruthy();
    });

    it('renders formatted size in GB', () => {
      const pack = createPack({ sizeBytes: 2_147_483_648 }); // 2 GB
      useWildlifeStore.setState({ packs: [pack] });

      const { getByText } = render(<PacksScreen />);
      expect(getByText(/2\.0 GB/)).toBeTruthy();
    });

    it('renders formatted size in KB', () => {
      const pack = createPack({ sizeBytes: 512_000 }); // ~500 KB
      useWildlifeStore.setState({ packs: [pack] });

      const { getByText } = render(<PacksScreen />);
      expect(getByText(/500\.0 KB/)).toBeTruthy();
    });

    it('does not show empty state when packs exist', () => {
      const pack = createPack();
      useWildlifeStore.setState({ packs: [pack] });

      const { queryByText } = render(<PacksScreen />);
      expect(queryByText('No Packs Downloaded')).toBeNull();
    });
  });

  // ==========================================================================
  // Multiple Packs
  // ==========================================================================
  describe('multiple packs', () => {
    it('renders all packs in the list', () => {
      const packs = [
        createPack({
          id: 'pack-1',
          displayName: 'Humpback Whale — Fluke',
          individualCount: 342,
        }),
        createPack({
          id: 'pack-2',
          displayName: 'Wild Dog — Coat Pattern',
          individualCount: 89,
          sizeBytes: 1_073_741_824, // 1 GB
        }),
      ];
      useWildlifeStore.setState({ packs });

      const { getByText } = render(<PacksScreen />);
      expect(getByText('Humpback Whale — Fluke')).toBeTruthy();
      expect(getByText('Wild Dog — Coat Pattern')).toBeTruthy();
      expect(getByText('342 individuals')).toBeTruthy();
      expect(getByText('89 individuals')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Navigation
  // ==========================================================================
  describe('navigation', () => {
    it('navigates to PackDetails when a pack is tapped', () => {
      const pack = createPack({ id: 'pack-abc' });
      useWildlifeStore.setState({ packs: [pack] });

      const { getByTestId } = render(<PacksScreen />);
      fireEvent.press(getByTestId('pack-card-0'));

      expect(mockNavigate).toHaveBeenCalledWith('PackDetails', {
        packId: 'pack-abc',
      });
    });

    it('navigates with correct packId for second pack', () => {
      const packs = [
        createPack({ id: 'pack-1', displayName: 'Pack A' }),
        createPack({ id: 'pack-2', displayName: 'Pack B' }),
      ];
      useWildlifeStore.setState({ packs });

      const { getByTestId } = render(<PacksScreen />);
      fireEvent.press(getByTestId('pack-card-1'));

      expect(mockNavigate).toHaveBeenCalledWith('PackDetails', {
        packId: 'pack-2',
      });
    });
  });

  // ==========================================================================
  // Test IDs
  // ==========================================================================
  describe('testIDs', () => {
    it('has packs-screen testID on root container', () => {
      const { getByTestId } = render(<PacksScreen />);
      expect(getByTestId('packs-screen')).toBeTruthy();
    });

    it('has pack-card-{index} testID on each pack card', () => {
      const packs = [
        createPack({ id: 'pack-1', displayName: 'Pack A' }),
        createPack({ id: 'pack-2', displayName: 'Pack B' }),
        createPack({ id: 'pack-3', displayName: 'Pack C' }),
      ];
      useWildlifeStore.setState({ packs });

      const { getByTestId } = render(<PacksScreen />);
      expect(getByTestId('pack-card-0')).toBeTruthy();
      expect(getByTestId('pack-card-1')).toBeTruthy();
      expect(getByTestId('pack-card-2')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Download and update actions
  // ==========================================================================
  describe('download button', () => {
    it.each([null, 'missing', 'corrupt', 'incompatible'] as const)(
      'repairs a %s model when the installed pack is current',
      async status => {
        const installedPack = createPack({ id: 'example-project', status: 'ready' });
        useWildlifeStore.setState({
          packs: [installedPack],
          miewidModel: status ? { ...readyModel, status } : null,
        });
        mockCheckLatestPackStatus.mockResolvedValue({ ok: true, isLatest: true, latestVersion: installedPack.packVersion });
        mockPrepareMiewidModel.mockResolvedValue(readyModel);
        mockAcquireLatestPack.mockResolvedValue({ ok: true, pack: installedPack });
        let focusCallback: (() => void) | undefined;
        mockUseFocusEffect.mockImplementation(callback => { focusCallback = callback; });
        const { getByTestId, getByText } = render(<PacksScreen />);

        act(() => focusCallback?.());
        await waitFor(() => expect(getByText('Update available')).toBeTruthy());
        fireEvent.press(getByTestId('update-pack-button'));

        await waitFor(() => expect(mockAcquireLatestPack).toHaveBeenCalledWith('example-project', {}, readyModel));
        expect(mockPrepareMiewidModel).toHaveBeenCalledWith(latestModelSource);
      },
    );

    it('reports that the installed pack is up to date without downloading it', async () => {
      const installedPack = createPack({
        id: 'example-project',
        packVersion: '2026-09-05T11:06:39Z',
        artifactSha256: 'pack-sha',
        status: 'ready',
      });
      useWildlifeStore.setState({
        packs: [installedPack],
        miewidModel: readyModel,
      });
      mockCheckLatestPackStatus.mockResolvedValue({
        ok: true,
        isLatest: true,
        latestVersion: installedPack.packVersion,
      });
      let focusCallback: (() => void) | undefined;
      mockUseFocusEffect.mockImplementation(callback => {
        focusCallback = callback;
      });

      const { getByText, getByTestId } = render(<PacksScreen />);
      act(() => focusCallback?.());

      await waitFor(() => expect(getByText('Up to date')).toBeTruthy());
      expect(getByTestId('update-pack-button').props.accessibilityLabel).toBe(
        'Check Again',
      );
      expect(mockAcquireLatestPack).not.toHaveBeenCalled();
    });

    it('shows download when empty and update when a pack is installed', async () => {
      const { getByTestId, queryByTestId } = render(<PacksScreen />);
      expect(getByTestId('download-pack-button')).toBeTruthy();
      expect(queryByTestId('update-pack-button')).toBeNull();

      await act(async () => {
        useWildlifeStore.setState({ packs: [createPack()] });
      });
      expect(queryByTestId('download-pack-button')).toBeNull();
      expect(getByTestId('update-pack-button')).toBeTruthy();
    });

    it('updates an installed pack through the latest-pack acquisition flow', async () => {
      const installedPack = createPack({ id: 'example-project' });
      useWildlifeStore.setState({
        packs: [installedPack],
        miewidModel: readyModel,
      });
      mockCheckLatestPackStatus.mockResolvedValue({
        ok: true,
        isLatest: false,
        latestVersion: '2026-09-05T11:06:39Z',
      });
      mockAcquireLatestPack.mockResolvedValue({
        ok: true,
        pack: createPack({
          packVersion: '2026-09-05T11:06:39Z',
          individualCount: 66,
        }),
      });
      let focusCallback: (() => void) | undefined;
      mockUseFocusEffect.mockImplementation(callback => {
        focusCallback = callback;
      });

      const { getByTestId, getByText } = render(<PacksScreen />);
      act(() => focusCallback?.());
      await waitFor(() => expect(getByText('Update available')).toBeTruthy());
      fireEvent.press(getByTestId('update-pack-button'));

      await waitFor(() =>
        expect(mockAcquireLatestPack).toHaveBeenCalledWith(
          'example-project',
          {},
          readyModel,
        ),
      );
      expect(mockPrepareMiewidModel).not.toHaveBeenCalled();
    });

    it('keeps an accessible label and exposes busy state while updating', async () => {
      const installedPack = createPack({ id: 'example-project' });
      useWildlifeStore.setState({
        packs: [installedPack],
        miewidModel: readyModel,
      });
      mockCheckLatestPackStatus.mockResolvedValue({
        ok: true,
        isLatest: false,
        latestVersion: '2026-09-05T11:06:39Z',
      });
      let finishUpdate: ((value: { ok: true; pack: EmbeddingPack }) => void) | undefined;
      mockAcquireLatestPack.mockReturnValue(
        new Promise(resolve => {
          finishUpdate = resolve;
        }),
      );
      let focusCallback: (() => void) | undefined;
      mockUseFocusEffect.mockImplementation(callback => {
        focusCallback = callback;
      });

      const { getByTestId, getByText } = render(<PacksScreen />);
      act(() => focusCallback?.());
      await waitFor(() => expect(getByText('Update available')).toBeTruthy());
      fireEvent.press(getByTestId('update-pack-button'));

      await waitFor(() => {
        const button = getByTestId('update-pack-button');
        expect(button.props.accessibilityRole).toBe('button');
        expect(button.props.accessibilityLabel).toBe('Update to Latest Pack');
        expect(button.props.accessibilityState).toEqual({
          busy: true,
          disabled: true,
        });
      });

      await act(async () => {
        finishUpdate?.({ ok: true, pack: createPack() });
      });
    });

    it('starts only one update when the action is pressed twice rapidly', async () => {
      let finishSignIn: ((value: boolean) => void) | undefined;
      mockEnsureSignedIn.mockReturnValue(
        new Promise(resolve => {
          finishSignIn = resolve;
        }),
      );

      const { getByTestId } = render(<PacksScreen />);
      fireEvent.press(getByTestId('download-pack-button'));
      fireEvent.press(getByTestId('download-pack-button'));

      expect(mockEnsureSignedIn).toHaveBeenCalledTimes(1);
      await act(async () => finishSignIn?.(false));
    });

    it('contains a rejected sign-in check and allows a later retry', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockEnsureSignedIn
        .mockRejectedValueOnce(new Error('auth storage unavailable'))
        .mockResolvedValueOnce(false);

      const { getByTestId } = render(<PacksScreen />);
      fireEvent.press(getByTestId('download-pack-button'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());

      fireEvent.press(getByTestId('download-pack-button'));
      await waitFor(() => expect(mockEnsureSignedIn).toHaveBeenCalledTimes(2));
    });

    it('does not start the download when not signed in', async () => {
      mockEnsureSignedIn.mockResolvedValue(false);

      const { getByTestId } = render(<PacksScreen />);
      fireEvent.press(getByTestId('download-pack-button'));

      await waitFor(() => expect(mockEnsureSignedIn).toHaveBeenCalled());
      expect(mockResolveMiewidModelSource).not.toHaveBeenCalled();
      expect(mockAcquireLatestPack).not.toHaveBeenCalled();
    });

    it('skips the model download when the installed model matches the latest artifact', async () => {
      useWildlifeStore.setState({ miewidModel: readyModel });
      mockAcquireLatestPack.mockResolvedValue({ ok: true, pack: createPack() });

      const { getByTestId } = render(<PacksScreen />);
      fireEvent.press(getByTestId('download-pack-button'));

      await waitFor(() =>
        expect(mockAcquireLatestPack).toHaveBeenCalledWith(
          'example-project',
          {},
          readyModel,
        ),
      );
      expect(mockResolveMiewidModelSource).toHaveBeenCalled();
      expect(mockPrepareMiewidModel).not.toHaveBeenCalled();
    });

    it('acquires the model first when it is not yet installed, then the pack', async () => {
      mockPrepareMiewidModel.mockResolvedValue(readyModel);
      mockAcquireLatestPack.mockResolvedValue({ ok: true, pack: createPack() });

      const { getByTestId } = render(<PacksScreen />);
      fireEvent.press(getByTestId('download-pack-button'));

      await waitFor(() =>
        expect(mockAcquireLatestPack).toHaveBeenCalledWith(
          'example-project',
          {},
          readyModel,
        ),
      );
      expect(mockResolveMiewidModelSource).toHaveBeenCalled();
      expect(mockPrepareMiewidModel).toHaveBeenCalled();
    });

    it('requests the standard ONNX model name when GPU preference is off', async () => {
      mockPrepareMiewidModel.mockResolvedValue(readyModel);
      mockAcquireLatestPack.mockResolvedValue({ ok: true, pack: createPack() });

      const { getByTestId } = render(<PacksScreen />);
      fireEvent.press(getByTestId('download-pack-button'));

      await waitFor(() => expect(mockResolveMiewidModelSource).toHaveBeenCalled());
      expect(mockResolveMiewidModelSource).toHaveBeenCalledWith(MIEWID_MODEL_NAME);
    });

    it('requests the LiteRT/GPU model name when the GPU preference is on (Android)', async () => {
      const originalPlatformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
      useAppStore.getState().setPreferGpuModel(true);
      mockPrepareMiewidModel.mockResolvedValue(readyModel);
      mockAcquireLatestPack.mockResolvedValue({ ok: true, pack: createPack() });

      try {
        const { getByTestId } = render(<PacksScreen />);
        fireEvent.press(getByTestId('download-pack-button'));

        await waitFor(() => expect(mockResolveMiewidModelSource).toHaveBeenCalled());
        expect(mockResolveMiewidModelSource).toHaveBeenCalledWith(MIEWID_LITERT_MODEL_NAME);
      } finally {
        useAppStore.getState().setPreferGpuModel(false);
        if (originalPlatformOsDescriptor) {
          Object.defineProperty(Platform, 'OS', originalPlatformOsDescriptor);
        }
      }
    });

    it('ignores the GPU preference on iOS and still requests the ONNX model', async () => {
      useAppStore.getState().setPreferGpuModel(true);
      mockPrepareMiewidModel.mockResolvedValue(readyModel);
      mockAcquireLatestPack.mockResolvedValue({ ok: true, pack: createPack() });

      try {
        const { getByTestId } = render(<PacksScreen />);
        fireEvent.press(getByTestId('download-pack-button'));

        await waitFor(() => expect(mockResolveMiewidModelSource).toHaveBeenCalled());
        expect(mockResolveMiewidModelSource).toHaveBeenCalledWith(MIEWID_MODEL_NAME);
      } finally {
        useAppStore.getState().setPreferGpuModel(false);
      }
    });

    it('makes the Update button reachable when only the model format needs to change (pack itself is already current)', async () => {
      const originalPlatformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
      useAppStore.getState().setPreferGpuModel(true);

      const installedPack = createPack({
        id: 'example-project',
        packVersion: '2026-09-05T11:06:39Z',
        artifactSha256: 'pack-sha',
        status: 'ready',
      });
      useWildlifeStore.setState({
        packs: [installedPack],
        miewidModel: readyModel, // format: 'onnx', but the GPU preference now wants 'tflite'
      });
      mockCheckLatestPackStatus.mockResolvedValue({
        ok: true,
        isLatest: true,
        latestVersion: installedPack.packVersion,
      });
      mockResolveMiewidModelSource.mockResolvedValue({
        ok: true,
        source: { ...latestModelSource, format: 'tflite' as const, expectedSha256: 'gpu-sha' },
      });
      mockPrepareMiewidModel.mockResolvedValue({ ...readyModel, format: 'tflite' });
      mockAcquireLatestPack.mockResolvedValue({ ok: true, pack: createPack() });
      let focusCallback: (() => void) | undefined;
      mockUseFocusEffect.mockImplementation(callback => {
        focusCallback = callback;
      });

      try {
        const { getByText, getByTestId } = render(<PacksScreen />);
        act(() => focusCallback?.());

        // packUpdateState alone would say "Up to date" -- the model-format
        // mismatch must override that so the button is actually pressable.
        await waitFor(() => expect(getByText('Update available')).toBeTruthy());
        fireEvent.press(getByTestId('update-pack-button'));

        await waitFor(() =>
          expect(mockResolveMiewidModelSource).toHaveBeenCalledWith(MIEWID_LITERT_MODEL_NAME),
        );
        expect(mockPrepareMiewidModel).toHaveBeenCalled();
        expect(mockAcquireLatestPack).toHaveBeenCalled();
      } finally {
        useAppStore.getState().setPreferGpuModel(false);
        if (originalPlatformOsDescriptor) {
          Object.defineProperty(Platform, 'OS', originalPlatformOsDescriptor);
        }
      }
    });

    it('replaces a ready model when the latest artifact identity changed', async () => {
      useWildlifeStore.setState({
        miewidModel: {
          ...readyModel,
          version: '4.0.0',
          sha256: 'old-hash',
        },
      });
      mockPrepareMiewidModel.mockResolvedValue(readyModel);
      mockAcquireLatestPack.mockResolvedValue({ ok: true, pack: createPack() });

      const { getByTestId } = render(<PacksScreen />);
      fireEvent.press(getByTestId('download-pack-button'));

      await waitFor(() =>
        expect(mockAcquireLatestPack).toHaveBeenCalledWith(
          'example-project',
          {},
          readyModel,
        ),
      );
      expect(mockPrepareMiewidModel).toHaveBeenCalledWith(latestModelSource);
    });

    it('alerts and stops when resolving the model source fails', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockResolveMiewidModelSource.mockResolvedValue({
        ok: false,
        code: 'network-error',
        message: 'offline',
      });

      const { getByTestId } = render(<PacksScreen />);
      fireEvent.press(getByTestId('download-pack-button'));

      await waitFor(() => expect(alertSpy).toHaveBeenCalled());
      expect(mockPrepareMiewidModel).not.toHaveBeenCalled();
      expect(mockAcquireLatestPack).not.toHaveBeenCalled();
    });

    it('alerts and stops when the model download does not end in ready status', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockPrepareMiewidModel.mockResolvedValue({
        ...readyModel,
        status: 'corrupt',
      });

      const { getByTestId } = render(<PacksScreen />);
      fireEvent.press(getByTestId('download-pack-button'));

      await waitFor(() => expect(alertSpy).toHaveBeenCalled());
      expect(mockAcquireLatestPack).not.toHaveBeenCalled();
    });

    it('alerts when the pack download fails', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      useWildlifeStore.setState({ miewidModel: readyModel });
      mockAcquireLatestPack.mockResolvedValue({
        ok: false,
        code: 'checksum-mismatch',
        message: 'bad hash',
      });

      const { getByTestId } = render(<PacksScreen />);
      fireEvent.press(getByTestId('download-pack-button'));

      await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    });
  });
});
