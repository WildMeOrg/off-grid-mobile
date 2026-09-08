/**
 * SignInScreen Tests
 *
 * Reached only from an action that needs connectivity (pack download, sync)
 * via utils/authGate.ensureSignedIn -- never a mandatory app-wide gate.
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockGoBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = false;
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      goBack: mockGoBack,
      replace: mockReplace,
      canGoBack: () => mockCanGoBack,
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

jest.mock('../../../src/services/entraAuthService', () => ({
  entraAuthService: { signIn: jest.fn() },
}));

jest.mock('../../../src/services/ganeshaApiClient', () => ({
  ganeshaApiClient: { getUserProfile: jest.fn() },
}));

import { SignInScreen } from '../../../src/screens/SignInScreen';
import { entraAuthService } from '../../../src/services/entraAuthService';
import { ganeshaApiClient } from '../../../src/services/ganeshaApiClient';

const mockSignIn = entraAuthService.signIn as jest.Mock;
const mockGetUserProfile = ganeshaApiClient.getUserProfile as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = false;
});

describe('SignInScreen', () => {
  it('renders the sign-in button', () => {
    const { getByTestId } = render(<SignInScreen />);
    expect(getByTestId('sign-in-button')).toBeTruthy();
  });

  it('does not render a back button when there is nowhere to go back to', () => {
    mockCanGoBack = false;
    const { queryByTestId } = render(<SignInScreen />);
    expect(queryByTestId('sign-in-back-button')).toBeNull();
  });

  it('goes back after a successful sign-in with an existing profile, if possible', async () => {
    mockCanGoBack = true;
    mockSignIn.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', idToken: 'i', accessTokenExpirationDate: '' });
    mockGetUserProfile.mockResolvedValue({ ok: true, data: { role: 'researcher' } });

    const { getByTestId } = render(<SignInScreen />);
    fireEvent.press(getByTestId('sign-in-button'));

    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('replaces with Main when there is nowhere to go back to', async () => {
    mockCanGoBack = false;
    mockSignIn.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', idToken: 'i', accessTokenExpirationDate: '' });
    mockGetUserProfile.mockResolvedValue({ ok: true, data: { role: 'researcher' } });

    const { getByTestId } = render(<SignInScreen />);
    fireEvent.press(getByTestId('sign-in-button'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Main'));
  });

  it('routes to SelectRole when the profile does not exist yet', async () => {
    mockSignIn.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', idToken: 'i', accessTokenExpirationDate: '' });
    mockGetUserProfile.mockResolvedValue({ ok: false, code: 'not-found', message: 'HTTP 404' });

    const { getByTestId } = render(<SignInScreen />);
    fireEvent.press(getByTestId('sign-in-button'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('SelectRole'));
  });

  it('alerts and stays on screen for a non-404 profile lookup failure', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSignIn.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', idToken: 'i', accessTokenExpirationDate: '' });
    mockGetUserProfile.mockResolvedValue({ ok: false, code: 'network-error', message: 'offline' });

    const { getByTestId } = render(<SignInScreen />);
    fireEvent.press(getByTestId('sign-in-button'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('alerts on a real sign-in failure but not on a cancelled sign-in', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSignIn.mockRejectedValue(new Error('User cancelled flow'));

    const { getByTestId } = render(<SignInScreen />);
    fireEvent.press(getByTestId('sign-in-button'));

    await waitFor(() => expect(mockSignIn).toHaveBeenCalled());
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockGetUserProfile).not.toHaveBeenCalled();
  });

  it('alerts on a non-cancellation sign-in error', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSignIn.mockRejectedValue(new Error('network_error'));

    const { getByTestId } = render(<SignInScreen />);
    fireEvent.press(getByTestId('sign-in-button'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Sign-in failed', 'network_error'));
  });
});
