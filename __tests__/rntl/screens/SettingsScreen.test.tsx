/**
 * SettingsScreen Tests
 *
 * Tests for the settings screen including:
 * - Title and version display
 * - Navigation items
 * - Theme selector
 * - Privacy section
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// Navigation is globally mocked in jest.setup.ts

jest.mock('../../../src/hooks/useFocusTrigger', () => ({
  useFocusTrigger: () => 0,
}));

jest.mock('../../../src/components', () => ({
  Card: ({ children, style }: any) => {
    const { View } = require('react-native');
    return <View style={style}>{children}</View>;
  },
}));

jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));

jest.mock('../../../src/components/AnimatedListItem', () => ({
  AnimatedListItem: ({ children, onPress, style }: any) => {
    const { TouchableOpacity } = require('react-native');
    return (
      <TouchableOpacity style={style} onPress={onPress}>
        {children}
      </TouchableOpacity>
    );
  },
}));

const mockSetOnboardingComplete = jest.fn();
const mockSetThemeMode = jest.fn();
const mockSetPreferGpuModel = jest.fn();
let mockPreferGpuModel = false;
jest.mock('../../../src/stores', () => ({
  useAppStore: jest.fn((selector?: any) => {
    const state = {
      setOnboardingComplete: mockSetOnboardingComplete,
      themeMode: 'system',
      setThemeMode: mockSetThemeMode,
      preferGpuModel: mockPreferGpuModel,
      setPreferGpuModel: mockSetPreferGpuModel,
    };
    return selector ? selector(state) : state;
  }),
  useWildlifeStore: jest.fn((selector?: any) => {
    const state = {
      miewidModel: {
        version: '4.1.0',
      },
      packs: [
        {
          id: 'example-project',
          displayName: 'Example Population',
          packVersion: '2026-08-23T10:00:00Z',
        },
      ],
    };
    return selector ? selector(state) : state;
  }),
}));

import { SettingsScreen } from '../../../src/screens/SettingsScreen';

const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    getParent: () => ({
      getParent: () => ({
        dispatch: mockDispatch,
      }),
    }),
  }),
  CommonActions: {
    reset: jest.fn((params: any) => params),
  },
}));

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders "Settings" title', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Settings')).toBeTruthy();
  });

  it('renders version number', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('0.1.0-field.1 (1787551542)')).toBeTruthy();
    expect(getByText('4.1.0')).toBeTruthy();
    expect(getByText('2026-08-23T10:00:00Z')).toBeTruthy();
  });

  it('renders Security navigation item', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Security')).toBeTruthy();
    expect(getByText('Passphrase and app lock')).toBeTruthy();
  });

  it('navigates to SecuritySettings when Security is pressed', () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Security'));
    expect(mockNavigate).toHaveBeenCalledWith('SecuritySettings');
  });

  it('renders theme selector with Appearance label', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Appearance')).toBeTruthy();
  });

  it('renders Privacy First section', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Privacy First')).toBeTruthy();
    expect(
      getByText(/captured and matched entirely on\s+this device/),
    ).toBeTruthy();
  });

  it('renders about section text', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('App version')).toBeTruthy();
    expect(getByText(/EleBook helps identify elephants/)).toBeTruthy();
  });

  it('renders Reset Onboarding button in __DEV__ mode', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Reset Onboarding')).toBeTruthy();
  });

  it('calls setOnboardingComplete and dispatches reset on Reset Onboarding press', () => {
    const { CommonActions } = require('@react-navigation/native');
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Reset Onboarding'));

    expect(mockSetOnboardingComplete).toHaveBeenCalledWith(false);
    expect(CommonActions.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'Onboarding' }],
    });
    expect(mockDispatch).toHaveBeenCalled();
  });

  describe('GPU acceleration toggle', () => {
    const { Platform } = require('react-native');
    const originalPlatformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');

    afterEach(() => {
      mockPreferGpuModel = false;
      if (originalPlatformOsDescriptor) {
        Object.defineProperty(Platform, 'OS', originalPlatformOsDescriptor);
      }
    });

    it('shows the GPU acceleration toggle on Android', () => {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });

      const { getByTestId, getByText } = render(<SettingsScreen />);

      expect(getByText('GPU acceleration')).toBeTruthy();
      expect(getByTestId('gpu-acceleration-toggle')).toBeTruthy();
    });

    it('does not show the GPU acceleration toggle on iOS', () => {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });

      const { queryByTestId, queryByText } = render(<SettingsScreen />);

      expect(queryByText('GPU acceleration')).toBeNull();
      expect(queryByTestId('gpu-acceleration-toggle')).toBeNull();
    });

    it('calls setPreferGpuModel when the toggle is switched', () => {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
      mockPreferGpuModel = false;

      const { getByTestId } = render(<SettingsScreen />);
      fireEvent(getByTestId('gpu-acceleration-toggle'), 'valueChange', true);

      expect(mockSetPreferGpuModel).toHaveBeenCalledWith(true);
    });
  });
});
