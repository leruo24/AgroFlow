import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"];
const supabaseAnonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"];

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env vars: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env"
  );
}

// Same session-handling options as apps/mobile/src/lib/supabase.ts
// (autoRefreshToken/persistSession) - this is a browser tab, not a native
// app, so there's no AsyncStorage/AppState equivalent to wire up: the
// client's default storage (window.localStorage) and default
// detectSessionInUrl (true, for any future magic-link/invite flow) are
// already correct for the web.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
  },
});
