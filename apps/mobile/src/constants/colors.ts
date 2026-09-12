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

  text: string;
  textSecondary: string;
  textMuted: string;

  border: string;

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

  navigation: '#184D35',
  navigationText: '#FFFFFF',
  navigationMuted: '#C4D8CC',

  background: '#DCE8D7',

  surface: '#FFFFFF',
  surfaceSecondary: '#EEF4EB',

  text: '#253126',
  textSecondary: '#637064',
  textMuted: '#879187',

  border: '#B9CBB4',

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

  text: '#F1F5EF',
  textSecondary: '#B5C0B3',
  textMuted: '#8F9A8E',

  border: '#3A4739',

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