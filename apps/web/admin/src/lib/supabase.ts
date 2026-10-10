import { createClient } from "@supabase/supabase-js";
import { navigationAwareFetch } from "@/lib/navigation";

const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"];
const supabaseAnonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"];

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env vars: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env"
  );
}

// Same session options as apps/mobile/src/lib/supabase.ts (autoRefreshToken/
// persistSession). In a browser tab the default storage (window.localStorage) and
// detectSessionInUrl (true) are already right, so nothing else is needed.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
  },
  // Every table read a page makes while rendering is tied to that navigation and cancelled
  // if the admin clicks elsewhere first: one wrapper here instead of an abort signal on every
  // query. Writes and auth traffic are never cancelled. See lib/navigation.ts.
  global: { fetch: navigationAwareFetch },
});
