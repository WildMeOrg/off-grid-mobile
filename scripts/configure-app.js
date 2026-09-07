const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FIELDS = [
  'apiBaseUrl',
  'projectId',
  'tenantId',
  'mobileClientId',
  'apiClientId',
  'redirectUrl',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NATIVE_REDIRECT = 'org.ganesha.elebook://oauthredirect';

function validateApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('apiBaseUrl must be an HTTPS URL without credentials, query, or fragment.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('apiBaseUrl must be an HTTPS URL without credentials, query, or fragment.');
  }
  return url.toString().replace(/\/+$/, '');
}

function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Configuration must be a JSON object.');
  }
  if (Object.keys(value).some(field => !CONFIG_FIELDS.includes(field))) {
    throw new Error('Unsupported configuration fields. Only public deployment settings are allowed.');
  }
  const config = {};
  for (const field of CONFIG_FIELDS) {
    if (typeof value[field] !== 'string' || !value[field].trim()) {
      throw new Error(`${field} is required and must be a non-empty string.`);
    }
    config[field] = value[field].trim();
  }
  config.apiBaseUrl = validateApiUrl(config.apiBaseUrl);
  for (const field of ['tenantId', 'mobileClientId', 'apiClientId']) {
    if (!UUID.test(config[field])) {
      throw new Error(`${field} must be a UUID.`);
    }
    config[field] = config[field].toLowerCase();
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(config.projectId)) {
    throw new Error('projectId must contain only letters, digits, underscores, and hyphens.');
  }
  if (config.redirectUrl !== NATIVE_REDIRECT) {
    throw new Error('redirectUrl must match the native redirect registered by this app.');
  }
  return config;
}

function readConfig(root, env) {
  if (env.ELEBOOK_CONFIG_JSON !== undefined && env.ELEBOOK_CONFIG_FILE !== undefined) {
    throw new Error('Choose one configuration source: ELEBOOK_CONFIG_JSON or ELEBOOK_CONFIG_FILE.');
  }
  let content = env.ELEBOOK_CONFIG_JSON;
  if (content === undefined) {
    const filename = path.resolve(root, env.ELEBOOK_CONFIG_FILE || 'deployment.local.json');
    if (!fs.existsSync(filename)) {
      throw new Error('Missing app configuration. Create deployment.local.json or set ELEBOOK_CONFIG_FILE or ELEBOOK_CONFIG_JSON.');
    }
    try {
      content = fs.readFileSync(filename, 'utf8');
    } catch {
      throw new Error('Unable to read the selected app configuration file.');
    }
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('Configuration must be valid JSON.');
  }
}

function configureApp({ root = path.resolve(__dirname, '..'), env = process.env } = {}) {
  const output = path.join(root, 'src/config/deployment.generated.json');
  try {
    const config = validateConfig(readConfig(root, env));
    const content = `${JSON.stringify(config, null, 2)}\n`;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== content) {
      fs.writeFileSync(output, content, 'utf8');
    }
    return config;
  } catch (error) {
    fs.rmSync(output, { force: true });
    throw error;
  }
}

module.exports = { configureApp, validateConfig };

if (require.main === module) {
  try {
    configureApp();
    process.stdout.write('App configuration validated and generated.\n');
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'App configuration failed.'}\n`);
    process.exitCode = 1;
  }
}