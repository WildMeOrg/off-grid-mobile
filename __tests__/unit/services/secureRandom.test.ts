jest.mock('react-native', () => ({ TurboModuleRegistry: { getEnforcing: jest.fn() } }));

import { TurboModuleRegistry } from 'react-native';
import { secureRandomBytes } from '../../../src/services/secureRandom';

const mockGetModule = TurboModuleRegistry.getEnforcing as jest.Mock;

beforeEach(() => jest.resetAllMocks());

describe('native secure randomness', () => {
  it('uses the native random generator for salt bytes', () => {
    const bytes = Buffer.alloc(16, 7);
    const getRandomBase64 = jest.fn(() => bytes.toString('base64'));
    mockGetModule.mockReturnValue({ getRandomBase64 });
    expect(secureRandomBytes(16)).toEqual(Uint8Array.from(bytes));
    expect(mockGetModule).toHaveBeenCalledWith('RNGetRandomValues');
    expect(getRandomBase64).toHaveBeenCalledWith(16);
  });

  it('fails without the native generator instead of falling back to Math.random', () => {
    const failure = new Error('Native RNG unavailable');
    mockGetModule.mockImplementation(() => { throw failure; });
    const insecureRandom = jest.spyOn(Math, 'random');
    let thrown: unknown;
    let insecureCalls: number;
    try {
      try {
        secureRandomBytes(16);
      } catch (error) {
        thrown = error;
      }
      insecureCalls = insecureRandom.mock.calls.length;
    } finally {
      insecureRandom.mockRestore();
    }
    expect(thrown).toBe(failure);
    expect(insecureCalls).toBe(0);
  });

  it.each(['not-base64', 'AA==', '', 'AAAAAAAAAAAAAAAAAAAAAA='])('rejects malformed native output: %s', output => {
    mockGetModule.mockReturnValue({ getRandomBase64: () => output });
    expect(() => secureRandomBytes(16)).toThrow('Native RNG returned invalid bytes');
  });

  it.each([0, -1, 65537, 1.5])('rejects invalid byte counts: %s', length => {
    expect(() => secureRandomBytes(length)).toThrow('Invalid random byte count');
    expect(mockGetModule).not.toHaveBeenCalled();
  });
});