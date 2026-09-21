jest.mock('react-native-app-auth', () => ({
  authorize: jest.fn(),
  refresh: jest.fn(),
  revoke: jest.fn(),
}));

jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(() => Promise.resolve(true)),
  getGenericPassword: jest.fn(() => Promise.resolve(false)),
  resetGenericPassword: jest.fn(() => Promise.resolve(true)),
  ACCESSIBLE: { WHEN_UNLOCKED: 'AccessibleWhenUnlocked' },
}));

import { authorize, refresh, revoke } from 'react-native-app-auth';
import * as Keychain from 'react-native-keychain';
import {
  entraAuthService,
  ENTRA_INTERACTIVE_TIMEOUT_MS,
  ENTRA_REFRESH_TIMEOUT_MS,
} from '../../../src/services/entraAuthService';
import { ENTRA_ISSUER, ENTRA_MOBILE_CLIENT_ID, ENTRA_REDIRECT_URL, ENTRA_SCOPES } from '../../../src/config/entraAuth';
import { deploymentConfig, getTokenStorageService } from '../../../src/config/deployment';

const TOKEN_SERVICE = getTokenStorageService(deploymentConfig);
const mockAuthorize = authorize as jest.Mock;
const mockRefresh = refresh as jest.Mock;
const mockRevoke = revoke as jest.Mock;
const mockSetGenericPassword = Keychain.setGenericPassword as jest.Mock;
const mockGetGenericPassword = Keychain.getGenericPassword as jest.Mock;
const mockResetGenericPassword = Keychain.resetGenericPassword as jest.Mock;

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 1000).toISOString();

const storedCredentials = (tokens: Record<string, unknown>) => ({
  username: 'entra-tokens',
  password: JSON.stringify(tokens),
  service: TOKEN_SERVICE,
  storage: 'keychain',
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('entraAuthService.signIn', () => {
  it('authorizes with the expected config and stores the resulting tokens', async () => {
    mockAuthorize.mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      idToken: 'id-1',
      accessTokenExpirationDate: FUTURE,
      tokenType: 'Bearer',
      scopes: ENTRA_SCOPES,
      authorizationCode: 'code-1',
    });

    const tokens = await entraAuthService.signIn();

    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({
        issuer: ENTRA_ISSUER,
        clientId: ENTRA_MOBILE_CLIENT_ID,
        redirectUrl: ENTRA_REDIRECT_URL,
        scopes: ENTRA_SCOPES,
        usePKCE: true,
      }),
    );
    expect(tokens).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      idToken: 'id-1',
      accessTokenExpirationDate: FUTURE,
    });
    expect(mockSetGenericPassword).toHaveBeenCalledWith(
      'entra-tokens',
      JSON.stringify(tokens),
      expect.objectContaining({ service: TOKEN_SERVICE }),
    );
  });

  it('stores null for refreshToken when Entra does not return one', async () => {
    mockAuthorize.mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: '',
      idToken: 'id-1',
      accessTokenExpirationDate: FUTURE,
    });

    const tokens = await entraAuthService.signIn();

    expect(tokens.refreshToken).toBeNull();
  });
});

describe('entraAuthService.isSignedIn', () => {
  it('returns false when nothing is stored', async () => {
    mockGetGenericPassword.mockResolvedValue(false);
    expect(await entraAuthService.isSignedIn()).toBe(false);
    expect(mockGetGenericPassword).toHaveBeenCalledWith({ service: TOKEN_SERVICE });
  });

  it('does not read credentials from the old unscoped token service', async () => {
    mockGetGenericPassword.mockImplementation(async ({ service }: { service: string }) => (
      service === 'org.ganesha.elebook.entra'
        ? storedCredentials({ accessToken: 'old-deployment-token' })
        : false
    ));

    expect(await entraAuthService.isSignedIn()).toBe(false);
    expect(mockGetGenericPassword).toHaveBeenCalledTimes(1);
    expect(mockGetGenericPassword).toHaveBeenCalledWith({ service: TOKEN_SERVICE });
  });

  it('returns true when a session is stored', async () => {
    mockGetGenericPassword.mockResolvedValue(
      storedCredentials({ accessToken: 'a', refreshToken: 'r', idToken: 'i', accessTokenExpirationDate: FUTURE }),
    );
    expect(await entraAuthService.isSignedIn()).toBe(true);
  });
});

describe('entraAuthService.signOut', () => {
  it('revokes the access token then clears local storage', async () => {
    mockGetGenericPassword.mockResolvedValue(
      storedCredentials({ accessToken: 'access-1', refreshToken: 'r', idToken: 'i', accessTokenExpirationDate: FUTURE }),
    );
    mockRevoke.mockResolvedValue(undefined);

    await entraAuthService.signOut();

    expect(mockRevoke).toHaveBeenCalledWith(
      expect.objectContaining({ issuer: ENTRA_ISSUER, clientId: ENTRA_MOBILE_CLIENT_ID }),
      { tokenToRevoke: 'access-1' },
    );
    expect(mockResetGenericPassword).toHaveBeenCalledWith({ service: TOKEN_SERVICE });
  });

  it('still clears local storage when the revoke call fails', async () => {
    mockGetGenericPassword.mockResolvedValue(
      storedCredentials({ accessToken: 'access-1', refreshToken: 'r', idToken: 'i', accessTokenExpirationDate: FUTURE }),
    );
    mockRevoke.mockRejectedValue(new Error('revocation not supported'));

    await expect(entraAuthService.signOut()).resolves.toBeUndefined();

    expect(mockResetGenericPassword).toHaveBeenCalledWith({ service: TOKEN_SERVICE });
  });

  it('does nothing to revoke when there is no stored session', async () => {
    mockGetGenericPassword.mockResolvedValue(false);

    await entraAuthService.signOut();

    expect(mockRevoke).not.toHaveBeenCalled();
    expect(mockResetGenericPassword).toHaveBeenCalled();
  });
});

