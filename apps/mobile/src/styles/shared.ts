import { Spacing } from '@/constants/colors';

// The icon + label row used by DataState, FarmSelector, ScreenHeader and FarmLocationMap,
// defined once. Components spread it into their own StyleSheet.create entry, because each
// adds its own size, colour and border on top.
export const sharedLayout = {
  inlineRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.two },
};
