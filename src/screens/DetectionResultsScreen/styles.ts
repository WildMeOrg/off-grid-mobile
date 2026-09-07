import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';

export const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  headerTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
  },
  backButton: {
    padding: SPACING.xs,
  },
  photoContainer: {
    flex: 1,
    position: 'relative' as const,
  },
  photo: {
    width: '100%' as const,
    height: '100%' as const,
  },
  overlayContainer: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  footer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    gap: SPACING.sm,
  },
  notesLabel: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textSecondary,
  },
  notesInput: {
    minHeight: 72,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: colors.text,
    backgroundColor: colors.surface,
    textAlignVertical: 'top' as const,
  },
  saveAllButton: {
    backgroundColor: colors.primary,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexDirection: 'row' as const,
    gap: SPACING.sm,
  },
  saveAllText: {
    ...TYPOGRAPHY.h2,
    color: colors.background,
  },
  saveAllButtonDisabled: {
    opacity: 0.6,
  },
  // Bounding box styles
  boundingBox: {
    position: 'absolute' as const,
    borderWidth: 2,
    borderRadius: 4,
    justifyContent: 'flex-end' as const,
    alignItems: 'flex-start' as const,
  },
  boxLabel: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    maxWidth: '100%' as const,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  boxLabelText: {
    ...TYPOGRAPHY.bodySmall,
    fontWeight: '600' as const,
    color: '#FFFFFF',
    flexShrink: 1,
  },
});
