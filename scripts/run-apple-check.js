const { spawnSync } = require('node:child_process');
const path = require('node:path');

function runAppleCheck({ action, platform = process.platform, root = path.resolve(__dirname, '..'), env = process.env }) {
  if (action !== 'lint' && action !== 'test') {
    throw new Error('Choose an Apple check: lint or test.');
  }
  if (platform !== 'darwin') {
    if (action === 'test') {
      throw new Error('iOS tests require macOS and Xcode.');
    }
    console.warn('iOS lint requires macOS; it was skipped on this host.');
    return 0;
  }
  const isTest = action === 'test';
  const args = isTest ? [
    'test', '-workspace', 'OffgridMobile.xcworkspace', '-scheme', 'OffgridMobile',
    '-destination', env.IOS_TEST_DESTINATION || 'platform=iOS Simulator,name=iPhone 16e',
    '-only-testing:OffgridMobileTests', 'CODE_SIGNING_ALLOWED=NO',
  ] : ['lint', '--quiet'];
  const result = spawnSync(isTest ? 'xcodebuild' : 'swiftlint', args, {
    cwd: isTest ? path.join(root, 'ios') : root,
    stdio: 'inherit',
    shell: false,
    env,
  });
  if (result.error) {
    if (!isTest && result.error.code === 'ENOENT') {
      console.warn('SwiftLint is not installed; iOS lint was skipped.');
      return 0;
    }
    throw result.error;
  }
  return result.status ?? 1;
}

module.exports = { runAppleCheck };

if (require.main === module) {
  try {
    process.exitCode = runAppleCheck({ action: process.argv[2] });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}