/**
 * Jest Setup File
 *
 * Configures global mocks and test utilities for the Off Grid test suite.
 * This file runs after the test framework is installed in the environment.
 */

// Import extended matchers - path varies by version
// v12.4+ has built-in matchers, earlier versions use separate import
try {
  require('@testing-library/react-native/extend-expect');
} catch {
  // Built-in matchers in v12.4+, or no matchers needed for basic tests
}

// ============================================================================
// AsyncStorage Mock
// ============================================================================
const mockStorage: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn((key: string, value: string) => {
    mockStorage[key] = value;
    return Promise.resolve();
  }),
  getItem: jest.fn((key: string) => {
    return Promise.resolve(mockStorage[key] || null);
  }),
  removeItem: jest.fn((key: string) => {
    delete mockStorage[key];
    return Promise.resolve();
  }),
  multiSet: jest.fn((pairs: [string, string][]) => {
    pairs.forEach(([key, value]) => {
      mockStorage[key] = value;
    });
    return Promise.resolve();
  }),
  multiGet: jest.fn((keys: string[]) => {
    return Promise.resolve(keys.map(key => [key, mockStorage[key] || null]));
  }),
  multiRemove: jest.fn((keys: string[]) => {
    keys.forEach(key => delete mockStorage[key]);
    return Promise.resolve();
  }),
  clear: jest.fn(() => {
    Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
    return Promise.resolve();
  }),
  getAllKeys: jest.fn(() => {
    return Promise.resolve(Object.keys(mockStorage));
  }),
}));

// Helper to clear storage between tests
export const clearMockStorage = () => {
  Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
};

// ============================================================================
// @op-engineering/op-sqlite Mock
//
// A minimal in-memory SQL simulator scoped exactly to the statements
// src/services/database/*.ts issues (plain INSERT/SELECT/UPDATE/DELETE, a
// handful of PRAGMAs). It is NOT a general SQL engine -- it exists so unit
// tests can exercise real insert/query/update round-trips through the
// repository layer without a native binding. Real correctness against actual
// SQLite still needs verification on-device before shipping.
// ============================================================================
type MockSqlRow = Record<string, unknown>;
const mockSqlTables: Record<string, MockSqlRow[]> = {
  observations: [],
  detections: [],
  sync_queue: [],
};
let mockSqliteUserVersion = 0;

export const resetMockSqlite = () => {
  mockSqlTables.observations = [];
  mockSqlTables.detections = [];
  mockSqlTables.sync_queue = [];
  mockSqliteUserVersion = 0;
};

function mockSqlTableName(sql: string, afterKeyword: string): string {
  const match = sql.match(new RegExp(`${afterKeyword}\\s+(?:OR REPLACE\\s+)?(?:INTO\\s+)?(\\w+)`, 'i'));
  return match ? match[1] : '';
}

function mockSqlInsertColumns(sql: string): string[] {
  const match = sql.match(/\(([^)]+)\)\s*VALUES/i);
  return match ? match[1].split(',').map((c) => c.trim()) : [];
}

function mockSqlInsert(sql: string, params: unknown[]): { rows: MockSqlRow[]; rowsAffected: number } {
  const table = mockSqlTableName(sql, 'INSERT');
  const columns = mockSqlInsertColumns(sql);
  const row: MockSqlRow = {};
  columns.forEach((col, i) => {
    row[col] = params[i] ?? null;
  });
  if (/INSERT OR REPLACE/i.test(sql)) {
    const primaryKey = table === 'sync_queue' ? 'observation_id' : 'id';
    mockSqlTables[table] = (mockSqlTables[table] ?? []).filter((r) => r[primaryKey] !== row[primaryKey]);
  }
  mockSqlTables[table] = [...(mockSqlTables[table] ?? []), row];
  return { rows: [], rowsAffected: 1 };
}

function mockSqlSelect(sql: string): { rows: MockSqlRow[]; rowsAffected: number } {
  const table = mockSqlTableName(sql, 'FROM');
  let rows = [...(mockSqlTables[table] ?? [])];
  const orderMatch = sql.match(/ORDER BY (\w+)/i);
  if (orderMatch) {
    const column = orderMatch[1];
    rows = rows.sort((a, b) => ((a[column] as never) > (b[column] as never) ? 1 : -1));
  }
  return { rows, rowsAffected: 0 };
}

