/* Times shown to a farmer are always South African time, whatever the phone's own time zone
 * or language. The phone's toLocaleString() is only SAST if the phone is set to it, and its
 * format changes with the language.
 * SAST is UTC+2 all year (no daylight saving), so this is fixed arithmetic with no time-zone data. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SAST_MS = 2 * 60 * 60 * 1000;

/** "6 Oct 2026, 08:05" in SAST, or null for something that is not a time. */
export function formatSast(iso: string | null | undefined): string | null {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + SAST_MS);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}
