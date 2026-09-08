import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceInfo } from '../types';

interface AppState {
  // Theme
  themeMode: 'system' | 'light' | 'dark';
  setThemeMode: (mode: 'system' | 'light' | 'dark') => void;

  // Onboarding
  hasCompletedOnboarding: boolean;
  setOnboardingComplete: (complete: boolean) => void;

  // Device info
  deviceInfo: DeviceInfo | null;
  setDeviceInfo: (info: DeviceInfo) => void;

  /** Android-only LiteRT/GPU model preference; ignored on iOS. */
  preferGpuModel: boolean;
  setPreferGpuModel: (prefer: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      themeMode: 'system' as 'system' | 'light' | 'dark',
      setThemeMode: (mode) => set({ themeMode: mode }),
      hasCompletedOnboarding: false,
      setOnboardingComplete: (complete) =>
        set({ hasCompletedOnboarding: complete }),
      deviceInfo: null,
      setDeviceInfo: (info) => set({ deviceInfo: info }),
      preferGpuModel: false,
      setPreferGpuModel: (prefer) => set({ preferGpuModel: prefer }),
    }),
    {
      name: 'local-llm-app-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        themeMode: state.themeMode,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        preferGpuModel: state.preferGpuModel,
      }),
    }
  )
);
