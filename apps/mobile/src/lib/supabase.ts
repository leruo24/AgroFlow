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
      // `lock: processLock` was removed here.
      //
      // GoTrueClient's `lock` option is deprecated in supabase-js 2.116 and
      // goes away in v3 - the client now coordinates session refreshes on its
      // own, so passing one is both unnecessary and a console warning on every
      // app start. Nothing replaces it: there is no option to set, and the
      // behaviour it protected is now the client's own responsibility.
      //
      // Everything else here is unchanged and still needed: AsyncStorage
      // (native only - the web build uses the client's default
      // localStorage), autoRefreshToken, persistSession and
      // detectSessionInUrl: false.
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