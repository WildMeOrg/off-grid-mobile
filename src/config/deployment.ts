import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import generated from './deployment.generated.json';

interface DeploymentConfiguration {
  apiBaseUrl: string;
  projectId: string;
  tenantId: string;
  mobileClientId: string;
  apiClientId: string;
  redirectUrl: string;
}

export const deploymentConfig: Readonly<DeploymentConfiguration> = Object.freeze(generated);

/**
 * Keychain/Keystore service name for one deployment's Entra tokens.
 *
 * The six public deployment fields are digested rather than embedded. Android 7-11 store each
 * Keystore key in a file named after the alias, escaping most punctuation to two characters, and
 * Linux caps a filename at 255 bytes. A raw key for a real deployment exceeds that limit, so every
 * setGenericPassword fails with "Keystore operation failed" and sign-in never completes on those
 * devices. SHA-256 keeps the alias at 90 characters while still isolating tokens per deployment.
 */
export function getTokenStorageService(config: Readonly<DeploymentConfiguration>): string {
  const deploymentKey = [
    config.apiBaseUrl,
    config.projectId,
    config.tenantId,
    config.mobileClientId,
    config.apiClientId,
    config.redirectUrl,
  ].map(encodeURIComponent).join('|');
  return `org.ganesha.elebook.entra.${bytesToHex(sha256(utf8ToBytes(deploymentKey)))}`;
}