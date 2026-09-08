// SoC detection types
export type SoCVendor = 'qualcomm' | 'mediatek' | 'exynos' | 'tensor' | 'apple' | 'unknown';
export interface SoCInfo {
  vendor: SoCVendor;
  hasNPU: boolean;
  qnnVariant?: '8gen2' | '8gen1' | 'min';
  appleChip?: 'A14' | 'A15' | 'A16' | 'A17Pro' | 'A18';
}

// Hardware-related types
export interface DeviceInfo {
  totalMemory: number;
  usedMemory: number;
  availableMemory: number;
  deviceModel: string;
  systemName: string;
  systemVersion: string;
  isEmulator: boolean;
}

// Onboarding-related types
export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  image?: string;
}

// Wildlife types
export type {
  MiewIDModelStatus,
  MiewIDModelRecord,
  ModelFormat,
  EmbeddingPackManifest,
  DetectorConfig,
  EmbeddingPack,
  PackIndividual,
  LocalIndividual,
  Observation,
  Detection,
  MatchCandidate,
  EncounterFields,
  SyncStatus,
  SyncQueueItem,
  BoundingBox,
  DetectionResult,
} from './wildlife';
