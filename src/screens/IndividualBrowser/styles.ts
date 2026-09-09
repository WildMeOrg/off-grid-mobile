import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';

export const createStyles = (colors: ThemeColors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, gap: SPACING.sm,
  },
  title: { ...TYPOGRAPHY.h1, letterSpacing: 0, color: colors.text, flex: 1 },
  iconButton: {
    minWidth: SPACING.xxl + SPACING.md, minHeight: SPACING.xxl + SPACING.md,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  controls: { paddingHorizontal: SPACING.lg, gap: SPACING.sm, paddingBottom: SPACING.md },
  controlRow: { flexDirection: 'row' as const, alignItems: 'center' as const, flexWrap: 'wrap' as const, gap: SPACING.sm },
  selector: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm,
    paddingVertical: SPACING.sm, minHeight: SPACING.xxl + SPACING.md,
  },
  search: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm,
    paddingHorizontal: SPACING.md, borderWidth: 1, borderColor: colors.border,
    borderRadius: SPACING.sm, backgroundColor: colors.surface,
  },
  input: { ...TYPOGRAPHY.body, letterSpacing: 0, color: colors.text, flex: 1, minHeight: SPACING.xxl + SPACING.lg },
  body: { ...TYPOGRAPHY.body, letterSpacing: 0, color: colors.text },
  secondary: { ...TYPOGRAPHY.bodySmall, letterSpacing: 0, color: colors.textSecondary },
  flexible: { flex: 1, minWidth: 0 },
  name: { ...TYPOGRAPHY.body, letterSpacing: 0, fontWeight: '600' as const, color: colors.text },
  row: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md,
    padding: SPACING.lg, borderBottomWidth: 1, borderBottomColor: colors.border,
    minHeight: SPACING.xxl * 3,
  },
  rowText: { flex: 1, minWidth: 0, gap: SPACING.xs },
  thumbnail: { width: SPACING.xxl * 2, height: SPACING.xxl * 2, borderRadius: SPACING.sm, backgroundColor: colors.surface },
  placeholder: { alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: colors.surface, gap: SPACING.sm },
  empty: { flex: 1, padding: SPACING.xl, alignItems: 'center' as const, justifyContent: 'center' as const, gap: SPACING.lg },
  emptyText: { ...TYPOGRAPHY.body, letterSpacing: 0, textAlign: 'center' as const, color: colors.textSecondary },
  listContent: { flexGrow: 1, paddingBottom: SPACING.xxl },
  choice: { padding: SPACING.lg, gap: SPACING.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  choiceRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md },
  choiceList: { maxHeight: SPACING.xxl * 10 },
});