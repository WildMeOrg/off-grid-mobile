import { authorize, refresh, revoke } from 'react-native-app-auth';
import type { AuthConfiguration } from 'react-native-app-auth';
import * as Keychain from 'react-native-keychain';
import logger from '../utils/logger';
import { ENTRA_ISSUER, ENTRA_MOBILE_CLIENT_ID, ENTRA_REDIRECT_URL, ENTRA_SCOPES } from '../config/entraAuth';
import { deploymentConfig, getTokenStorageService } from '../config/deployment';

const KEYCHAIN_SERVICE = getTokenStorageService(deploymentConfig);
const KEYCHAIN_USERNAME = 'entra-tokens';

/**
 * Refresh this many ms before the access token's real expiry, so a request
 * in flight never races against the token expiring mid-call.
 */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

export interface StoredEntraTokens {
  accessToken: string;
  refreshToken: string | null;
  idToken: string;
  /** ISO 8601 timestamp. */
  accessTokenExpirationDate: string;
}

/**
 * AppAuth has no deadline of its own on either leg of the flow, and on a
 * marginal link the token exchange is where it stalls: the browser closes, the
 * authorization code comes back, and the POST that trades it for tokens never
 * completes. `authorize()` then never settles, so the screen spins forever with
 * nothing to report. Measured in the field on a link at -74dBm with 40% beacon
 * loss, which is an ordinary reserve connection, not an edge case.
 *
 * The interactive budget is deliberately long: it has to cover reading a
 * password manager and approving an MFA push on another device, so cutting it
 * short would fail people who were succeeding. It exists to bound the hang, not
 * to be hit in normal use. Refresh is non-interactive and gets far less.
 */
export const ENTRA_INTERACTIVE_TIMEOUT_MS = 180_000;
export const ENTRA_REFRESH_TIMEOUT_MS = 30_000;

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const authConfig: AuthConfiguration = {
  issuer: ENTRA_ISSUER,
  clientId: ENTRA_MOBILE_CLIENT_ID,
  redirectUrl: ENTRA_REDIRECT_URL,
  scopes: ENTRA_SCOPES,
  usePKCE: true,
};

/**
 * Wraps react-native-app-auth's authorize/refresh/revoke calls with secure,
 * on-device token storage (react-native-keychain -- already a dependency,
 * already used for the local PIN-lock passphrase under a different service
 * name) and expiry-aware access token retrieval.
 *
 * This is the ONLY place that should call authorize()/refresh() directly;
 * every other call site (ganeshaApiClient, screens) goes through
 * getValidAccessToken() so token storage/refresh logic isn't duplicated.
 */
class EntraAuthService {
  /** Runs the interactive sign-in flow (opens the system browser) and stores the resulting tokens. */
  async signIn(): Promise<StoredEntraTokens> {
    const result = await withDeadline(
      authorize(authConfig),
      ENTRA_INTERACTIVE_TIMEOUT_MS,
      'Sign-in',
    );
    const tokens: StoredEntraTokens = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken || null,
      idToken: result.idToken,
      accessTokenExpirationDate: result.accessTokenExpirationDate,
    };
    await this.storeTokens(tokens);
    return tokens;
  }

  /**
   * Clears the locally stored session. Best-effort revokes the access token
   * server-side first -- a failed revoke call (Entra's v2 endpoint does not
   * support RFC 7009 revocation for every flow) must not block sign-out,
   * since clearing the local tokens is what actually secures this device.
   */
  async signOut(): Promise<void> {
    const tokens = await this.loadTokens();
    if (tokens?.accessToken) {
      try {
        await revoke(
          { issuer: ENTRA_ISSUER, clientId: ENTRA_MOBILE_CLIENT_ID },
          { tokenToRevoke: tokens.accessToken },
        );
      } catch (error) {
        logger.warn('[EntraAuthService] Token revoke call failed (clearing local tokens anyway):', error);
      }
    }
    await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  }

  async isSignedIn(): Promise<boolean> {
    return (await this.loadTokens()) !== null;
  }

  /**
   * Returns a currently-valid access token, transparently refreshing first
   * if the stored one is expired or about to expire. Returns null if the
   * user has never signed in, or if refresh fails and a stored refresh
   * token can no longer renew the session -- callers must treat null as
   * "route back to the sign-in screen", not retry.
   */
  async getValidAccessToken(): Promise<string | null> {
    const tokens = await this.loadTokens();
    if (!tokens) {
      return null;
    }

    const expiresAtMs = new Date(tokens.accessTokenExpirationDate).getTime();
    if (Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > EXPIRY_SAFETY_MARGIN_MS) {
      return tokens.accessToken;
    }

    if (!tokens.refreshToken) {
      logger.warn('[EntraAuthService] Access token expired and no refresh token is stored -- sign-in is required again.');
      await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
      return null;
    }

    try {
      const refreshed = await withDeadline(
        refresh(authConfig, { refreshToken: tokens.refreshToken }),
        ENTRA_REFRESH_TIMEOUT_MS,
        'Token refresh',
      );
      const newTokens: StoredEntraTokens = {
        accessToken: refreshed.accessToken,
        // Entra does not always return a new refresh token on a refresh
        // call -- keep the existing one when a new one wasn't issued.
        refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
        idToken: refreshed.idToken,
        accessTokenExpirationDate: refreshed.accessTokenExpirationDate,
      };
      await this.storeTokens(newTokens);
      return newTokens.accessToken;
    } catch (error) {
      logger.warn('[EntraAuthService] Token refresh failed -- sign-in is required again:', error);
      await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
      return null;
    }
  }

  private async storeTokens(tokens: StoredEntraTokens): Promise<void> {
    await Keychain.setGenericPassword(KEYCHAIN_USERNAME, JSON.stringify(tokens), {
      service: KEYCHAIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  }

  private async loadTokens(): Promise<StoredEntraTokens | null> {
    try {
      const credentials = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
      if (!credentials) {
        return null;
      }
      return JSON.parse(credentials.password) as StoredEntraTokens;
    } catch (error) {
      logger.warn('[EntraAuthService] Failed to read stored tokens:', error);
      return null;
    }
  }
}

export const entraAuthService = new EntraAuthService();
