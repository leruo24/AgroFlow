import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

// The two in-app help preferences, readable from any screen.
//
// STORAGE: @react-native-async-storage/async-storage, which the app already
// depends on and already uses for the notification preferences and the selected
// farm. Nothing new was installed.
//
// NOT in `profile`: that table has column-level UPDATE revokes, so a farmer
// cannot write arbitrary columns to it - and these are per-device display
// choices anyway, not account data. Someone who turns the helper off on their
// phone has not turned it off on a shared tablet.
//
// A tiny subscriber list keeps every mounted copy of the hook in step, so
// flipping a toggle in Settings hides the "?" icons on other screens
// immediately instead of on their next remount.

export type AppPreferences = {
  showPageHelp: boolean;
  showRaindropHelper: boolean;
};

export const APP_PREFERENCES_KEY = 'agroflow_app_preferences';

// Both default ON: the help is for farmers who have not used the app before,
// and they are exactly the people who will not go looking for a setting to
// enable it.
export const defaultAppPreferences: AppPreferences = {
  showPageHelp: true,
  showRaindropHelper: true,
};

let current: AppPreferences = { ...defaultAppPreferences };
let loaded = false;
const subscribers = new Set<(value: AppPreferences) => void>();

function publish() {
  for (const subscriber of subscribers) subscriber(current);
}

async function loadOnce() {
  if (loaded) return;

  try {
    const stored = await AsyncStorage.getItem(APP_PREFERENCES_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AppPreferences>;
      current = {
        showPageHelp: parsed.showPageHelp ?? defaultAppPreferences.showPageHelp,
        showRaindropHelper:
          parsed.showRaindropHelper ?? defaultAppPreferences.showRaindropHelper,
      };
    }
  } catch {
    // Unreadable or absent storage falls back to the defaults. A farmer must
    // never lose the help because a read failed.
    current = { ...defaultAppPreferences };
  } finally {
    loaded = true;
    publish();
  }
}

export function useAppPreferences() {
  const [preferences, setPreferences] = useState<AppPreferences>(current);
  const [ready, setReady] = useState(loaded);

  useEffect(() => {
    const subscriber = (value: AppPreferences) => {
      setPreferences({ ...value });
      setReady(true);
    };

    subscribers.add(subscriber);
    void loadOnce().then(() => subscriber(current));

    return () => {
      subscribers.delete(subscriber);
    };
  }, []);

  const setPreference = useCallback(
    <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => {
      current = { ...current, [key]: value };
      publish();

      // Written straight away so the choice survives a restart even if the app
      // is killed seconds later.
      AsyncStorage.setItem(APP_PREFERENCES_KEY, JSON.stringify(current)).catch(
        () => {
          // The in-memory value still applies for this session.
        }
      );
    },
    []
  );

  return { preferences, setPreference, ready };
}
