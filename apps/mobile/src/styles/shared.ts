import { Spacing } from '@/constants/colors';

// The repeated row shape across DataState, FarmSelector, ScreenHeader and
// FarmLocationMap: an icon/label horizontal row. Defined once here rather
// than re-declared per component. Consumers spread this into their own
// StyleSheet.create entry (not a style array) since every call site also
// adds its own size/colour/border properties on top.
export const sharedLayout = {
  inlineRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.two },
};
