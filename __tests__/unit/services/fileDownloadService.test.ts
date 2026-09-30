jest.mock('react-native-fs', () => ({
  mkdir: jest.fn(() => Promise.resolve()),
  unlink: jest.fn(() => Promise.resolve()),
  stat: jest.fn(() => Promise.resolve({ size: 1000 })),
  hash: jest.fn(() => Promise.resolve('a'.repeat(64))),
  moveFile: jest.fn(() => Promise.resolve()),
  downloadFile: jest.fn(),
  stopDownload: jest.fn(),
  resumeDownload: jest.fn(),
  completeHandlerIOS: jest.fn(() => Promise.resolve()),
}));

import { AppState, Platform } from 'react-native';
import type { AppStateStatus } from 'react-native';
import RNFS from 'react-native-fs';
import {
  MAX_IN_PLACE_RESUMES,
  downloadFileWithIntegrityCheck,
} from '../../../src/services/fileDownloadService';

const mockDownloadFile = RNFS.downloadFile as jest.Mock;
const mockStopDownload = RNFS.stopDownload as jest.Mock;
const mockResumeDownload = RNFS.resumeDownload as jest.Mock;
const mockCompleteHandlerIOS = RNFS.completeHandlerIOS as jest.Mock;

// An earlier test restores React Native's AppState mock, which leaves it
// returning undefined under Jest 29; stub it so these tests do not depend on order.
const stubAppStateListeners = () =>
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));

interface CapturedDownloadOptions {
  resumable?: () => void;
}

/** A native transfer that settles only when the test says so, exposing RNFS's callbacks. */
function controllableDownload(jobId: number) {
  const control: {
    options: CapturedDownloadOptions;
    finish: (result: { statusCode: number; bytesWritten: number }) => void;
  } = { options: {}, finish: () => {} };
  mockDownloadFile.mockImplementation((options: CapturedDownloadOptions) => {
    control.options = options;
    return {
      jobId,
      promise: new Promise(resolve => {
        control.finish = resolve;
      }),
    };
  });
  return control;
}

const target = {
  source: {
    url: 'https://example.org/model.onnx',
    expectedSha256: 'a'.repeat(64),
    expectedSizeBytes: 1000,
  },
  stagingPath: '/mock/staging/model.onnx.part',
  finalPath: '/mock/models/model.onnx',
};

describe('fileDownloadService inactivity timeout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stops and reports a download that receives no data before the deadline', async () => {
    mockDownloadFile.mockReturnValue({
      jobId: 42,
      promise: new Promise(() => {}),
    });

    const pending = downloadFileWithIntegrityCheck(target, {
      maxAttempts: 1,
      inactivityTimeoutMs: 1000,
    });
    await jest.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'timeout',
      message: 'download received no data for 1s',
    });
    expect(mockStopDownload).toHaveBeenCalledWith(42);
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        progressInterval: 1000,
        readTimeout: 1000,
      }),
    );
  });

  it('resets the deadline when download progress arrives', async () => {
    let reportProgress: (() => void) | undefined;
    let resolveDownload:
      | ((result: { statusCode: number; bytesWritten: number }) => void)
      | undefined;
    mockDownloadFile.mockImplementation(
      (options: {
        progress?: (result: {
          bytesWritten: number;
          contentLength: number;
        }) => void;
      }) => {
        reportProgress = () =>
          options.progress?.({ bytesWritten: 500, contentLength: 1000 });
        return {
          jobId: 42,
          promise: new Promise(resolve => {
            resolveDownload = resolve;
          }),
        };
      },
    );

    const pending = downloadFileWithIntegrityCheck(target, {
      maxAttempts: 1,
      inactivityTimeoutMs: 1000,
    });
    await jest.advanceTimersByTimeAsync(750);
    reportProgress?.();
    await jest.advanceTimersByTimeAsync(750);
    expect(mockStopDownload).not.toHaveBeenCalled();

    resolveDownload?.({ statusCode: 200, bytesWritten: 1000 });
    await expect(pending).resolves.toMatchObject({ ok: true });
  });
});

describe('background transfer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // A foreground URLSession stops when iOS suspends the app, so locking the
  // screen part-way through an 80MB model killed the transfer. Upstream had
  // already removed the foreground path ("use background downloads
  // exclusively"); this service was rewritten without the flag while
  // AppDelegate kept servicing handleEventsForBackgroundURLSession.
  it('asks for a background session so a locked screen does not kill the transfer', async () => {
    mockDownloadFile.mockReturnValue({
      jobId: 1,
      promise: Promise.resolve({ statusCode: 200, bytesWritten: 1000 }),
    });

    await downloadFileWithIntegrityCheck(target);

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ background: true }),
    );
  });

  it('re-arms the inactivity deadline when the app returns to the foreground', async () => {
    const addEventListener = jest.spyOn(AppState, 'addEventListener');
    mockDownloadFile.mockReturnValue({
      jobId: 1,
      promise: Promise.resolve({ statusCode: 200, bytesWritten: 1000 }),
    });

    await downloadFileWithIntegrityCheck(target);

    // Suspended JS timers fire late on wake; without this the watchdog would
    // trip against a transfer that progressed fine while backgrounded.
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    addEventListener.mockRestore();
  });
});

