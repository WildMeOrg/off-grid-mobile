import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { createStyles as createBaseStyles } from './styles';

export const createStyles = (colors: ThemeColors) => ({
  ...createBaseStyles(colors),
  section: { padding: SPACING.lg, gap: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionTitle: { ...TYPOGRAPHY.h2, letterSpacing: 0, color: colors.text, fontWeight: '600' as const },
  field: { gap: SPACING.xs },
  referenceRow: { flexDirection: 'row' as const, gap: SPACING.sm },
  photoTile: { flex: 1, minWidth: 0, gap: SPACING.sm },
  imageFrame: { width: '100%' as const, aspectRatio: 4 / 3, borderRadius: SPACING.sm, overflow: 'hidden' as const, backgroundColor: colors.surface },
  image: { width: '100%' as const, height: '100%' as const },
  imageCaption: { ...TYPOGRAPHY.bodySmall, letterSpacing: 0, color: colors.textSecondary },
  notice: { ...TYPOGRAPHY.bodySmall, letterSpacing: 0, color: colors.textSecondary, lineHeight: SPACING.xl },
  localPhoto: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  inlineEmpty: { padding: SPACING.lg },
});