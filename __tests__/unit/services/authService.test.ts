jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
  ACCESSIBLE: { WHEN_UNLOCKED: 'AccessibleWhenUnlocked' },
}));
jest.mock('../../../src/services/passphraseVerifier', () => ({
  createPassphraseVerifier: jest.fn(),
  verifyPassphraseVerifier: jest.fn(),
}));

import * as Keychain from 'react-native-keychain';
import { authService } from '../../../src/services/authService';
import { createPassphraseVerifier, verifyPassphraseVerifier } from '../../../src/services/passphraseVerifier';

const LEGACY_SERVICE = 'ai.offgridmobile.auth';
const CURRENT_SERVICE = 'org.ganesha.elebook.local-lock.v2';
const LEGACY_HASH = '46b7b9953cbd3af0';
const CURRENT_VERIFIER = JSON.stringify({ version: 2, algorithm: 'pbkdf2-sha256', iterations: 600000, salt: '17'.repeat(16), hash: 'ab'.repeat(32) });
const storage = new Map<string, string>();
const mockGet = Keychain.getGenericPassword as jest.Mock;
const mockSet = Keychain.setGenericPassword as jest.Mock;
const mockReset = Keychain.resetGenericPassword as jest.Mock;
const mockCreate = createPassphraseVerifier as jest.Mock;
const mockVerify = verifyPassphraseVerifier as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  storage.clear();
  mockCreate.mockResolvedValue(CURRENT_VERIFIER);
  mockVerify.mockResolvedValue(false);
  mockGet.mockImplementation(async ({ service }: { service: string }) => storage.has(service)
    ? { username: service === LEGACY_SERVICE ? 'passphrase_hash' : 'passphrase_verifier', password: storage.get(service), service }
    : false);
  mockSet.mockImplementation(async (_username: string, password: string, { service }: { service: string }) => {
    storage.set(service, password);
    return { service };
  });
  mockReset.mockImplementation(async ({ service }: { service: string }) => {
    storage.delete(service);
    return true;
  });
});

