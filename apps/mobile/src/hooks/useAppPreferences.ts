import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

// The two in-app help preferences, readable from any screen.
// Stored with AsyncStorage (already used for notification preferences and the selected farm).
// Not in `profile`: that table limits which columns a farmer can update, and these are
// per-device display choices anyway.
// A small subscriber list keeps every copy of the hook in step, so flipping a toggle in
// Settings hides the "?" icons on other screens straight away.

export type AppPreferences = {
  showPageHelp: boolean;
  showRaindropHelper: boolean;
};

export const APP_PREFERENCES_KEY = 'agroflow_app_preferences';

// Both default to on: the help is for farmers new to the app, who will not go looking for
// a setting.
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
    // Missing or unreadable storage falls back to the defaults, so help is never lost.
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

      // Written straight away so the choice survives a restart even if the app is killed soon after.
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