function mockSqlUpdate(sql: string, params: unknown[]): { rows: MockSqlRow[]; rowsAffected: number } {
  const match = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+?);?$/is);
  if (!match) return { rows: [], rowsAffected: 0 };
  const [, table, setClause, whereClause] = match;
  const setColumns = setClause.split(',').map((c) => c.split('=')[0].trim());
  const whereColumns = whereClause.split(/AND/i).map((c) => c.split('=')[0].trim());
  const setValues = params.slice(0, setColumns.length);
  const whereValues = params.slice(setColumns.length, setColumns.length + whereColumns.length);

  let rowsAffected = 0;
  mockSqlTables[table] = (mockSqlTables[table] ?? []).map((row) => {
    const isMatch = whereColumns.every((col, i) => row[col] === whereValues[i]);
    if (!isMatch) return row;
    rowsAffected += 1;
    const updated = { ...row };
    setColumns.forEach((col, i) => {
      updated[col] = setValues[i] ?? null;
    });
    return updated;
  });
  return { rows: [], rowsAffected };
}

function mockSqlExecute(sql: string, params: unknown[] = []): Promise<{ rows: MockSqlRow[]; rowsAffected: number }> {
  const trimmed = sql.trim();
  const upper = trimmed.toUpperCase();

  if (upper.startsWith('PRAGMA JOURNAL_MODE')) {
    return Promise.resolve({ rows: [], rowsAffected: 0 });
  }
  const setVersionMatch = trimmed.match(/PRAGMA user_version = (\d+)/i);
  if (setVersionMatch) {
    mockSqliteUserVersion = Number(setVersionMatch[1]);
    return Promise.resolve({ rows: [], rowsAffected: 0 });
  }
  if (upper.startsWith('PRAGMA USER_VERSION')) {
    return Promise.resolve({ rows: [{ user_version: mockSqliteUserVersion }], rowsAffected: 0 });
  }
  if (upper.startsWith('CREATE TABLE') || upper.startsWith('CREATE INDEX')) {
    return Promise.resolve({ rows: [], rowsAffected: 0 });
  }
  if (upper.startsWith('DELETE FROM')) {
    const table = mockSqlTableName(trimmed, 'FROM');
    mockSqlTables[table] = [];
    return Promise.resolve({ rows: [], rowsAffected: 0 });
  }
  if (upper.startsWith('INSERT')) {
    return Promise.resolve(mockSqlInsert(trimmed, params));
  }
  if (upper.startsWith('SELECT')) {
    return Promise.resolve(mockSqlSelect(trimmed));
  }
  if (upper.startsWith('UPDATE')) {
    return Promise.resolve(mockSqlUpdate(trimmed, params));
  }
  return Promise.resolve({ rows: [], rowsAffected: 0 });
}

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => ({
    execute: jest.fn((sql: string, params?: unknown[]) => mockSqlExecute(sql, params)),
    transaction: jest.fn(async (fn: (tx: { execute: typeof mockSqlExecute }) => Promise<void>) => {
      await fn({ execute: mockSqlExecute });
    }),
    close: jest.fn(),
  })),
}));

// ============================================================================
// React Native Mocks - Partial mocks to avoid full module loading issues
// ============================================================================
// Note: We don't mock the entire 'react-native' module as it causes issues
// with internal RN module loading (DevMenu, TurboModules, etc.)
// Instead, we mock specific native modules that need it.

// ============================================================================
// Navigation Mocks
// ============================================================================
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: jest.fn(),
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    useRoute: () => ({
      params: {},
    }),
    useFocusEffect: jest.fn(),
    useIsFocused: () => true,
  };
});

// ============================================================================
// Native Module Mocks
// ============================================================================

