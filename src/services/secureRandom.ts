import { Buffer } from 'buffer';
import { TurboModuleRegistry } from 'react-native';
import type { TurboModule } from 'react-native';

interface NativeRandomModule extends TurboModule {
  getRandomBase64(length: number): string;
}

export function secureRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 1 || length > 65536) {
    throw new Error('Invalid random byte count');
  }
  const nativeRandom = TurboModuleRegistry.getEnforcing<NativeRandomModule>('RNGetRandomValues');
  const encoded = nativeRandom.getRandomBase64(length);
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length !== length || decoded.toString('base64') !== encoded) {
    throw new Error('Native RNG returned invalid bytes');
  }
  return Uint8Array.from(decoded);
}