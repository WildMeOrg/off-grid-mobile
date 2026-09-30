import { AppState, Platform } from 'react-native';

/**
 * Resolves once an iOS app that is in the background returns to the foreground. Resolves
 * immediately everywhere else, including on Android.
 *
 * A background URLSession transfer that finishes while the phone is locked wakes the app in
 * the background, and whatever was awaiting that transfer carries on. Two things break if the
 * next step runs then:
 * - the Entra tokens are stored WHEN_UNLOCKED, so the Keychain read fails and the next API
 *   call reports "Not signed in";
 * - iOS treats a transfer started from the background as discretionary and may defer it
 *   indefinitely, for example until the phone is charging on Wi-Fi.
 */
export function waitForForeground(): Promise<void> {
  if (Platform.OS !== 'ios' || AppState.currentState !== 'background') {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        subscription.remove();
        resolve();
      }
    });
  });
}
