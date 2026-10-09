/* Admin session state, like apps/mobile/src/context/AuthContext.tsx but in plain
 * TypeScript: getSession on boot, onAuthStateChange to stay in sync, and a signIn() that
 * also sets state directly, using module-level state and listeners instead of React context.
 * Security: access depends on profile.role === 'admin', never on a session alone (see the
 * rejection path in signIn()). */

import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export interface AdminProfile {
  id: string;
  name: string;
  email: string;
  role: string;
}

let session: Session | null = null;
let profile: AdminProfile | null = null;
let initialized = false;

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to any change in session/profile (sign-in, sign-out, restore). */
export function onAuthChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function getSession(): Session | null {
  return session;
}

export function getAdminProfile(): AdminProfile | null {
  return profile;
}

/**
 * Re-reads the signed-in admin's own profile row, e.g. after they change their name in
 * Settings, so the header greeting updates. Silent on failure: the save already worked,
 * and a stale header is not worth an error.
 */
export async function refreshAdminProfile(): Promise<void> {
  const userId = session?.user?.id;
  if (!userId) return;

  const fresh = await loadProfile(userId);
  if (!fresh) return;

  profile = fresh;
  notify();
}

/**
 * Changes the signed-in admin's password through Supabase Auth, which owns credentials
 * (there is no password column or API endpoint for it). The current session stays valid,
 * so the page can say they are still signed in.
 */
export async function changeMyPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

/** True only for a signed-in session whose profile.role is 'admin'. */
export function isAdminAuthenticated(): boolean {
  return profile?.role === "admin";
}

async function loadProfile(userId: string): Promise<AdminProfile | null> {
  const { data, error } = await supabase
    .from("profile")
    .select("id, name, email, role")
    .eq("id", userId)
    .single();

  if (error || !data) return null;
  return data as AdminProfile;
}

/**
 * Call once at startup: restores any saved session and starts listening for auth changes
 * (sign-out in another tab, token refresh, etc.). Resolves once the initial state is known.
 */
export async function initAuth(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const { data } = await supabase.auth.getSession();
  session = data.session;
  profile = session ? await loadProfile(session.user.id) : null;

  // Like AuthContext's onAuthStateChange listener: keeps state in sync with events signIn()
  // did not cause (restored or refreshed sessions, sign-out elsewhere). It also fires again
  // for signIn()'s own SIGNED_IN event, which is harmless.
  supabase.auth.onAuthStateChange((_event, newSession) => {
    void (async () => {
      session = newSession;
      profile = newSession ? await loadProfile(newSession.user.id) : null;
      notify();
    })();
  });
}

export async function signIn(email: string, password: string): Promise<void> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  if (!data.session) throw new Error("Supabase did not return a valid session.");

  const signedInProfile = await loadProfile(data.session.user.id);
  if (!signedInProfile || signedInProfile.role !== "admin") {
    // Security: sign straight back out, because a valid Supabase login (farmer or otherwise)
    // is not admin access by itself. Module state is not set before this check, so
    // isAdminAuthenticated() never reports true for the rejected session, even for an instant.
    await supabase.auth.signOut();
    throw new Error("This account is not an administrator.");
  }

  session = data.session;
  profile = signedInProfile;
  notify();
}

/* Log out. supabase-js keeps the stored session when its server call fails (offline,
 * server down), so a failed global sign-out falls back to a local one: Log out must always
 * end the session on this computer. */
export async function signOut(): Promise<void> {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (error) {
    console.warn("Supabase sign-out did not reach the server; signing out on this computer only.", error);
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
  session = null;
  profile = null;
  notify();
}