// RNFS on iOS neither resolves nor rejects a transfer that stopped with resume
// data -- it only calls `resumable`. Azure Blob always allows resuming, so any
// interruption used to leave the Packs screen spinning forever.
describe('interrupted iOS transfers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    stubAppStateListeners();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resumes an interrupted transfer in place and completes it', async () => {
    const download = controllableDownload(7);

    const pending = downloadFileWithIntegrityCheck(target, { maxAttempts: 1 });
    await jest.advanceTimersByTimeAsync(0);
    download.options.resumable?.();
    await jest.advanceTimersByTimeAsync(0);

    expect(mockResumeDownload).toHaveBeenCalledWith(7);
    download.finish({ statusCode: 200, bytesWritten: 1000 });
    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(mockDownloadFile).toHaveBeenCalledTimes(1);
  });

  it(`fails instead of hanging after ${MAX_IN_PLACE_RESUMES} resumes`, async () => {
    const download = controllableDownload(7);

    const pending = downloadFileWithIntegrityCheck(target, { maxAttempts: 1 });
    await jest.advanceTimersByTimeAsync(0);
    for (let interruption = 0; interruption <= MAX_IN_PLACE_RESUMES; interruption++) {
      download.options.resumable?.();
      await jest.advanceTimersByTimeAsync(0);
    }

    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'network-error',
      message: `download interrupted ${MAX_IN_PLACE_RESUMES + 1} times`,
    });
    expect(mockResumeDownload).toHaveBeenCalledTimes(MAX_IN_PLACE_RESUMES);
  });

  it('does not resume a transfer that was deliberately stopped', async () => {
    const download = controllableDownload(7);
    const controller = new AbortController();

    const pending = downloadFileWithIntegrityCheck(target, {
      maxAttempts: 1,
      signal: controller.signal,
    });
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();
    // iOS reports the stop itself as resumable.
    download.options.resumable?.();

    await expect(pending).resolves.toMatchObject({ ok: false, code: 'cancelled' });
    expect(mockStopDownload).toHaveBeenCalledWith(7);
    expect(mockResumeDownload).not.toHaveBeenCalled();
  });

  it('reports completion before hashing so the screen can show verification', async () => {
    mockDownloadFile.mockReturnValue({
      jobId: 1,
      promise: Promise.resolve({ statusCode: 200, bytesWritten: 1000 }),
    });
    const onProgress = jest.fn();

    await downloadFileWithIntegrityCheck(target, { onProgress });

    expect(onProgress).toHaveBeenLastCalledWith(1000, 1000);
  });
});

describe('iOS app lifecycle', () => {
  const appState = AppState as unknown as { currentState: unknown };
  const originalAppState = appState.currentState;
  const originalPlatformOs = Object.getOwnPropertyDescriptor(Platform, 'OS');

  beforeEach(() => {
    jest.clearAllMocks();
    stubAppStateListeners();
  });

  afterEach(() => {
    appState.currentState = originalAppState;
    if (originalPlatformOs) {
      Object.defineProperty(Platform, 'OS', originalPlatformOs);
    }
    jest.restoreAllMocks();
  });

  it('hands iOS its background-session completion handler back after a transfer', async () => {
    mockDownloadFile.mockReturnValue({
      jobId: 9,
      promise: Promise.resolve({ statusCode: 200, bytesWritten: 1000 }),
    });

    await downloadFileWithIntegrityCheck(target);
    await Promise.resolve();

    expect(mockCompleteHandlerIOS).toHaveBeenCalledWith(9);
  });

  it('does not call the iOS-only completion handler on Android', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    mockDownloadFile.mockReturnValue({
      jobId: 9,
      promise: Promise.resolve({ statusCode: 200, bytesWritten: 1000 }),
    });

    await downloadFileWithIntegrityCheck(target);
    await Promise.resolve();

    expect(mockCompleteHandlerIOS).not.toHaveBeenCalled();
  });

  it('starts a transfer only once a backgrounded iOS app is back in the foreground', async () => {
    const listeners: Array<(state: AppStateStatus) => void> = [];
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener: (state: AppStateStatus) => void) => {
        listeners.push(listener);
        return { remove: jest.fn() };
      });
    appState.currentState = 'background';
    mockDownloadFile.mockReturnValue({
      jobId: 3,
      promise: Promise.resolve({ statusCode: 200, bytesWritten: 1000 }),
    });

    const pending = downloadFileWithIntegrityCheck(target, { maxAttempts: 1 });
    await new Promise(resolve => setImmediate(resolve));
    expect(mockDownloadFile).not.toHaveBeenCalled();

    appState.currentState = 'active';
    listeners.forEach(listener => listener('active'));

    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(mockDownloadFile).toHaveBeenCalledTimes(1);
  });
});
