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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
  },
  syncAllButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.primary,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: 8,
    gap: SPACING.sm,
  },
  syncAllText: {
    ...TYPOGRAPHY.body,
    color: colors.background,
    fontWeight: '600' as const,
  },
  list: {
    padding: SPACING.lg,
  },
  itemCard: {
    marginBottom: SPACING.md,
  },
  itemRow: {
    flexDirection: 'row' as const,
    gap: SPACING.md,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
  },
  itemContent: {
    flex: 1,
  },
  timestamp: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
  },
  identitySummary: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginTop: SPACING.xs,
  },
  notesPreview: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: SPACING.xs,
    fontStyle: 'italic' as const,
  },
  observationId: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: SPACING.xs,
  },
  statusRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
    marginTop: SPACING.sm,
  },
  statusBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
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
  itemFooter: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginTop: SPACING.md,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  technicalToggleText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    textDecorationLine: 'underline' as const,
  },
  actionButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionButtonText: {
    ...TYPOGRAPHY.meta,
    color: colors.primary,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.xxl,
    gap: SPACING.md,
  },
  emptyTitle: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
    textAlign: 'center' as const,
  },
});
