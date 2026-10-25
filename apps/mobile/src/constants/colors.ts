// Gives the colour palette a TypeScript type (AppColors), so every colour exists in both
// the light and dark themes and gets type checking and autocompletion.

// This file is the app's one theme source, including the font families and spacing scale.
import { Platform } from 'react-native';

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

// Named text sizes, so hierarchy comes from which step is used, not from boxes around text.
// Based on docs/ui_reference (the Webex screenshots): label ~11sp small-caps, caption
// ~12-13sp, body ~15-16sp, title ~17-18sp. `display` is the one large number per screen
// (a stat or a temperature).
export const Type = {
  // 12 on web, where browsers expect at least 12 px; the phones keep 11.
  label: Platform.OS === 'web' ? 12 : 11,
  caption: 13,
  body: 16,
  title: 18,
  display: 32,
} as const;

// Flat by default. `full` is for truly circular things (avatars) via width/2. `sm`/`md` are
// for the few boxed elements (a text input); lists use `none` and a `divider` instead.
export const Radius = {
  none: 0,
  sm: 8,
  md: 12,
  full: 9999,
} as const;

// The one spacing scale: 4 / 8 / 12 / 16 / 24 / 32. Every padding, margin and gap in the app
// uses one of these (Spacing above names the same steps for older code: one 4, two 8,
// three 16, four 24, five 32).
export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// The type scale, by role: a page title, a section heading, body text, a field label and
// small print. `Type` above keeps the older names (title = section heading, caption = label).
export const TypeScale = {
  title: 28,
  section: Type.title,
  body: Type.body,
  label: Type.caption,
  small: Type.label,
} as const;

// Page layout: the side gutter, the card's padding and the gap between cards, and the gap
// from a section heading to its first card.
export const Layout = {
  gutter: Space.lg,
  cardPadding: Space.lg,
  cardGap: Space.md,
  headingToCard: Space.md,
  sectionGap: Space.xl,
  // A grid column never gets narrower than this, so "21.4°C" or "1 400 L" stays on one line.
  gridMinColumn: 120,
} as const;

// The one card look: every list item (zones, alerts, history, reports) and grouped block.
export function cardStyle(colors: { surface: string; border: string }) {
  return {
    padding: Layout.cardPadding,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: Space.sm,
  } as const;
}

// Fixed heights for embedded media that need a real pixel size (a MapView needs height to
// lay out). Kept apart from Spacing so nobody mistakes `farmMap: 190` for a spacing value.
export const FixedMediaHeight = {
  farmMap: 190,
} as const;

// Colours for things drawn on top of map tiles (the pin, the attribution strip). They must
// stay readable on real map colours in both themes, so they are not theme-aware. Do not
// move them into lightColors/darkColors, or the pin disappears in one theme.
export const MapChrome = {
  pinColor: '#168F99',
  attributionBackground: '#FFFFFF',
  attributionText: '#253126',
} as const;

export type AppColors = {
  action: string;
  dangerAction: string;
  successAction: string;
  primary: string;
  primaryDark: string;

  secondary: string;
  secondaryDark: string;

  navigation: string;
  navigationText: string;
  navigationMuted: string;

  background: string;
  surface: string;
  surfaceSecondary: string;
  // Solid surface for the floating tab bar, separated from the page by a hairline border
  // and a soft shadow.
  tabBarSurface: string;
  // Dim behind modal sheets.
  scrim: string;

  text: string;
  textSecondary: string;
  textMuted: string;

  border: string;
  // Hairline row separator. Different from `border`, which is for the few real boundaries
  // (a text input, an avatar ring); `divider` separates rows in an unboxed list.
  divider: string;

  white: string;
  black: string;

  lightBlue: string;
  lightGreen: string;

  weatherBackground: string;
  weatherBorder: string;

  irrigationBackground: string;
  irrigationBorder: string;

  healthyBackground: string;

  success: string;
  successBackground: string;

  warning: string;
  warningBackground: string;

  error: string;
  errorBackground: string;
};

export const lightColors: AppColors = {
  action: '#0B607D',
  dangerAction: '#B13B32',
  successAction: '#28613C',
  primary: '#126B91',
  primaryDark: '#0B4F6C',

  secondary: '#5F8F70',
  secondaryDark: '#2F6B4B',

  navigation: '#0B2A3A',
  navigationText: '#FFFFFF',
  navigationMuted: '#D0E3EB',

  // Warm neutral surfaces with navy text; blue identifies actions and irrigation.
  background: '#FBFAF6',

  surface: '#FFFFFF',
  surfaceSecondary: '#EDF5F7',
  tabBarSurface: '#0B2A3A',
  scrim: 'rgba(0,0,0,0.32)',

  text: '#132F42',
  textSecondary: '#526575',
  textMuted: '#526575',

  // A neutral grey for the few real boundaries; `divider` below separates rows.
  border: '#C6D7DF',
  divider: 'rgba(20,26,20,0.08)',

  white: '#FFFFFF',
  black: '#000000',

  lightBlue: '#E4F4F8',
  lightGreen: '#E3EEDF',

  weatherBackground: '#DFF2F5',
  weatherBorder: '#B5D8DF',

  irrigationBackground: '#E7F3FA',
  irrigationBorder: '#B8D5E5',

  healthyBackground: '#E1EDDC',

  success: '#28613C',
  successBackground: '#E1EDDC',

  warning: '#815015',
  warningBackground: '#FFF2DC',

  error: '#B13B32',
  errorBackground: '#FBE7E5',
};

export const darkColors: AppColors = {
  action: '#0B607D',
  dangerAction: '#B13B32',
  successAction: '#28613C',
  primary: '#8BD3ED',
  primaryDark: '#A7DCF0',

  secondary: '#82B98E',
  secondaryDark: '#A0D8AD',

  navigation: '#071D2B',
  navigationText: '#FFFFFF',
  navigationMuted: '#C5DAE4',

  background: '#0D1B24',

  surface: '#172A36',
  surfaceSecondary: '#203B4A',
  tabBarSurface: '#071D2B',
  scrim: 'rgba(0,0,0,0.48)',

  text: '#EDF6FA',
  textSecondary: '#BFD0DA',
  textMuted: '#BFD0DA',

  border: '#526B79',
  divider: 'rgba(241,245,239,0.08)',

  white: '#FFFFFF',
  black: '#000000',

  lightBlue: '#233B43',
  lightGreen: '#293A2B',

  weatherBackground: '#203840',
  weatherBorder: '#34535C',

  irrigationBackground: '#203C4C',
  irrigationBorder: '#416276',

  healthyBackground: '#293A2B',

  success: '#82B98E',
  successBackground: '#293A2B',

  warning: '#E2AC58',
  warningBackground: '#493A21',

  error: '#E47B72',
  errorBackground: '#472927',
};

export const Colors = {
  light: lightColors,
  dark: darkColors,
};
