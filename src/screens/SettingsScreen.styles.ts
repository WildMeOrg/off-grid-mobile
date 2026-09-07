import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

export const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    minHeight: 60,
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
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  themeToggleRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    ...shadows.small,
  },
  themeToggleLabel: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  themeSelector: {
    flexDirection: 'row' as const,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    padding: 3,
    gap: 2,
  },
  themeSelectorOption: {
    width: 34,
    height: 30,
    borderRadius: 6,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  themeSelectorOptionActive: {
    backgroundColor: colors.primary,
  },
  navSection: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    marginBottom: SPACING.lg,
    overflow: 'hidden' as const,
    ...shadows.small,
  },
  navItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navItemLast: {
    borderBottomWidth: 0,
  },
  navItemIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'transparent',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.md,
  },
  navItemContent: {
    flex: 1,
  },
  navItemTitle: {
    ...TYPOGRAPHY.body,
    fontWeight: '400' as const,
    color: colors.text,
  },
  navItemDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  aboutRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: SPACING.sm,
  },
  aboutLabel: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  aboutValue: {
    ...TYPOGRAPHY.body,
    fontWeight: '400' as const,
    color: colors.text,
  },
  aboutText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    lineHeight: 18,
  },
  gpuToggleRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  gpuToggleInfo: {
    flex: 1,
  },
  gpuToggleHint: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 14,
  },
  privacyCard: {
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
  },
  privacyIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'transparent',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: SPACING.md,
  },
  privacyTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  privacyText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
  },
  devButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    marginTop: SPACING.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed' as const,
    borderRadius: 6,
  },
  devButtonText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
  },
});
