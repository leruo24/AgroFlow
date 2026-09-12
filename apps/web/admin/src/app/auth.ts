/* Admin session state - the vanilla-TS equivalent of
   apps/mobile/src/context/AuthContext.tsx. Same Supabase Auth patterns
   (getSession on boot, onAuthStateChange to stay in sync, an explicit
   signIn() that also sets state directly), adapted to this app's
   module-level-state-plus-listeners style instead of React context.

   Gating is strictly on profile.role === 'admin', never on session alone -
   see the rejection path in signIn() for why that matters. */

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

/** Call once at startup - restores any persisted session and starts
    listening for auth changes (sign-out in another tab, token refresh,
    etc.). Resolves once the initial state is known either way. */
export async function initAuth(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const { data } = await supabase.auth.getSession();
  session = data.session;
  profile = session ? await loadProfile(session.user.id) : null;

  // Mirrors AuthContext's onAuthStateChange listener: keeps state in sync
  // with events signIn() didn't cause directly (restored/refreshed
  // sessions, sign-out triggered elsewhere). It also re-fires for the same
  // SIGNED_IN event signIn() below already handled - redundantly setting
  // the same values is harmless, same as the React version double-setting
  // state from both places.
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
    // Sign back out immediately - a valid Supabase login (farmer or
    // otherwise) is not, by itself, admin access. Deliberately not setting
    // module state before this check, so isAdminAuthenticated() never
    // reports true for the rejected session even for the instant before
    // the SIGNED_OUT event above lands.
    await supabase.auth.signOut();
    throw new Error("This account is not an administrator.");
  }

  session = data.session;
  profile = signedInProfile;
  notify();
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  session = null;
  profile = null;
  notify();
}
