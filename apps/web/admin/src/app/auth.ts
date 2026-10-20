/* Admin session state, like apps/mobile/src/context/AuthContext.tsx but in plain
 * TypeScript: getSession on boot, onAuthStateChange to stay in sync, and a signIn() that
 * also sets state directly, using module-level state and listeners instead of React context.
 * Security: access depends on profile.role being a staff role, never on a session alone (see
 * the rejection path in signIn()). The API checks the same list (AgroFlow.Api/Auth/StaffRoles.cs). */

import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { postPublic } from "@/services/agroFlowApi";

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

/* Who may use the console. "field_officer" is here so the role needs no code change, but the
 * database only allows 'admin' and 'farm_user' today (0001) and RLS grants console reads to
 * 'admin' only, so in practice staff means admin. Keep in step with StaffRoles.cs. */
import { isStaffRole } from "@/lib/staff";
export { STAFF_ROLES, isStaffRole } from "@/lib/staff";

export const STAFF_ONLY_MESSAGE =
  "This console is for AgroFlow staff. Farmers, please use the AgroFlow app.";

/** Thrown by signIn() for a real login that is not a staff account, so the login screen can
 *  show the farmer where the app is instead of a bare error. */
export class StaffOnlyError extends Error {
  constructor() {
    super(STAFF_ONLY_MESSAGE);
    this.name = "StaffOnlyError";
  }
}

/** True only for a signed-in session whose profile.role is a staff role. */
export function isAdminAuthenticated(): boolean {
  return isStaffRole(profile?.role);
}

/** A session this browser already holds that is not staff (a farmer who signed in to the web
 *  app on the same site). Not signed out here: that would sign them out of the app too. */
export function hasNonStaffSession(): boolean {
  return session !== null && !isAdminAuthenticated();
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
  if (!signedInProfile || !isStaffRole(signedInProfile.role)) {
    // Security: sign straight back out, because a valid Supabase login (farmer or otherwise)
    // is not console access by itself. Module state is not set before this check, so
    // isAdminAuthenticated() never reports true for the rejected session, even for an instant.
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    session = null;
    profile = null;
    throw new StaffOnlyError();
  }

  session = data.session;
  profile = signedInProfile;
  notify();
}

/* Forgot password (docs/password-reset.md). The API sends a 6-digit code to the Telegram chat
 * linked to the account; the code and a new password then go to /api/auth/reset-password.
 * Staff with no Telegram get Supabase's email instead: a link back to this page with ?reset=1,
 * where supabase-js reads the recovery tokens and main.ts shows the new-password form. That
 * redirect URL must be in Supabase's allow list (Authentication -> URL Configuration ->
 * Redirect URLs), or Supabase sends people to the Site URL instead. */
export const RESET_QUERY = "reset";

/* Always the site's root address, also when asked from /staff/: that is the address on
 * Supabase's allowed redirect list, and main.ts sends a finished reset on to /staff/. */
export function passwordResetRedirectUrl(): string {
  const root = window.location.pathname.replace(/staff(\/(index\.html)?)?$/, "");
  return `${window.location.origin}${root}?${RESET_QUERY}=1`;
}

/** The same reply whatever the email, so the form cannot find out who has an account. */
export async function requestPasswordReset(email: string): Promise<string> {
  const res = await postPublic<{ message: string }>("/api/auth/forgot-password", {
    email,
    redirectTo: passwordResetRedirectUrl(),
  });
  return res.message;
}

/** The code from Telegram and the new password. Other sessions are signed out. */
export async function resetPasswordWithCode(email: string, code: string, newPassword: string): Promise<string> {
  const res = await postPublic<{ message: string }>("/api/auth/reset-password", { email, code, newPassword });
  return res.message;
}

/** True while the session came from a recovery link, so a new password can be set. */
export function hasRecoverySession(): boolean {
  return session !== null;
}

/** Sets the new password from the reset page. The recovery session is a normal session, so
 *  Supabase Auth accepts the change without the old password. */
export async function setNewPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
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
