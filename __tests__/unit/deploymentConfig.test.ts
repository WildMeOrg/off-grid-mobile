import example from '../../deployment.example.json';
import { deploymentConfig, getTokenStorageService } from '../../src/config/deployment';

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