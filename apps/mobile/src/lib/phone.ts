// The one phone rule (AF-20), the same as the server's PhoneRules / EnquiryRules.NormalisePhone:
// a South African number written any of the usual ways, national number starting 1-8, and not one
// digit repeated (so 000 000 0000 fails here, before the server has to say so). The same cases are
// checked on both sides from docs/audit/fixtures/phone-cases.json. Well formed is not proof that
// the person owns the number.

export const PHONE_EXAMPLE = '082 123 4567';
export const PHONE_MESSAGE = `Please give a South African phone number, for example ${PHONE_EXAMPLE}.`;

/** +27XXXXXXXXX, or null when it is not a South African number. */
export function normalisePhone(phone: string | null | undefined): string | null {
  const trimmed = (phone ?? '').trim();
  if (!trimmed || !/^\+?[\d\s\-()]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  let national: string;
  if (digits.startsWith('27') && digits.length === 11) national = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 10) national = digits.slice(1);
  else return null;
  if (national[0] < '1' || national[0] > '8') return null;
  if (new Set(national).size === 1) return null;
  return `+27${national}`;
}

/** Null when fine; otherwise the sentence for the field. */
export function phoneProblem(phone: string | null | undefined): string | null {
  return normalisePhone(phone) ? null : PHONE_MESSAGE;
}
