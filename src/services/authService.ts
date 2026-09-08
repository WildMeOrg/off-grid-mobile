import * as Keychain from 'react-native-keychain';
import logger from '../utils/logger';
import { createPassphraseVerifier, verifyPassphraseVerifier } from './passphraseVerifier';
import { matchesLegacyPassphrase } from './legacyPassphrase';

const LEGACY_SERVICE_NAME = 'ai.offgridmobile.auth';
const SERVICE_NAME = 'org.ganesha.elebook.local-lock.v2';
const PASSPHRASE_KEY = 'passphrase_verifier';

class AuthService {
  async setPassphrase(passphrase: string): Promise<boolean> {
    try {
      const verifier = await createPassphraseVerifier(passphrase);
      const written = await Keychain.setGenericPassword(PASSPHRASE_KEY, verifier, {
        service: SERVICE_NAME,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
      });
      if (!written) {
        return false;
      }
      const stored = await this.readEntry(SERVICE_NAME);
      if (!stored || stored.password !== verifier) {
        return false;
      }
      try {
        if (!(await this.removeEntry(LEGACY_SERVICE_NAME))) {
          logger.warn('Legacy lock cleanup failed; the current verifier remains authoritative');
        }
      } catch {
        logger.warn('Legacy lock cleanup failed; the current verifier remains authoritative');
      }
      return true;
    } catch {
      logger.error('Failed to store the local passphrase verifier');
      return false;
    }
  }

  async verifyPassphrase(passphrase: string): Promise<boolean> {
    try {
      const credentials = await this.readEntry(SERVICE_NAME);

      if (credentials) {
        return await verifyPassphraseVerifier(passphrase, credentials.password);
      }
      const legacy = await this.readEntry(LEGACY_SERVICE_NAME);
      if (!legacy || !matchesLegacyPassphrase(passphrase, legacy.password)) {
        return false;
      }
      return await this.setPassphrase(passphrase);
    } catch {
      logger.error('Failed to verify the local passphrase');
      return false;
    }
  }

  async hasPassphrase(): Promise<boolean> {
    try {
      const credentials = await this.readEntry(SERVICE_NAME);
      if (credentials) {
        return true;
      }
      return (await this.readEntry(LEGACY_SERVICE_NAME)) !== false;
    } catch {
      logger.error('Unable to read lock state; keeping the local lock enabled');
      return true;
    }
  }

  async removePassphrase(): Promise<boolean> {
    try {
      if (!(await this.removeEntry(LEGACY_SERVICE_NAME))) {
        return false;
      }
      return await this.removeEntry(SERVICE_NAME);
    } catch {
      logger.error('Failed to remove the local passphrase');
      return false;
    }
  }

  async changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<boolean> {
    const isValid = await this.verifyPassphrase(oldPassphrase);
    if (!isValid) {
      return false;
    }
    return this.setPassphrase(newPassphrase);
  }

  private async removeEntry(service: string): Promise<boolean> {
    if (!(await this.readEntry(service))) {
      return true;
    }
    return Keychain.resetGenericPassword({ service });
  }

  private async readEntry(service: string): Promise<{ password: string } | false> {
    const entry = await Keychain.getGenericPassword({ service });
    if (entry === false) {
      return false;
    }
    if (!entry || typeof entry.password !== 'string') {
      throw new Error('Invalid secure-storage response');
    }
    return entry;
  }
}

export const authService = new AuthService();
