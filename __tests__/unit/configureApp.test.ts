import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import example from '../../deployment.example.json';

interface DeploymentConfig {
  apiBaseUrl: string;
  projectId: string;
  tenantId: string;
  mobileClientId: string;
  apiClientId: string;
  redirectUrl: string;
}

const { validateConfig, configureApp }: {
  validateConfig: (value: unknown) => DeploymentConfig;
  configureApp: (options: { root: string; env: Record<string, string | undefined> }) => DeploymentConfig;
} = require('../../scripts/configure-app');

describe('deployment configuration', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'elebook-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('accepts the documented public settings and normalizes the API URL', () => {
    expect(validateConfig({ ...example, apiBaseUrl: `${example.apiBaseUrl}/` })).toEqual(example);
  });

  it.each(Object.keys(example))('requires %s rather than choosing a default deployment', field => {
    const incomplete: Record<string, unknown> = { ...example };
    delete incomplete[field];
    expect(() => validateConfig(incomplete)).toThrow('required');
  });

  it.each([null, [], 'example', 42])('rejects a non-object configuration: %s', value => {
    expect(() => validateConfig(value)).toThrow('JSON object');
  });

  it.each([
    'http://api.example.invalid/api',
    'https://user:password@api.example.invalid/api',
    'https://api.example.invalid/api?sig=example',
    'https://api.example.invalid/api#fragment',
    'not-a-url',
  ])('rejects unsafe API URL %s', apiBaseUrl => {
    expect(() => validateConfig({ ...example, apiBaseUrl })).toThrow('HTTPS URL');
  });

  it.each(['tenantId', 'mobileClientId', 'apiClientId'])('validates %s as a public UUID', field => {
    expect(() => validateConfig({ ...example, [field]: 'not-a-guid' })).toThrow('UUID');
  });

  it('rejects a redirect that would not match the native registrations', () => {
    expect(() => validateConfig({ ...example, redirectUrl: 'different.app://oauthredirect' }))
      .toThrow('native redirect');
  });

  it('rejects a path-like project identifier', () => {
    expect(() => validateConfig({ ...example, projectId: '../another-project' })).toThrow('projectId');
  });

  it('rejects extra fields so credentials cannot accidentally enter the bundle', () => {
    expect(() => validateConfig({ ...example, clientSecret: 'do-not-embed' }))
      .toThrow('Unsupported configuration fields');
  });

  it('requires an explicit local file or environment configuration', () => {
    expect(() => configureApp({ root, env: {} })).toThrow('deployment.local.json');
  });

  it('writes validated local settings to the generated module', () => {
    fs.writeFileSync(path.join(root, 'deployment.local.json'), JSON.stringify(example));
    expect(configureApp({ root, env: {} })).toEqual(example);
    const generated = path.join(root, 'src/config/deployment.generated.json');
    expect(JSON.parse(fs.readFileSync(generated, 'utf8'))).toEqual(example);
  });

  it('supports an explicitly selected file for CI without private settings', () => {
    fs.writeFileSync(path.join(root, 'ci.json'), JSON.stringify(example));
    expect(configureApp({ root, env: { ELEBOOK_CONFIG_FILE: 'ci.json' } })).toEqual(example);
  });

  it('supports configuration supplied as JSON by the build environment', () => {
    expect(configureApp({ root, env: { ELEBOOK_CONFIG_JSON: JSON.stringify(example) } }))
      .toEqual(example);
  });

  it('rejects ambiguous environment inputs', () => {
    expect(() => configureApp({
      root,
      env: { ELEBOOK_CONFIG_JSON: JSON.stringify(example), ELEBOOK_CONFIG_FILE: 'ci.json' },
    })).toThrow('one configuration source');
  });

  it('does not echo malformed configuration content in an error', () => {
    expect(() => configureApp({ root, env: { ELEBOOK_CONFIG_JSON: '{ private-value' } }))
      .toThrow('Configuration must be valid JSON');
    try {
      configureApp({ root, env: { ELEBOOK_CONFIG_JSON: '{ private-value' } });
    } catch (error) {
      expect(String(error)).not.toContain('private-value');
    }
  });

  it('removes stale generated output if the selected settings become invalid', () => {
    configureApp({ root, env: { ELEBOOK_CONFIG_JSON: JSON.stringify(example) } });
    expect(() => configureApp({ root, env: {} })).toThrow();
    expect(fs.existsSync(path.join(root, 'src/config/deployment.generated.json'))).toBe(false);
  });

  it('does not rewrite unchanged output on every Metro invocation', () => {
    const options = { root, env: { ELEBOOK_CONFIG_JSON: JSON.stringify(example) } };
    configureApp(options);
    const generated = path.join(root, 'src/config/deployment.generated.json');
    fs.utimesSync(generated, new Date(0), new Date(0));
    configureApp(options);
    expect(fs.statSync(generated).mtimeMs).toBe(0);
  });
});

describe('configureApp redirect normalisation', () => {
  // Entra returns a custom-scheme redirect with a trailing slash appended.
  // AppAuth-iOS compares the callback path against the configured redirect, so
  // storing it without the slash makes iOS reject its own callback and hang.
  // Android matches on scheme alone and is unaffected either way.
  it('stores the redirect exactly as Entra returns it, with the trailing slash', () => {
    const config = validateConfig({ ...example, redirectUrl: 'org.ganesha.elebook://oauthredirect/' });

    expect(config.redirectUrl).toBe('org.ganesha.elebook://oauthredirect/');
  });

  it('normalises the pre-fix spelling so existing configs self-heal', () => {
    const config = validateConfig({ ...example, redirectUrl: 'org.ganesha.elebook://oauthredirect' });

    expect(config.redirectUrl).toBe('org.ganesha.elebook://oauthredirect/');
  });

  it('still rejects a redirect belonging to a different app', () => {
    expect(() => validateConfig({ ...example, redirectUrl: 'different.app://oauthredirect/' }))
      .toThrow(/redirectUrl/);
  });
});
