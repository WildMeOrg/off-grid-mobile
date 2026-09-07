import type { ThemeColors } from '../theme';
import type { ObservationStatusPresentation } from '../services/observationStatus';

/**
 * Maps the shared, theme-agnostic observation-status severity
 * (src/services/observationStatus) to this app's actual theme color tokens.
 * Centralized here so Observations, Observation Detail, and Sync render the
 * same status with the same color instead of each screen inventing its own
 * mapping.
 */
export const OBSERVATION_STATUS_SEVERITY_COLOR_KEY: Record<
  ObservationStatusPresentation['severity'],
  keyof ThemeColors
> = {
  action: 'primary',
  progress: 'statusWarning',
  success: 'statusSuccess',
  informational: 'textSecondary',
  error: 'statusError',
};

export function getObservationStatusColor(
  colors: ThemeColors,
  severity: ObservationStatusPresentation['severity'],
): string {
  return colors[OBSERVATION_STATUS_SEVERITY_COLOR_KEY[severity]];
}