// onnxruntime-react-native mock - use virtual mock since native module may not resolve
jest.mock('onnxruntime-react-native', () => ({
  InferenceSession: {
    create: jest.fn(() => Promise.resolve({
      release: jest.fn(() => Promise.resolve()),
      run: jest.fn(() => Promise.resolve({})),
    })),
  },
  Tensor: jest.fn((type: string, data: unknown, dims: number[]) => ({
    type,
    data,
    dims,
  })),
  env: {},
}));

// ImageTensorModule mock (native module for image-to-tensor conversion)
jest.mock('./src/services/onnxInferenceService/nativeImageTensor', () => ({
  ImageTensorModule: {
    imageToTensor: jest.fn(() => Promise.resolve(new Array(3 * 640 * 640).fill(0))),
    cropImage: jest.fn(
      (_uri: string, _x: number, _y: number, _w: number, _h: number, outputPath: string) =>
        Promise.resolve(outputPath),
    ),
  },
}));

// react-native-fs mock
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/documents',
  CachesDirectoryPath: '/mock/caches',
  ExternalDirectoryPath: '/mock/external',
  downloadFile: jest.fn(() => ({
    jobId: 1,
    promise: Promise.resolve({ statusCode: 200, bytesWritten: 1000 }),
  })),
  stopDownload: jest.fn(),
  exists: jest.fn(() => Promise.resolve(false)),
  mkdir: jest.fn(() => Promise.resolve()),
  unlink: jest.fn(() => Promise.resolve()),
  readDir: jest.fn(() => Promise.resolve([])),
  readFile: jest.fn(() => Promise.resolve('')),
  writeFile: jest.fn(() => Promise.resolve()),
  appendFile: jest.fn(() => Promise.resolve()),
  stat: jest.fn(() => Promise.resolve({ size: 1000, isFile: () => true })),
  copyFile: jest.fn(() => Promise.resolve()),
  moveFile: jest.fn(() => Promise.resolve()),
  hash: jest.fn(() => Promise.resolve('mockhash')),
}));

// react-native-device-info mock
jest.mock('react-native-device-info', () => ({
  getTotalMemory: jest.fn(() => Promise.resolve(8 * 1024 * 1024 * 1024)), // 8GB
  getUsedMemory: jest.fn(() => Promise.resolve(4 * 1024 * 1024 * 1024)), // 4GB
  getFreeDiskStorage: jest.fn(() => Promise.resolve(50 * 1024 * 1024 * 1024)), // 50GB
  getBatteryLevel: jest.fn(() => Promise.resolve(1.0)), // full battery
  getModel: jest.fn(() => 'Test Device'),
  getSystemName: jest.fn(() => 'Android'),
  getSystemVersion: jest.fn(() => '13'),
  isEmulator: jest.fn(() => Promise.resolve(false)),
  getDeviceId: jest.fn(() => 'test-device-id'),
  getHardware: jest.fn(() => Promise.resolve('unknown')),
  getVersion: jest.fn(() => '0.1.0-field.1'),
  getBuildNumber: jest.fn(() => '1787551542'),
  getBundleId: jest.fn(() => 'org.ganesha.elebook.dev'),
}));

// react-native-image-picker mock
jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(() => Promise.resolve({
    assets: [{
      uri: 'file:///mock/image.jpg',
      type: 'image/jpeg',
      fileName: 'image.jpg',
      width: 1024,
      height: 768,
    }],
  })),
  launchCamera: jest.fn(() => Promise.resolve({
    assets: [{
      uri: 'file:///mock/camera.jpg',
      type: 'image/jpeg',
      fileName: 'camera.jpg',
      width: 1024,
      height: 768,
    }],
  })),
}));

// @react-native-community/geolocation mock
jest.mock('@react-native-community/geolocation', () => ({
  __esModule: true,
  default: {
    getCurrentPosition: jest.fn((success: (position: {
      coords: { latitude: number; longitude: number; accuracy: number };
    }) => void) => {
      success({
        coords: {
          latitude: 1.2345,
          longitude: 2.3456,
          accuracy: 7,
        },
      });
    }),
    watchPosition: jest.fn(() => 1),
    clearWatch: jest.fn(),
    stopObserving: jest.fn(),
    requestAuthorization: jest.fn(),
    setRNConfiguration: jest.fn(),
  },
}));

