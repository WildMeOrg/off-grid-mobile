/**
 * WildMe - Wildlife Re-identification App
 * On-device species detection and individual matching
 */

import 'react-native-gesture-handler';
import React, { useEffect, useState, useCallback } from 'react';
import { StatusBar, ActivityIndicator, View, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { AppNavigator } from './src/navigation';
import { useTheme } from './src/theme';
import {
  hardwareService,
  authService,
  packManager,
  reconcileMiewidModel,
} from './src/services';
import { runGoldenBatchIfRequested } from './src/services/goldenBatchEvaluator';
import { initDatabase } from './src/services/database';
import logger from './src/utils/logger';
import { useAppStore, useAuthStore, useWildlifeStore, hydrateObservationsFromDb } from './src/stores';
import { LockScreen } from './src/screens';
import { useAppState } from './src/hooks/useAppState';
import { LogBox } from 'react-native';

LogBox.ignoreAllLogs(); // Suppress all logs

const ensureAppStoreHydrated = async () => {
  const storeWithPersist = useAppStore as typeof useAppStore & {
    persist?: {
      hasHydrated?: () => boolean;
      rehydrate?: () => Promise<void>;
    };
  };
  const persistApi = storeWithPersist.persist;
  if (!persistApi?.hasHydrated || !persistApi.rehydrate) return;
  if (!persistApi.hasHydrated()) {
    await persistApi.rehydrate();
  }
};

const ensureWildlifeStoreHydrated = async () => {
  const storeWithPersist = useWildlifeStore as typeof useWildlifeStore & {
    persist?: {
      hasHydrated?: () => boolean;
      rehydrate?: () => Promise<void>;
    };
  };
  const persistApi = storeWithPersist.persist;
  if (!persistApi?.hasHydrated || !persistApi.rehydrate) return;
  if (!persistApi.hasHydrated()) {
    await persistApi.rehydrate();
  }
};

function App() {
  const [isInitializing, setIsInitializing] = useState(true);
  const setDeviceInfo = useAppStore((s) => s.setDeviceInfo);

  const { colors, isDark } = useTheme();

  const {
    isEnabled: authEnabled,
    isLocked,
    setLocked,
    setLastBackgroundTime,
  } = useAuthStore();

  // Handle app state changes for auto-lock
  useAppState({
    onBackground: useCallback(() => {
      if (authEnabled) {
        setLastBackgroundTime(Date.now());
        setLocked(true);
      }
    }, [authEnabled, setLastBackgroundTime, setLocked]),
    onForeground: useCallback(() => {
      // Lock is already set when going to background
      // Nothing additional needed here
    }, []),
  });

  useEffect(() => {
    initializeApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initializeApp = async () => {
    try {
      // Ensure persisted stores are hydrated before use
      await ensureAppStoreHydrated();
      await ensureWildlifeStoreHydrated();

      // Open (and migrate, if needed) the local SQLite database, then load
      // observations/sync queue into the store -- must happen before any
      // screen that reads useWildlifeStore().observations renders.
      try {
        await initDatabase();
        await hydrateObservationsFromDb();
        logger.log('[App] Database initialized and observations hydrated');
      } catch (err) {
        logger.error('[App] Failed to initialize database:', err);
      }

      // Initialize pack manager (creates packs directory if needed)
      try {
        await packManager.initialize();
        logger.log('[App] Pack manager initialized');
      } catch (err) {
        logger.error('[App] Failed to initialize pack manager:', err);
      }

      // Reconcile the persisted MiewID model record against the filesystem —
      // the store may confidently claim a model that was evicted, truncated,
      // or never finished downloading.
      try {
        const { miewidModel, setMiewidModel } = useWildlifeStore.getState();
        const reconciled = await reconcileMiewidModel(miewidModel);
        setMiewidModel(reconciled);
        logger.log(
          `[App] MiewID model reconciled: ${reconciled ? reconciled.status : 'none'}`,
        );
      } catch (err) {
        logger.error('[App] Failed to reconcile MiewID model:', err);
      }

      // Re-validate persisted packs against their on-disk files; packs that
      // fail integrity checks are quarantined rather than silently matched.
      try {
        const { packs, setPacks } = useWildlifeStore.getState();
        if (packs.length > 0) {
          const reconciled = await packManager.reconcilePacks(packs);
          setPacks(reconciled);
          const quarantined = reconciled.filter(
            (p) => p.status === 'quarantined',
          ).length;
          logger.log(
            `[App] Packs reconciled: ${reconciled.length} total, ${quarantined} quarantined`,
          );
        }
      } catch (err) {
        logger.error('[App] Failed to reconcile packs:', err);
      }

      // Initialize hardware detection
      const deviceInfo = await hardwareService.getDeviceInfo();
      setDeviceInfo(deviceInfo);

      // Check if passphrase is set and lock app if needed
      const hasPassphrase = await authService.hasPassphrase();
      if (hasPassphrase && authEnabled) {
        setLocked(true);
      }

      // Show the UI
      setIsInitializing(false);

      // DEBUG-ONLY, no-UI golden batch evaluator: runs the production
      // wildlifePipeline against a manifest of staged reference images when
      // (and only when) an orchestration script has dropped a one-shot
      // request at batch/request.json. Explicitly gated on `__DEV__` here in
      // addition to the evaluator's own internal guard -- a release build
      // must never execute this path. Fired after the UI is already shown
      // (not awaited) so a long-running batch never delays app startup;
      // any failure is caught internally and logged, never thrown.
      if (__DEV__) {
        runGoldenBatchIfRequested();
      }
    } catch (error) {
      logger.error('[App] Error initializing app:', error);
      setIsInitializing(false);
    }
  };

  const handleUnlock = useCallback(() => {
    setLocked(false);
  }, [setLocked]);

  if (isInitializing) {
    return (
      <GestureHandlerRootView style={styles.flex}>
        <SafeAreaProvider>
          <View style={[styles.loadingContainer, { backgroundColor: colors.background }]} testID="app-loading">
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // Show lock screen if auth is enabled and app is locked
  if (authEnabled && isLocked) {
    return (
      <GestureHandlerRootView style={styles.flex} testID="app-locked">
        <SafeAreaProvider>
          <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
          <LockScreen onUnlock={handleUnlock} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
        <NavigationContainer
          theme={{
            dark: isDark,
            colors: {
              primary: colors.primary,
              background: colors.background,
              card: colors.surface,
              text: colors.text,
              border: colors.border,
              notification: colors.primary,
            },
            fonts: {
              regular: {
                fontFamily: 'System',
                fontWeight: '400',
              },
              medium: {
                fontFamily: 'System',
                fontWeight: '500',
              },
              bold: {
                fontFamily: 'System',
                fontWeight: '700',
              },
              heavy: {
                fontFamily: 'System',
                fontWeight: '900',
              },
            },
          }}
        >
          <AppNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default App;
