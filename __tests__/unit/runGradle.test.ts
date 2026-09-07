jest.mock('node:child_process', () => ({ spawnSync: jest.fn() }));

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const { runGradle }: {
  runGradle: (options: { action: string; platform?: string; root?: string }) => number;
} = require('../../scripts/run-gradle');

const mockSpawnSync = spawnSync as jest.Mock;
const root = path.resolve('mobile app');

beforeEach(() => {
  mockSpawnSync.mockReset().mockReturnValue({ status: 0 });
});

describe('Gradle launcher', () => {
  it('uses the batch wrapper on Windows from the Android directory', () => {
    expect(runGradle({ action: 'test', platform: 'win32', root })).toBe(0);
    expect(mockSpawnSync).toHaveBeenCalledWith('gradlew.bat', [':app:testDebugUnitTest'], {
      cwd: path.join(root, 'android'),
      shell: true,
      stdio: 'inherit',
    });
  });

  it.each(['darwin', 'linux'])('uses the executable wrapper on %s', platform => {
    expect(runGradle({ action: 'lint', platform, root })).toBe(0);
    expect(mockSpawnSync).toHaveBeenCalledWith('./gradlew', [':app:lintDebug'], {
      cwd: path.join(root, 'android'),
      shell: false,
      stdio: 'inherit',
    });
  });

  it('supports the Kotlin compilation gate', () => {
    runGradle({ action: 'compile', platform: 'linux', root });
    expect(mockSpawnSync).toHaveBeenCalledWith('./gradlew', [':app:compileDebugKotlin'], expect.anything());
  });

  it.each(['unknown', 'test & echo unexpected', '__proto__', 'constructor'])('rejects unsupported action %s', action => {
    expect(() => runGradle({ action, root })).toThrow('Choose a Gradle action: compile, lint, or test.');
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('preserves a failing Gradle exit code', () => {
    mockSpawnSync.mockReturnValue({ status: 3 });
    expect(runGradle({ action: 'test', root })).toBe(3);
  });

  it('treats a terminated process as failure', () => {
    mockSpawnSync.mockReturnValue({ status: null, signal: 'SIGTERM' });
    expect(runGradle({ action: 'test', root })).toBe(1);
  });

  it('reports failure to start the wrapper', () => {
    mockSpawnSync.mockReturnValue({ error: new Error('Wrapper unavailable') });
    expect(() => runGradle({ action: 'test', root })).toThrow('Wrapper unavailable');
  });
});