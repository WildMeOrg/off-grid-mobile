import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

export const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
  },
  headerTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
  },
  backButton: {
    padding: SPACING.xs,
  },
  notFound: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  notFoundText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
  },
  content: {
    padding: SPACING.lg,
  },
  photo: {
    width: '100%' as const,
    aspectRatio: 4 / 3,
    borderRadius: 12,
    backgroundColor: colors.surface,
    marginBottom: SPACING.md,
  },
  section: {
    marginBottom: SPACING.md,
  },
  metaLabel: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
  },
  metaLabelSpaced: {
    marginTop: SPACING.sm,
  },
  metaValue: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    marginTop: SPACING.xs,
  },
  statusRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusLabel: {
    ...TYPOGRAPHY.h3,
  },
  statusDescription: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginTop: SPACING.xs,
  },
  statusMeta: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: SPACING.xs,
  },
  errorText: {
    ...TYPOGRAPHY.meta,
    color: colors.error,
    marginTop: SPACING.xs,
  },
  actionButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.primary,
    paddingVertical: SPACING.md,
    borderRadius: 8,
    marginTop: SPACING.md,
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.background,
    fontWeight: '600' as const,
  },
  detectionsHeader: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    marginBottom: SPACING.sm,
  },
  detectionRow: {
    flexDirection: 'row' as const,
    gap: SPACING.md,
  },
  detectionCrop: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
  },
  detectionInfo: {
    flex: 1,
    justifyContent: 'center' as const,
  },
  decisionText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginTop: SPACING.xs,
  },
  candidatesBlock: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  candidateText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginTop: SPACING.xs,
  },
  candidateTextApproved: {
    color: colors.text,
    fontWeight: '600' as const,
  },
});
