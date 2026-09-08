jest.mock('node:child_process', () => ({ spawnSync: jest.fn() }));

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const { runAppleCheck }: {
  runAppleCheck: (options: {
    action: string;
    platform?: string;
    root?: string;
    env?: Record<string, string | undefined>;
  }) => number;
} = require('../../scripts/run-apple-check');

const mockSpawnSync = spawnSync as jest.Mock;
const root = path.resolve('mobile app');

beforeEach(() => {
  mockSpawnSync.mockReset().mockReturnValue({ status: 0 });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('Apple native checks', () => {
  it('runs SwiftLint from the repository root', () => {
    expect(runAppleCheck({ action: 'lint', platform: 'darwin', root, env: {} })).toBe(0);
    expect(mockSpawnSync).toHaveBeenCalledWith('swiftlint', ['lint', '--quiet'], {
      cwd: root, stdio: 'inherit', shell: false, env: {},
    });
  });

  it('does not mask SwiftLint failures as a missing installation', () => {
    mockSpawnSync.mockReturnValue({ status: 2 });
    expect(runAppleCheck({ action: 'lint', platform: 'darwin', root })).toBe(2);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('warns when SwiftLint is not installed', () => {
    mockSpawnSync.mockReturnValue({ error: Object.assign(new Error('Missing'), { code: 'ENOENT' }) });
    expect(runAppleCheck({ action: 'lint', platform: 'darwin', root })).toBe(0);
    expect(console.warn).toHaveBeenCalledWith('SwiftLint is not installed; iOS lint was skipped.');
  });

  it('warns when iOS lint is unavailable on the host', () => {
    expect(runAppleCheck({ action: 'lint', platform: 'win32', root })).toBe(0);
    expect(mockSpawnSync).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('requires macOS to execute iOS tests', () => {
    expect(() => runAppleCheck({ action: 'test', platform: 'linux', root })).toThrow('iOS tests require macOS and Xcode.');
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('uses an explicit simulator destination without invoking a shell', () => {
    const env = { IOS_TEST_DESTINATION: 'platform=iOS Simulator,id=fixture-simulator' };
    expect(runAppleCheck({ action: 'test', platform: 'darwin', root, env })).toBe(0);
    expect(mockSpawnSync).toHaveBeenCalledWith('xcodebuild', [
      'test', '-workspace', 'OffgridMobile.xcworkspace', '-scheme', 'OffgridMobile',
      '-destination', env.IOS_TEST_DESTINATION, '-only-testing:OffgridMobileTests',
      'CODE_SIGNING_ALLOWED=NO',
    ], { cwd: path.join(root, 'ios'), stdio: 'inherit', shell: false, env });
  });

  it('preserves failing xcodebuild exit codes', () => {
    mockSpawnSync.mockReturnValue({ status: 65 });
    expect(runAppleCheck({ action: 'test', platform: 'darwin', root })).toBe(65);
  });

  it('fails if xcodebuild cannot start', () => {
    mockSpawnSync.mockReturnValue({ error: new Error('Xcode unavailable') });
    expect(() => runAppleCheck({ action: 'test', platform: 'darwin', root })).toThrow('Xcode unavailable');
  });

  it('treats a terminated native test as failure', () => {
    mockSpawnSync.mockReturnValue({ status: null, signal: 'SIGTERM' });
    expect(runAppleCheck({ action: 'test', platform: 'darwin', root })).toBe(1);
  });

  it('rejects unknown actions before starting a process', () => {
    expect(() => runAppleCheck({ action: 'unknown', platform: 'darwin', root })).toThrow('Choose an Apple check: lint or test.');
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });
});