import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { Buffer } from 'buffer';
import { secureRandomBytes } from './secureRandom';

const ITERATIONS = 600000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const MAX_PASSPHRASE_LENGTH = 1024;

interface PassphraseVerifier {
  version: 2;
  algorithm: 'pbkdf2-sha256';
  iterations: number;
  salt: string;
  hash: string;
}

function validPassphrase(passphrase: string): boolean {
  return typeof passphrase === 'string' && passphrase.length > 0 && passphrase.length <= MAX_PASSPHRASE_LENGTH;
}

function parseVerifier(serialized: string): PassphraseVerifier | null {
  if (typeof serialized !== 'string' || serialized.length > 512) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 5 || record.version !== 2
      || record.algorithm !== 'pbkdf2-sha256' || record.iterations !== ITERATIONS
      || typeof record.salt !== 'string' || !/^[a-f0-9]{32}$/.test(record.salt)
      || typeof record.hash !== 'string' || !/^[a-f0-9]{64}$/.test(record.hash)) {
      return null;
    }
    return record as unknown as PassphraseVerifier;
  } catch {
    return null;
  }
}

async function deriveHash(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const passwordBytes = Uint8Array.from(Buffer.from(passphrase, 'utf8'));
  try {
    return await pbkdf2Async(sha256, passwordBytes, salt, { c: ITERATIONS, dkLen: HASH_BYTES });
  } finally {
    passwordBytes.fill(0);
  }
}

export async function createPassphraseVerifier(passphrase: string): Promise<string> {
  if (!validPassphrase(passphrase)) {
    throw new Error('Invalid passphrase length');
  }
  const salt = secureRandomBytes(SALT_BYTES);
  const hash = await deriveHash(passphrase, salt);
  try {
    const record: PassphraseVerifier = {
      version: 2,
      algorithm: 'pbkdf2-sha256',
      iterations: ITERATIONS,
      salt: Buffer.from(salt).toString('hex'),
      hash: Buffer.from(hash).toString('hex'),
    };
    return JSON.stringify(record);
  } finally {
    hash.fill(0);
  }
}

export async function verifyPassphraseVerifier(passphrase: string, serialized: string): Promise<boolean> {
  const record = parseVerifier(serialized);
  if (!record || !validPassphrase(passphrase)) {
    return false;
  }
  const hash = await deriveHash(passphrase, Uint8Array.from(Buffer.from(record.salt, 'hex')));
  const expected = Uint8Array.from(Buffer.from(record.hash, 'hex'));
  try {
    let difference = 0;
    for (let index = 0; index < HASH_BYTES; index += 1) {
      difference += Math.abs(hash[index] - expected[index]);
    }
    return difference === 0;
  } finally {
    hash.fill(0);
    expected.fill(0);
  }
}