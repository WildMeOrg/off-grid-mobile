import type { NavigatorScreenParams } from '@react-navigation/native';

// ============================================================================
// Wildlife navigation types
// ============================================================================

export type RootStackParamList = {
  Onboarding: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  PackDetails: { packId: string };
  Capture: undefined;
  DetectionResults: { observationId: string };
  MatchReview: { observationId: string; detectionId: string };
  ObservationDetail: { observationId: string };
  Settings: undefined;
  SecuritySettings: undefined;
  PassphraseSetup: undefined;
  SignIn: undefined;
  SelectRole: undefined;
};

export type MainTabParamList = {
  HomeTab: undefined;
  PacksTab: undefined;
  ObservationsTab: undefined;
  SyncTab: undefined;
};

// Settings navigation (for SettingsScreen internal navigation)
export type SettingsStackParamList = {
  SettingsMain: undefined;
  SecuritySettings: undefined;
  PassphraseSetup: undefined;
};
