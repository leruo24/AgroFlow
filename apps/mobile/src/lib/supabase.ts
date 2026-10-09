import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createClient,
} from '@supabase/supabase-js';

import {
  AppState,
  Platform,
} from 'react-native';

import 'react-native-url-polyfill/auto';

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL;

const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (
  !supabaseUrl ||
  !supabasePublishableKey
) {
  throw new Error(
    'Supabase environment variables are missing.',
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    auth: {
      ...(Platform.OS !== 'web'
        ? {
            storage: AsyncStorage,
          }
        : {}),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // No `lock` option: GoTrueClient's `lock` is deprecated in supabase-js 2.116 (gone in v3), and
      // the client now coordinates session refreshes itself.
      // The rest is still needed: AsyncStorage (native only; web uses the default localStorage),
      // autoRefreshToken, persistSession and detectSessionInUrl: false.
    },
  },
);

if (
  Platform.OS !== 'web'
) {
  AppState.addEventListener(
    'change',
    (state) => {
      if (
        state === 'active'
      ) {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    },
  );
}