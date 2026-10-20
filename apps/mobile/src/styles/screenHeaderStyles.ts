import { StyleSheet } from 'react-native';
import { Space, TypeScale, type AppColors } from '@/constants/colors';

// The one page header: the title and the help/avatar buttons share a row, centred on each
// other; the subtitle runs the full width below, so it never wraps early beside the buttons.
export function createScreenHeaderStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { paddingTop: Space.xl, paddingBottom: Space.lg, gap: Space.sm },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
    title: { flex: 1, color: colors.text, fontSize: TypeScale.title, lineHeight: 34, fontWeight: '700' },
    actions: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
    subtitle: { color: colors.textSecondary, fontSize: TypeScale.body, lineHeight: 22 },
  });
}