// react-native-keychain mock
jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(() => Promise.resolve(true)),
  getGenericPassword: jest.fn(() => Promise.resolve(false)),
  resetGenericPassword: jest.fn(() => Promise.resolve(true)),
  ACCESSIBLE: {
    WHEN_UNLOCKED: 'AccessibleWhenUnlocked',
    AFTER_FIRST_UNLOCK: 'AccessibleAfterFirstUnlock',
    ALWAYS: 'AccessibleAlways',
    WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'AccessibleWhenPasscodeSetThisDeviceOnly',
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AccessibleAfterFirstUnlockThisDeviceOnly',
    ALWAYS_THIS_DEVICE_ONLY: 'AccessibleAlwaysThisDeviceOnly',
  },
}));

// react-native-gesture-handler mock
jest.mock('react-native-gesture-handler', () => {
  const MockView = 'View';
  return {
    Swipeable: MockView,
    GestureHandlerRootView: MockView,
    ScrollView: MockView,
    PanGestureHandler: MockView,
    TapGestureHandler: MockView,
    State: {},
    Directions: {},
  };
});

// Mock the direct import of Swipeable
jest.mock('react-native-gesture-handler/Swipeable', () => 'View');

// react-native-worklets mock — must come before reanimated
jest.mock('react-native-worklets', () => ({}));

// react-native-reanimated mock — fully manual to avoid loading native worklets
jest.mock('react-native-reanimated', () => {
  const { View, Text, Image } = require('react-native');
  return {
    __esModule: true,
    default: {
      createAnimatedComponent: (component: any) => component || View,
      addWhitelistedNativeProps: jest.fn(),
      addWhitelistedUIProps: jest.fn(),
      View,
      Text,
      Image,
    },
    useSharedValue: jest.fn((init: any) => ({ value: init })),
    useAnimatedStyle: jest.fn((fn: any) => fn()),
    useDerivedValue: jest.fn((fn: any) => ({ value: fn() })),
    useAnimatedProps: jest.fn((fn: any) => fn()),
    useReducedMotion: jest.fn(() => false),
    withSpring: jest.fn((val: any) => val),
    withTiming: jest.fn((val: any) => val),
    withDelay: jest.fn((_: any, val: any) => val),
    withSequence: jest.fn((...vals: any[]) => vals[vals.length - 1]),
    withRepeat: jest.fn((val: any) => val),
    cancelAnimation: jest.fn(),
    Easing: {
      linear: jest.fn(),
      ease: jest.fn(),
      bezier: jest.fn(() => jest.fn()),
      in: jest.fn(),
      out: jest.fn(),
      inOut: jest.fn(),
    },
    FadeIn: { duration: jest.fn().mockReturnThis(), delay: jest.fn().mockReturnThis() },
    FadeOut: { duration: jest.fn().mockReturnThis(), delay: jest.fn().mockReturnThis() },
    SlideInDown: { duration: jest.fn().mockReturnThis() },
    SlideOutDown: { duration: jest.fn().mockReturnThis() },
    Layout: { duration: jest.fn().mockReturnThis() },
    createAnimatedComponent: (component: any) => component || View,
  };
});

// react-native-haptic-feedback mock
jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));

// react-native-zip-archive mock
jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn(() => Promise.resolve('/mock/unzipped/path')),
  zip: jest.fn(() => Promise.resolve('/mock/zipped/path')),
}));

// Mock react-native-vector-icons
jest.mock('react-native-vector-icons/Feather', () => 'Icon');

// react-native-safe-area-context mock
jest.mock('react-native-safe-area-context', () => {
  const defaultInset = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: jest.fn(() => defaultInset),
  };
});

// ============================================================================
// Global Test Utilities
// ============================================================================

const { PermissionsAndroid } = require('react-native');
jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
  PermissionsAndroid.RESULTS.GRANTED,
);

// Silence console during tests (optional - comment out for debugging)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn(),
// };

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  clearMockStorage();
});

// Global timeout for async operations — must match jest.config.js testTimeout
jest.setTimeout(60000);
