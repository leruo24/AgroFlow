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
  label: 11,
  caption: 13,
  body: 15,
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
  primary: '#42C3C7',
  primaryDark: '#168F99',

  secondary: '#7FA88A',
  secondaryDark: '#2F6B4B',

  navigation: '#FFFFFF',
  navigationText: '#253126',
  navigationMuted: '#637064',

  // Flat white page background, the same as `surface`: cards do not sit on a different
  // plane from the page.
  background: '#FFFFFF',

  surface: '#FFFFFF',
  surfaceSecondary: '#F5F6F5',
  tabBarSurface: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.32)',

  text: '#253126',
  textSecondary: '#637064',
  textMuted: '#879187',

  // A neutral grey for the few real boundaries; `divider` below separates rows.
  border: '#E4E7E4',
  divider: 'rgba(20,26,20,0.08)',

  white: '#FFFFFF',
  black: '#000000',

  lightBlue: '#E4F4F8',
  lightGreen: '#E3EEDF',

  weatherBackground: '#DFF2F5',
  weatherBorder: '#B5D8DF',

  irrigationBackground: '#E4F0E1',
  irrigationBorder: '#B9D0B2',

  healthyBackground: '#E1EDDC',

  success: '#4F8F62',
  successBackground: '#E1EDDC',

  warning: '#B77A26',
  warningBackground: '#FFF2DC',

  error: '#D65A50',
  errorBackground: '#FBE7E5',
};

export const darkColors: AppColors = {
  primary: '#58CDD0',
  primaryDark: '#76DCE0',

  secondary: '#8BB697',
  secondaryDark: '#9BC58B',

  navigation: '#123A29',
  navigationText: '#FFFFFF',
  navigationMuted: '#B8CEC0',

  background: '#182018',

  surface: '#222C22',
  surfaceSecondary: '#2A352A',
  tabBarSurface: '#222C22',
  scrim: 'rgba(0,0,0,0.48)',

  text: '#F1F5EF',
  textSecondary: '#B5C0B3',
  textMuted: '#8F9A8E',

  border: '#3A4739',
  divider: 'rgba(241,245,239,0.08)',

  white: '#FFFFFF',
  black: '#000000',

  lightBlue: '#233B43',
  lightGreen: '#293A2B',

  weatherBackground: '#203840',
  weatherBorder: '#34535C',

  irrigationBackground: '#293A2B',
  irrigationBorder: '#40563F',

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
