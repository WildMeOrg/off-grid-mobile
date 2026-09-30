import { AppState, Platform } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { waitForForeground } from '../../../src/utils/appForeground';

const appState = AppState as unknown as { currentState: unknown };
const originalAppState = appState.currentState;
const originalPlatformOs = Object.getOwnPropertyDescriptor(Platform, 'OS');

const settled = async (promise: Promise<void>): Promise<boolean> => {
  let done = false;
  promise.then(() => {
    done = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  return done;
};

describe('waitForForeground', () => {
  afterEach(() => {
    appState.currentState = originalAppState;
    if (originalPlatformOs) {
      Object.defineProperty(Platform, 'OS', originalPlatformOs);
    }
    jest.restoreAllMocks();
  });

  it('resolves immediately when the app is already active', async () => {
    appState.currentState = 'active';

    await expect(settled(waitForForeground())).resolves.toBe(true);
  });

  it('waits on iOS until a backgrounded app becomes active, then stops listening', async () => {
    const remove = jest.fn();
    let listener: ((state: AppStateStatus) => void) | undefined;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, handler: (state: AppStateStatus) => void) => {
        listener = handler;
        return { remove };
      });
    appState.currentState = 'background';

    const waiting = waitForForeground();
    await expect(settled(waiting)).resolves.toBe(false);

    listener?.('inactive');
    await expect(settled(waiting)).resolves.toBe(false);

    listener?.('active');
    await expect(settled(waiting)).resolves.toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('never waits on Android, where downloads are not suspended with the app', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    appState.currentState = 'background';

    await expect(settled(waitForForeground())).resolves.toBe(true);
  });
});
