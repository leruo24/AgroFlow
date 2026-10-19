// Small rules for signing in with an AgroFlow temporary password and for the Telegram reset
// code (docs/password-reset.md). The server's twin is backend/AgroFlow.Domain/SignInRules.cs.
//
// A temporary password is 8 capitals and digits with no look-alikes (no 0, O, 1, I or L) and
// is shown as two groups of four: "KX7P 4MRT". People type it with the space, in small letters,
// or with a dash, so sign-in also tries the tidied form.

export const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TEMP_PASSWORD_LENGTH = 8;
export const MIN_PASSWORD_LENGTH = 8;

/** "kx7p 4mrt" -> "KX7P4MRT". */
export function normaliseTemporaryPassword(typed: string): string {
  return typed.replace(/[\s-]/g, '').toUpperCase();
}

/** True when what was typed could be one of our temporary passwords. */
export function looksTemporary(typed: string): boolean {
  const tidy = normaliseTemporaryPassword(typed);
  return tidy.length === TEMP_PASSWORD_LENGTH && [...tidy].every(c => TEMP_PASSWORD_ALPHABET.includes(c));
}

/** The passwords to try, in order: exactly as typed, then the tidied temporary form. */
export function passwordsToTry(typed: string): string[] {
  if (!looksTemporary(typed)) return [typed];
  const tidy = normaliseTemporaryPassword(typed);
  return tidy === typed ? [typed] : [typed, tidy];
}

/** "482 913" -> "482913"; anything that is not 6 digits gives null. */
export function normaliseResetCode(typed: string): string | null {
  const digits = typed.replace(/\s/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** The one-tap token from /signin?token=... (expo-router may give a string or an array). */
export function tokenFromParams(value: string | string[] | undefined): string | null {
  const token = Array.isArray(value) ? value[0] : value;
  return token && token.trim().length >= 20 ? token.trim() : null;
}