describe('entraAuthService.getValidAccessToken', () => {
  it('returns null when never signed in', async () => {
    mockGetGenericPassword.mockResolvedValue(false);
    expect(await entraAuthService.getValidAccessToken()).toBeNull();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('returns the stored access token when it is not near expiry', async () => {
    mockGetGenericPassword.mockResolvedValue(
      storedCredentials({ accessToken: 'access-1', refreshToken: 'r', idToken: 'i', accessTokenExpirationDate: FUTURE }),
    );

    expect(await entraAuthService.getValidAccessToken()).toBe('access-1');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('refreshes and returns the new access token when the stored one is expired', async () => {
    mockGetGenericPassword.mockResolvedValue(
      storedCredentials({ accessToken: 'stale', refreshToken: 'refresh-1', idToken: 'i', accessTokenExpirationDate: PAST }),
    );
    mockRefresh.mockResolvedValue({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      idToken: 'id-2',
      accessTokenExpirationDate: FUTURE,
      tokenType: 'Bearer',
    });

    const token = await entraAuthService.getValidAccessToken();

    expect(mockRefresh).toHaveBeenCalledWith(expect.objectContaining({ clientId: ENTRA_MOBILE_CLIENT_ID }), {
      refreshToken: 'refresh-1',
    });
    expect(token).toBe('access-2');
    expect(mockSetGenericPassword).toHaveBeenCalledWith(
      'entra-tokens',
      JSON.stringify({ accessToken: 'access-2', refreshToken: 'refresh-2', idToken: 'id-2', accessTokenExpirationDate: FUTURE }),
      expect.anything(),
    );
  });

  it('keeps the existing refresh token when Entra does not issue a new one', async () => {
    mockGetGenericPassword.mockResolvedValue(
      storedCredentials({ accessToken: 'stale', refreshToken: 'refresh-1', idToken: 'i', accessTokenExpirationDate: PAST }),
    );
    mockRefresh.mockResolvedValue({
      accessToken: 'access-2',
      refreshToken: null,
      idToken: 'id-2',
      accessTokenExpirationDate: FUTURE,
    });

    await entraAuthService.getValidAccessToken();

    expect(mockSetGenericPassword).toHaveBeenCalledWith(
      'entra-tokens',
      expect.stringContaining('"refreshToken":"refresh-1"'),
      expect.anything(),
    );
  });

  it('returns null and clears storage when expired with no refresh token', async () => {
    mockGetGenericPassword.mockResolvedValue(
      storedCredentials({ accessToken: 'stale', refreshToken: null, idToken: 'i', accessTokenExpirationDate: PAST }),
    );

    expect(await entraAuthService.getValidAccessToken()).toBeNull();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockResetGenericPassword).toHaveBeenCalledWith({ service: TOKEN_SERVICE });
  });

  it('returns null and clears storage when the refresh call fails', async () => {
    mockGetGenericPassword.mockResolvedValue(
      storedCredentials({ accessToken: 'stale', refreshToken: 'refresh-1', idToken: 'i', accessTokenExpirationDate: PAST }),
    );
    mockRefresh.mockRejectedValue(new Error('invalid_grant'));

    expect(await entraAuthService.getValidAccessToken()).toBeNull();
    expect(mockResetGenericPassword).toHaveBeenCalledWith({ service: TOKEN_SERVICE });
  });
});

describe('entraAuthService deadlines', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  // AppAuth bounds neither leg. On a marginal link the token exchange stalls
  // after the browser has already closed, so authorize() never settles and the
  // sign-in screen spins forever with nothing to report.
  it('gives up on an interactive sign-in that never settles', async () => {
    jest.useFakeTimers();
    mockAuthorize.mockImplementation(() => new Promise(() => {}));

    const pending = entraAuthService.signIn();
    const assertion = expect(pending).rejects.toThrow(/timed out after 180s/);
    await jest.advanceTimersByTimeAsync(ENTRA_INTERACTIVE_TIMEOUT_MS);
    await assertion;
  });

  it('gives up on a token refresh that never settles', async () => {
    jest.useFakeTimers();
    mockGetGenericPassword.mockResolvedValue({
      username: 'entra-tokens',
      password: JSON.stringify({
        accessToken: 'stale',
        refreshToken: 'refresh-me',
        idToken: 'id',
        accessTokenExpirationDate: new Date(Date.now() - 1000).toISOString(),
      }),
    });
    mockRefresh.mockImplementation(() => new Promise(() => {}));

    const pending = entraAuthService.getValidAccessToken();
    await jest.advanceTimersByTimeAsync(ENTRA_REFRESH_TIMEOUT_MS);

    // A refresh that cannot complete is reported as "no valid session" rather
    // than thrown, matching how an expired refresh token is already handled.
    await expect(pending).resolves.toBeNull();
  });

  it('does not interfere with a sign-in that completes normally', async () => {
    mockAuthorize.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      idToken: 'i',
      accessTokenExpirationDate: new Date(Date.now() + 3_600_000).toISOString(),
    });

    await expect(entraAuthService.signIn()).resolves.toMatchObject({ accessToken: 'a' });
  });
});
