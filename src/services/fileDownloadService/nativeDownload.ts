import { AppState, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { waitForForeground } from '../../utils/appForeground';
import type {
  DownloadErrorCode,
  DownloadOptions,
  DownloadOutcome,
  DownloadSource,
} from './types';

export const DEFAULT_DOWNLOAD_INACTIVITY_TIMEOUT_MS = 60_000;

/**
 * In-place resumes one attempt may make before it fails and hands back to the retry loop,
 * which starts the next attempt from byte zero.
 */
export const MAX_IN_PLACE_RESUMES = 5;

export const failure = (
  code: DownloadErrorCode,
  message: string,
  httpStatus?: number,
): DownloadOutcome => ({ ok: false, code, message, httpStatus });

interface DownloadInactivityWatchdog {
  promise: Promise<never>;
  reset: () => void;
  didTimeout: () => boolean;
  clear: () => void;
}

function createDownloadInactivityWatchdog(
  timeoutMs: number,
  onTimeout: () => void,
): DownloadInactivityWatchdog {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let rejectTimeout: (error: Error) => void = () => {};
  const promise = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      onTimeout();
      rejectTimeout(
        new Error(`download received no data for ${timeoutMs / 1000}s`),
      );
    }, timeoutMs);
  };
  return {
    promise,
    reset,
    didTimeout: () => timedOut,
    clear: () => clearTimeout(timer),
  };
}

function createInterruption(): {
  promise: Promise<never>;
  fail: (error: Error) => void;
} {
  let fail: (error: Error) => void = () => {};
  const promise = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  return { promise, fail };
}

function downloadFailure(
  error: unknown,
  signal: AbortSignal | undefined,
  timedOut: boolean,
): DownloadOutcome {
  if (signal?.aborted) {
    return failure('cancelled', 'download cancelled');
  }
  const message = error instanceof Error ? error.message : String(error);
  return failure(timedOut ? 'timeout' : 'network-error', message);
}

export type NativeTransfer =
  | {
      ok: true;
      jobId: number;
      statusCode: number;
      contentLengthFromServer: number;
    }
  | { ok: false; jobId: number; failure: DownloadOutcome };

/**
 * Runs one RNFS transfer to `toFile` and always settles, which RNFS itself does not.
 *
 * On iOS, when a transfer stops and the server supports resuming it, RNFS neither resolves nor
 * rejects: it only calls the optional `resumable` callback. Azure Blob always supports resuming
 * (ETag plus byte ranges), so without that callback any dropped connection, request timeout or
 * stopDownload left the promise pending forever, and the person saw a spinner that never ended.
 * The transfer is now resumed from where it stopped, and fails after MAX_IN_PLACE_RESUMES.
 */
export async function runNativeDownload(
  source: DownloadSource,
  toFile: string,
  opts: DownloadOptions,
): Promise<NativeTransfer> {
  const inactivityTimeoutMs =
    opts.inactivityTimeoutMs ?? DEFAULT_DOWNLOAD_INACTIVITY_TIMEOUT_MS;
  let jobId = -1;
  let contentLengthFromServer = 0;
  let stopRequested = false;
  let settled = false;
  let resumes = 0;
  const stopDownload = () => {
    stopRequested = true;
    if (jobId >= 0) {
      RNFS.stopDownload(jobId);
    }
  };
  const watchdog = createDownloadInactivityWatchdog(
    inactivityTimeoutMs,
    stopDownload,
  );
  const interruption = createInterruption();
  const resumeInPlace = () => {
    if (settled) {
      return;
    }
    if (stopRequested || resumes >= MAX_IN_PLACE_RESUMES) {
      interruption.fail(
        new Error(
          stopRequested
            ? 'download stopped'
            : `download interrupted ${resumes + 1} times`,
        ),
      );
      return;
    }
    resumes += 1;
    waitForForeground()
      .then(() => {
        if (!settled && !stopRequested) {
          watchdog.reset();
          RNFS.resumeDownload(jobId);
        }
      })
      .catch((error: unknown) =>
        interruption.fail(error instanceof Error ? error : new Error(String(error))),
      );
  };
  const download = RNFS.downloadFile({
    fromUrl: source.url,
    toFile,
    headers: source.headers,
    progressInterval: 1000,
    // A foreground session stops the moment iOS suspends the app, so the screen
    // locking part-way through an 80MB model was enough to kill the transfer --
    // no data would arrive, and the watchdog below would correctly but uselessly
    // report a stall. Upstream removed the foreground path for this reason
    // ("use background downloads exclusively"); the rewrite of this service lost
    // the flag while AppDelegate kept handling
    // handleEventsForBackgroundURLSession for a session nothing was asking for.
    // Ignored on Android, which has its own long-running download path.
    background: true,
    begin: (res: { contentLength: number }) => {
      contentLengthFromServer = res.contentLength;
      watchdog.reset();
    },
    progress: (res: { bytesWritten: number; contentLength: number }) => {
      watchdog.reset();
      opts.onProgress?.(res.bytesWritten, res.contentLength);
    },
    resumable: resumeInPlace,
    readTimeout: inactivityTimeoutMs,
  });
  jobId = download.jobId;
  watchdog.reset();

  // JS timers do not run while iOS has the app suspended, so a watchdog armed
  // before suspension fires the instant the app wakes -- against a background
  // transfer that may have been progressing the whole time. Re-arm on wake and
  // judge inactivity from then, not from whenever the app went away.
  const appStateSubscription = AppState.addEventListener('change', nextState => {
    if (nextState === 'active') {
      watchdog.reset();
    }
  });

  if (opts.signal?.aborted) {
    // The signal aborted before we could listen — an aborted signal never
    // fires 'abort' again, so stop the job directly.
    stopDownload();
  } else {
    opts.signal?.addEventListener('abort', stopDownload, { once: true });
  }

  try {
    const result = await Promise.race([
      download.promise,
      watchdog.promise,
      interruption.promise,
    ]);
    return {
      ok: true,
      jobId,
      statusCode: result.statusCode,
      contentLengthFromServer,
    };
  } catch (error) {
    return {
      ok: false,
      jobId,
      failure: downloadFailure(error, opts.signal, watchdog.didTimeout()),
    };
  } finally {
    settled = true;
    watchdog.clear();
    appStateSubscription.remove();
    opts.signal?.removeEventListener('abort', stopDownload);
  }
}

/**
 * When a background transfer finishes while the app is suspended, AppDelegate hands iOS's
 * completion handler to RNFS. iOS expects it back once the app has processed the result, and
 * deprioritises background wakes for apps that never return it. Does nothing when no handler
 * is pending, which is the case for a transfer that finished in the foreground.
 */
export function finishBackgroundEvents(jobId: number): void {
  if (Platform.OS !== 'ios' || jobId < 0) {
    return;
  }
  Promise.resolve()
    .then(() => RNFS.completeHandlerIOS(jobId))
    .catch(() => {});
}