describe('local lock storage and migration', () => {
  it('stores a new salted verifier in the versioned service', async () => {
    await expect(authService.setPassphrase('new passphrase')).resolves.toBe(true);
    expect(mockCreate).toHaveBeenCalledWith('new passphrase');
    expect(mockSet).toHaveBeenCalledWith('passphrase_verifier', CURRENT_VERIFIER, {
      service: CURRENT_SERVICE, accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
    expect(storage.get(CURRENT_SERVICE)).toBe(CURRENT_VERIFIER);
    expect(storage.has(LEGACY_SERVICE)).toBe(false);
  });

  it('does not report success when secure storage refuses the write', async () => {
    mockSet.mockResolvedValue(false);
    await expect(authService.setPassphrase('new passphrase')).resolves.toBe(false);
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('uses the current verifier without consulting legacy storage', async () => {
    storage.set(CURRENT_SERVICE, CURRENT_VERIFIER);
    storage.set(LEGACY_SERVICE, LEGACY_HASH);
    mockVerify.mockResolvedValue(true);
    await expect(authService.verifyPassphrase('new passphrase')).resolves.toBe(true);
    expect(mockVerify).toHaveBeenCalledWith('new passphrase', CURRENT_VERIFIER);
    expect(mockGet).not.toHaveBeenCalledWith({ service: LEGACY_SERVICE });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('never falls back to a legacy match when the current verifier rejects', async () => {
    storage.set(CURRENT_SERVICE, CURRENT_VERIFIER);
    storage.set(LEGACY_SERVICE, LEGACY_HASH);
    await expect(authService.verifyPassphrase('test passphrase')).resolves.toBe(false);
    expect(mockGet).not.toHaveBeenCalledWith({ service: LEGACY_SERVICE });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('does not bypass a corrupt or unknown current record with a legacy lock', async () => {
    storage.set(CURRENT_SERVICE, 'corrupt record');
    storage.set(LEGACY_SERVICE, LEGACY_HASH);
    await expect(authService.verifyPassphrase('test passphrase')).resolves.toBe(false);
    expect(mockGet).not.toHaveBeenCalledWith({ service: LEGACY_SERVICE });
  });

  it('upgrades a verified legacy lock before removing the old entry', async () => {
    storage.set(LEGACY_SERVICE, LEGACY_HASH);
    mockSet.mockImplementationOnce(async (_username: string, record: string, { service }: { service: string }) => {
      expect(storage.get(LEGACY_SERVICE)).toBe(LEGACY_HASH);
      storage.set(service, record);
      return { service };
    });
    await expect(authService.verifyPassphrase('test passphrase')).resolves.toBe(true);
    expect(storage.get(CURRENT_SERVICE)).toBe(CURRENT_VERIFIER);
    expect(storage.has(LEGACY_SERVICE)).toBe(false);
    expect(mockSet.mock.invocationCallOrder[0]).toBeLessThan(mockReset.mock.invocationCallOrder[0]);
  });

  it('does not migrate or mutate a failed legacy attempt', async () => {
    storage.set(LEGACY_SERVICE, LEGACY_HASH);
    await expect(authService.verifyPassphrase('wrong passphrase')).resolves.toBe(false);
    expect(storage.get(LEGACY_SERVICE)).toBe(LEGACY_HASH);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockReset).not.toHaveBeenCalled();
  });

  it.each(['not-a-hash', '', '{}'])('rejects malformed legacy records: %s', async record => {
    storage.set(LEGACY_SERVICE, record);
    await expect(authService.verifyPassphrase('test passphrase')).resolves.toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('keeps the old lock when native randomness or derivation fails', async () => {
    storage.set(LEGACY_SERVICE, LEGACY_HASH);
    mockCreate.mockRejectedValue(new Error('Native RNG unavailable'));
    await expect(authService.verifyPassphrase('test passphrase')).resolves.toBe(false);
    expect(storage.get(LEGACY_SERVICE)).toBe(LEGACY_HASH);
    expect(storage.has(CURRENT_SERVICE)).toBe(false);
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('keeps the old lock when writing its replacement fails', async () => {
    storage.set(LEGACY_SERVICE, LEGACY_HASH);
    mockSet.mockRejectedValue(new Error('Keystore unavailable'));
    await expect(authService.verifyPassphrase('test passphrase')).resolves.toBe(false);
    expect(storage.get(LEGACY_SERVICE)).toBe(LEGACY_HASH);
    expect(storage.has(CURRENT_SERVICE)).toBe(false);
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('keeps the legacy lock if the replacement cannot be read back', async () => {
    storage.set(LEGACY_SERVICE, LEGACY_HASH);
    mockSet.mockResolvedValue({ service: CURRENT_SERVICE });
    await expect(authService.verifyPassphrase('test passphrase')).resolves.toBe(false);
    expect(storage.get(LEGACY_SERVICE)).toBe(LEGACY_HASH);
    expect(mockReset).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 0, ''])('does not interpret an invalid current read as an absent lock: %s', async response => {
    storage.set(LEGACY_SERVICE, LEGACY_HASH);
    mockGet.mockResolvedValueOnce(response);
    await expect(authService.verifyPassphrase('test passphrase')).resolves.toBe(false);
    expect(mockGet).not.toHaveBeenCalledWith({ service: LEGACY_SERVICE });
    expect(mockSet).not.toHaveBeenCalled();
    mockGet.mockResolvedValueOnce(response);
    await expect(authService.hasPassphrase()).resolves.toBe(true);
  });

  it('keeps the new verifier authoritative if legacy cleanup fails', async () => {
    storage.set(LEGACY_SERVICE, LEGACY_HASH);
    mockReset.mockRejectedValue(new Error('Cleanup unavailable'));
    await expect(authService.verifyPassphrase('test passphrase')).resolves.toBe(true);
    expect(storage.get(CURRENT_SERVICE)).toBe(CURRENT_VERIFIER);
    mockGet.mockClear();
    await expect(authService.verifyPassphrase('test passphrase')).resolves.toBe(false);
    expect(mockGet).not.toHaveBeenCalledWith({ service: LEGACY_SERVICE });
  });

  it('reports no lock only when neither service has an entry', async () => {
    await expect(authService.hasPassphrase()).resolves.toBe(false);
    storage.set(CURRENT_SERVICE, CURRENT_VERIFIER);
    await expect(authService.hasPassphrase()).resolves.toBe(true);
    storage.delete(CURRENT_SERVICE);
    storage.set(LEGACY_SERVICE, LEGACY_HASH);
    await expect(authService.hasPassphrase()).resolves.toBe(true);
  });

  it('fails closed when secure storage cannot be read', async () => {
    mockGet.mockRejectedValue(new Error('Keystore unavailable'));
    await expect(authService.hasPassphrase()).resolves.toBe(true);
    await expect(authService.verifyPassphrase('test passphrase')).resolves.toBe(false);
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('removes legacy data before removing the current lock', async () => {
    storage.set(CURRENT_SERVICE, CURRENT_VERIFIER);
    storage.set(LEGACY_SERVICE, LEGACY_HASH);
    await expect(authService.removePassphrase()).resolves.toBe(true);
    expect(mockReset).toHaveBeenNthCalledWith(1, { service: LEGACY_SERVICE });
    expect(mockReset).toHaveBeenNthCalledWith(2, { service: CURRENT_SERVICE });
    expect(storage.size).toBe(0);
  });

  it('preserves the current lock if removing a legacy entry fails', async () => {
    storage.set(CURRENT_SERVICE, CURRENT_VERIFIER);
    storage.set(LEGACY_SERVICE, LEGACY_HASH);
    mockReset.mockResolvedValue(false);
    await expect(authService.removePassphrase()).resolves.toBe(false);
    expect(storage.get(CURRENT_SERVICE)).toBe(CURRENT_VERIFIER);
    expect(mockReset).not.toHaveBeenCalledWith({ service: CURRENT_SERVICE });
  });

  it('changes the passphrase only after successful current verification', async () => {
    storage.set(CURRENT_SERVICE, CURRENT_VERIFIER);
    mockVerify.mockResolvedValue(true);
    await expect(authService.changePassphrase('current passphrase', 'replacement passphrase')).resolves.toBe(true);
    expect(mockCreate).toHaveBeenCalledWith('replacement passphrase');
  });

  it('does not change the lock after failed verification', async () => {
    storage.set(CURRENT_SERVICE, CURRENT_VERIFIER);
    await expect(authService.changePassphrase('wrong passphrase', 'replacement passphrase')).resolves.toBe(false);
    expect(mockSet).not.toHaveBeenCalled();
  });
});