jest.mock('react-native-fs', () => ({
  mkdir: jest.fn(() => Promise.resolve()),
  unlink: jest.fn(() => Promise.resolve()),
  stat: jest.fn(() => Promise.resolve({ size: 1000 })),
  hash: jest.fn(() => Promise.resolve('a'.repeat(64))),
  moveFile: jest.fn(() => Promise.resolve()),
  downloadFile: jest.fn(),
  stopDownload: jest.fn(),
}));

import RNFS from 'react-native-fs';
import { downloadFileWithIntegrityCheck } from '../../../src/services/fileDownloadService';

const mockDownloadFile = RNFS.downloadFile as jest.Mock;
const mockStopDownload = RNFS.stopDownload as jest.Mock;

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
    const { AppState } = require('react-native');
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
