const { spawnSync } = require('node:child_process');
const path = require('node:path');

const TASKS = {
  compile: ':app:compileDebugKotlin',
  lint: ':app:lintDebug',
  test: ':app:testDebugUnitTest',
};

function runGradle({ action, platform = process.platform, root = path.resolve(__dirname, '..') }) {
  if (!Object.hasOwn(TASKS, action)) {
    throw new Error('Choose a Gradle action: compile, lint, or test.');
  }
  const result = spawnSync(platform === 'win32' ? 'gradlew.bat' : './gradlew', [TASKS[action]], {
    cwd: path.join(root, 'android'),
    shell: platform === 'win32',
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

module.exports = { runGradle };

if (require.main === module) {
  try {
    process.exitCode = runGradle({ action: process.argv[2] });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}