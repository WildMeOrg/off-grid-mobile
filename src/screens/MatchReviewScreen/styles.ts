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

  // Cropped detection image section
  detectionSection: {
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  croppedImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  speciesRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  speciesText: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
  },

  // Candidates list
  candidatesHeader: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  candidatesList: {
    flex: 1,
  },
  candidatesContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
    textAlign: 'center' as const,
    paddingVertical: SPACING.xl,
  },

  // Candidate card
  candidateCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  candidatePhoto: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
  },
  candidatePhotoPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  candidateInfo: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  candidateName: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
  },
  candidateId: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: 2,
  },
  candidateScoreRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  confidenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  candidateRank: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.primary,
    fontWeight: '600' as const,
  },
  confirmationNotice: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.textMuted,
    marginTop: SPACING.xs,
  },
  sourceBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.surfaceLight,
  },
  sourceBadgeText: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.textSecondary,
    textTransform: 'uppercase' as const,
  },
  approveButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  approveButtonText: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.background,
    textTransform: 'uppercase' as const,
  },

  // Footer actions
  footer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    gap: SPACING.sm,
  },
  newIndividualButton: {
    backgroundColor: colors.surface,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexDirection: 'row' as const,
    gap: SPACING.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  newIndividualText: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
  },
  skipButton: {
    paddingVertical: SPACING.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  skipText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
  },
});
