/**
 * SelectRoleScreen Tests
 *
 * First-sign-in-only profile setup. Access is assigned by the backend from
 * the verified Microsoft identity; the user never chooses a role.
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      replace: mockReplace,
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

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return (props: Record<string, unknown>) => <Text>{String(props.name)}</Text>;
});

jest.mock('../../../src/components/Button', () => ({
  Button: ({ title, onPress, loading, disabled, testID }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress} disabled={disabled} testID={testID}>
        <Text>{loading ? `${title} (loading)` : title}</Text>
      </TouchableOpacity>
    );
  },
}));

jest.mock('../../../src/components/Card', () => {
  const { View } = require('react-native');
  return { Card: ({ children, style }: any) => <View style={style}>{children}</View> };
});

jest.mock('../../../src/services/ganeshaApiClient', () => ({
  ganeshaApiClient: { createUserProfile: jest.fn() },
}));

import { SelectRoleScreen } from '../../../src/screens/SelectRoleScreen';
import { ganeshaApiClient } from '../../../src/services/ganeshaApiClient';
const mockCreateUserProfile = ganeshaApiClient.createUserProfile as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SelectRoleScreen', () => {
  it('renders one complete-profile action and no role choices', () => {
    const { getByTestId, queryByTestId } = render(<SelectRoleScreen />);
    expect(getByTestId('complete-profile-button')).toBeTruthy();
    expect(queryByTestId('select-role-researcher-button')).toBeNull();
    expect(queryByTestId('select-role-citizen-button')).toBeNull();
  });

  it('requires a name before completing the profile', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByTestId } = render(<SelectRoleScreen />);

    fireEvent.press(getByTestId('complete-profile-button'));

    expect(alertSpy).toHaveBeenCalledWith('Name required', expect.any(String));
    expect(mockCreateUserProfile).not.toHaveBeenCalled();
  });

  it('creates a profile with only the entered name, then replaces with Main', async () => {
    mockCreateUserProfile.mockResolvedValue({ ok: true, data: {} });
    const { getByTestId, getByPlaceholderText } = render(<SelectRoleScreen />);

    fireEvent.changeText(getByPlaceholderText('Enter your name'), 'Alex');
    fireEvent.press(getByTestId('complete-profile-button'));

    await waitFor(() =>
      expect(mockCreateUserProfile).toHaveBeenCalledWith({
        name: 'Alex',
      }),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Main'));
  });

  it('alerts and does not navigate when saving the profile fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateUserProfile.mockResolvedValue({ ok: false, code: 'http-error', message: 'HTTP 500' });
    const { getByTestId, getByPlaceholderText } = render(<SelectRoleScreen />);

    fireEvent.changeText(getByPlaceholderText('Enter your name'), 'Alex');
    fireEvent.press(getByTestId('complete-profile-button'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Could not save your profile', 'HTTP 500'));
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
