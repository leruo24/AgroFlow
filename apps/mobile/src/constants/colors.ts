//gives the chosen color combination a consistent typescript structure and allows for type checking and autocompletion when using the colors in the application. The AppColors type is defined as a mapped type that takes each key from the lightColors object and assigns it a string type, ensuring that all color properties are present and correctly typed in both light and dark color schemes.

// Fonts and Spacing folded in from the old (unused) constants/theme.ts -
// that file also defined its own separate, orphaned Colors object nothing
// imported; this file is the one real theme source now. Font family
// selection and the spacing scale are both still worth keeping - neither
// duplicated anything here, they just weren't wired into the live theme
// module before.
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

// Named type steps replacing the ~13 ad hoc font sizes previously scattered
// across the screen stylesheets (9-40px) - hierarchy comes from which named
// step is used, not from a card/box around the text. See docs/ui_reference
// (the Webex screenshots) for the source: label ~11sp small-caps, caption
// ~12-13sp, body ~15-16sp, title ~17-18sp. `display` has no reference
// equivalent (Webex's own screens don't show a hero numeral) - it's kept as
// the one deliberate large-type moment per screen (a stat, a temperature),
// consistent with "hierarchy through typography," not decoration.
export const Type = {
  label: 11,
  caption: 13,
  body: 15,
  title: 18,
  display: 32,
} as const;

// Flat by default. `full` is for genuinely circular elements (avatars) via
// width/2, not a corner-rounding step. `sm`/`md` are for the rare remaining
// boxed element (a text input) - list/status content uses `none` and relies
// on `divider` instead, matching the reference's hairline-row model.
export const Radius = {
  none: 0,
  sm: 8,
  md: 12,
  full: 9999,
} as const;

// Fixed heights for embedded media that must render at a concrete pixel
// size regardless of theme or screen density - a MapView needs real height
// to lay out, it isn't a layout gap from the Spacing scale. Deliberately
// its own small scale, not folded into Spacing, so a reviewer doesn't
// mistake `farmMap: 190` for a spacing value and "fix" it to the nearest
// Spacing step.
export const FixedMediaHeight = {
  farmMap: 190,
} as const;

// Colours for chrome drawn ON TOP of map tiles/imagery - the pin, the tile
// attribution strip. These must stay legible against real-world map tile
// colours in both light and dark theme, so they live outside AppColors on
// purpose and are NOT theme-aware. Do not swap these for a themed token or
// move them into lightColors/darkColors - that would make the pin invisible
// against tiles in whichever theme it stops matching.
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
  // Solid surface for the floating tab bar. Was a pair of translucent
  // "frosted" tokens backing an expo-blur layer; blur is gone, so this is
  // one opaque colour and the bar is separated from the canvas by a
  // hairline border and a soft shadow instead.
  tabBarSurface: string;
  // Dim behind modal sheets. Replaces the blurred backdrop - the reference
  // backdrop reads as darkened, which a scrim delivers on its own.
  scrim: string;

  text: string;
  textSecondary: string;
  textMuted: string;

  border: string;
  // Hairline row separator - the reference's one constant structural
  // element. Deliberately distinct from `border`: `border` is for the rare
  // real boundary (a text input, an avatar ring); `divider` is for
  // separating rows within an unboxed list.
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

  // Was '#F1F8F3' - a pale green tint every screen sat on. The Webex
  // reference canvas is flat white with no tint; `surface` now equals this
  // exactly, since the reference has no "card sits on a different plane
  // than the page" model.
  background: '#FFFFFF',

  surface: '#FFFFFF',
  surfaceSecondary: '#F5F6F5',
  tabBarSurface: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.32)',

  text: '#253126',
  textSecondary: '#637064',
  textMuted: '#879187',

  // Was '#DDE9DF' - green-tinted, and doing double duty as both card
  // outline and row divider. Neutralised and narrowed to the rare real
  // boundary; `divider` below now carries the row-separator job.
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
