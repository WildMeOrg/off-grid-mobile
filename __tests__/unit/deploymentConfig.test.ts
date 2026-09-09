import example from '../../deployment.example.json';
import { deploymentConfig, getTokenStorageService } from '../../src/config/deployment';

// Android 7-11 keep each Keystore key in a file named `<uid>_USRPKEY_<alias>`. The keystore daemon
// escapes every UTF-8 byte outside '0'..'~' to two characters: char(0x2b + floor(byte / 64)) followed by
// char(0x30 + byte % 64). Linux caps a filename at 255 bytes, so an alias that embeds long deployment
// fields makes key generation fail with "Keystore operation failed".
function androidKeystoreBlobFileName(alias: string): string {
  let encoded = '';
  for (const byte of Buffer.from(alias, 'utf8')) {
    encoded +=
      byte < 0x30 || byte > 0x7e
        ? String.fromCharCode(0x2b + Math.floor(byte / 64)) + String.fromCharCode(0x30 + (byte % 64))
        : String.fromCharCode(byte);
  }
  return `10067_USRPKEY_${encoded}`;
}

const LONG_DEPLOYMENT = {
  apiBaseUrl: 'https://ganesha-production-function-app-westeurope.azurewebsites.net/api',
  projectId: 'proj_long_running_field_programme',
  tenantId: '77777777-7777-4777-8777-777777777777',
  mobileClientId: '88888888-8888-4888-8888-888888888888',
  apiClientId: '99999999-9999-4999-8999-999999999999',
  redirectUrl: 'org.ganesha.elebook://oauthredirect',
};

describe('deployment token storage', () => {
  it('uses the public test configuration without local deployment settings', () => {
    expect(deploymentConfig).toEqual(example);
  });

  it('does not reuse the legacy shared token service', () => {
    expect(getTokenStorageService(example)).not.toBe('org.ganesha.elebook.entra');
  });

  it('keeps a stable service identifier for the same deployment', () => {
    expect(getTokenStorageService({ ...example })).toBe(getTokenStorageService(example));
  });

  it('derives the documented service name for the example deployment', () => {
    // Pinned on purpose: changing the derivation orphans tokens stored by earlier builds.
    expect(getTokenStorageService(example)).toBe(
      'org.ganesha.elebook.entra.92eda79296364b345b9cb882a37983eb15de4e4ac4d7c6aa511b6d2d5ed543ed',
    );
  });

  it('fits the Android file-based keystore filename limit for long deployment settings', () => {
    const service = getTokenStorageService(LONG_DEPLOYMENT);

    expect(androidKeystoreBlobFileName(service).length).toBeLessThanOrEqual(255);
  });

  it.each([
    ['tenantId', '44444444-4444-4444-8444-444444444444'],
    ['mobileClientId', '55555555-5555-4555-8555-555555555555'],
    ['apiClientId', '66666666-6666-4666-8666-666666666666'],
    ['apiBaseUrl', 'https://another.example.invalid/api'],
    ['projectId', 'another-project'],
    ['redirectUrl', 'another.app://oauthredirect'],
  ])('does not share tokens when %s changes', (field, value) => {
    expect(getTokenStorageService({ ...example, [field]: value }))
      .not.toBe(getTokenStorageService(example));
  });
});