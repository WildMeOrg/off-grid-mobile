import { pbkdf2Sync } from 'node:crypto';
import { createPassphraseVerifier, verifyPassphraseVerifier } from '../../../src/services/passphraseVerifier';
import { secureRandomBytes } from '../../../src/services/secureRandom';

jest.mock('../../../src/services/secureRandom', () => ({ secureRandomBytes: jest.fn() }));

const mockRandomBytes = secureRandomBytes as jest.Mock;
const PASSPHRASE = 'test passphrase';
const SALT = Buffer.alloc(16, 23);
const RECORD = {
  version: 2,
  algorithm: 'pbkdf2-sha256',
  iterations: 600000,
  salt: SALT.toString('hex'),
  hash: pbkdf2Sync(PASSPHRASE, SALT, 600000, 32, 'sha256').toString('hex'),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRandomBytes.mockReturnValue(Uint8Array.from(SALT));
});

describe('passphrase verifier', () => {
  it('creates a salted versioned record matching Node PBKDF2-HMAC-SHA256', async () => {
    const serialized = await createPassphraseVerifier(PASSPHRASE);
    expect(JSON.parse(serialized)).toEqual(RECORD);
    expect(serialized).not.toContain(PASSPHRASE);
    expect(mockRandomBytes).toHaveBeenCalledWith(16);
  });

  it('produces distinct hashes with fresh salts for the same passphrase', async () => {
    mockRandomBytes.mockReturnValueOnce(new Uint8Array(16).fill(1));
    const first = JSON.parse(await createPassphraseVerifier(PASSPHRASE));
    mockRandomBytes.mockReturnValueOnce(new Uint8Array(16).fill(2));
    const second = JSON.parse(await createPassphraseVerifier(PASSPHRASE));
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it('uses UTF-8 without relying on a global TextEncoder', async () => {
    const original = globalThis.TextEncoder;
    Object.defineProperty(globalThis, 'TextEncoder', { value: undefined, configurable: true });
    try {
      const passphrase = 'caf\u00e9 passphrase';
      const record = JSON.parse(await createPassphraseVerifier(passphrase));
      expect(record.hash).toBe(pbkdf2Sync(passphrase, SALT, 600000, 32, 'sha256').toString('hex'));
    } finally {
      Object.defineProperty(globalThis, 'TextEncoder', { value: original, configurable: true });
    }
  });

  it('accepts the matching passphrase without generating a new salt', async () => {
    await expect(verifyPassphraseVerifier(PASSPHRASE, JSON.stringify(RECORD))).resolves.toBe(true);
    expect(mockRandomBytes).not.toHaveBeenCalled();
  });

  it('rejects a wrong passphrase', async () => {
    await expect(verifyPassphraseVerifier('wrong passphrase', JSON.stringify(RECORD))).resolves.toBe(false);
  });

  it.each([
    '', '46b7b9953cbd3af0', 'not-json', 'null', '[]',
    JSON.stringify({ ...RECORD, version: 1 }),
    JSON.stringify({ ...RECORD, version: 3 }),
    JSON.stringify({ ...RECORD, algorithm: 'sha256' }),
    JSON.stringify({ ...RECORD, iterations: 1 }),
    JSON.stringify({ ...RECORD, iterations: 1000000000 }),
    JSON.stringify({ ...RECORD, salt: '00' }),
    JSON.stringify({ ...RECORD, salt: 'z'.repeat(32) }),
    JSON.stringify({ ...RECORD, hash: '00' }),
    JSON.stringify({ ...RECORD, hash: 'z'.repeat(64) }),
  ])('rejects malformed, weak, or unsupported stored records: %s', async record => {
    await expect(verifyPassphraseVerifier(PASSPHRASE, record)).resolves.toBe(false);
    expect(mockRandomBytes).not.toHaveBeenCalled();
  });

  it('does not create a verifier without secure randomness', async () => {
    mockRandomBytes.mockImplementation(() => { throw new Error('Native randomness unavailable'); });
    await expect(createPassphraseVerifier(PASSPHRASE)).rejects.toThrow('Native randomness unavailable');
  });

  it.each(['', 'x'.repeat(1025)])('rejects invalid passphrase lengths before hashing', async passphrase => {
    await expect(createPassphraseVerifier(passphrase)).rejects.toThrow('Invalid passphrase length');
    expect(mockRandomBytes).not.toHaveBeenCalled();
  });
});