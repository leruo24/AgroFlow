// Holds the appearance settings for the whole app: the user's theme choice (light, dark or
// system), the resolved theme and its colour palette. The choice is saved in AsyncStorage
// so it survives restarts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  useColorScheme,
} from 'react-native';

import {
  AppColors,
  darkColors,
  lightColors,
} from '@/constants/colors';

export type ThemePreference =
  | 'light'
  | 'dark'
  | 'system';

type ResolvedTheme =
  | 'light'
  | 'dark';

type ThemeContextType = {
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  colors: AppColors;
  isDark: boolean;
  setThemePreference: (
    preference: ThemePreference
  ) => Promise<void>;
};

const ThemeContext =
  createContext<
    ThemeContextType | undefined
  >(undefined);

const STORAGE_KEY =
  'agroflow_theme_preference';

export function ThemeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const systemScheme =
    useColorScheme();

  const [
    themePreference,
    setThemePreferenceState,
  ] =
    useState<ThemePreference>(
      'system'
    );

  const [
    loaded,
    setLoaded,
  ] =
    useState(false);

  useEffect(() => {
    loadThemePreference();
  }, []);

  async function loadThemePreference() {
    try {
      const storedPreference =
        await AsyncStorage.getItem(
          STORAGE_KEY
        );

      if (
        storedPreference ===
          'light' ||
        storedPreference ===
          'dark' ||
        storedPreference ===
          'system'
      ) {
        setThemePreferenceState(
          storedPreference
        );
      }
    } catch (error) {
      console.log(
        'Theme preference load error:',
        error
      );
    } finally {
      setLoaded(true);
    }
  }

  async function setThemePreference(
    preference: ThemePreference
  ) {
    setThemePreferenceState(
      preference
    );

    try {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        preference
      );
    } catch (error) {
      console.log(
        'Theme preference save error:',
        error
      );
    }
  }

  const resolvedTheme:
    ResolvedTheme =
    themePreference === 'system'
      ? systemScheme === 'dark'
        ? 'dark'
        : 'light'
      : themePreference;

  const colors: AppColors =
    resolvedTheme === 'dark'
      ? darkColors
      : lightColors;

  const isDark =
    resolvedTheme === 'dark';

  const value =
    useMemo(
      () => ({
        themePreference,
        resolvedTheme,
        colors,
        isDark,
        setThemePreference,
      }),
      [
        themePreference,
        resolvedTheme,
        colors,
        isDark,
      ]
    );

  if (!loaded) {
    return null;
  }

  return (
    <ThemeContext.Provider
      value={value}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context =
    useContext(
      ThemeContext
    );

  if (!context) {
    throw new Error(
      'useTheme must be used inside ThemeProvider'
    );
  }

  return context;
}