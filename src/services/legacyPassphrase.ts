function legacyHash(value: string): string {
  const state = new Int32Array(1);
  for (let index = 0; index < value.length; index += 1) {
    state[0] = Math.imul(state[0], 31) + value.charCodeAt(index);
  }
  return Math.abs(state[0]).toString(16);
}

export function matchesLegacyPassphrase(passphrase: string, stored: string): boolean {
  if (typeof passphrase !== 'string' || !passphrase || passphrase.length > 1024
    || typeof stored !== 'string' || !/^[a-f0-9]{1,16}$/.test(stored)) {
    return false;
  }
  let candidate = legacyHash(passphrase);
  for (let round = 0; round < 1000; round += 1) {
    candidate = legacyHash(candidate) + candidate.slice(0, 8);
  }
  return candidate === stored;
}