/* Plain words when the network fails (admin polish, item 7).
 *
 * A browser that cannot complete a request says "Failed to fetch" (Chrome),
 * "NetworkError when attempting to fetch resource." (Firefox) or "Load failed"
 * (Safari), and supabase-js passes that on as "TypeError: Failed to fetch".
 * None of that tells an admin what to do. Every request goes through
 * navigationAwareFetch (lib/navigation.ts), which turns such a failure into a
 * NetworkFailure carrying one of the two sentences below; the places that
 * show an error (error cards, toasts, the login and enquiry forms) pass their
 * text through plainError(), which also catches any raw browser wording that
 * reached them another way. The technical detail goes to the console only.
 *
 * Telling an ad blocker from a dead server: a browser does not let a page see
 * "blocked by client", so after a failure AgroFlow asks the API's anonymous
 * /api/public/ping - a different path. If that answers, the server is up and
 * something in the browser stopped the first request. */

export const SERVER_UNREACHABLE =
  "AgroFlow's server can't be reached right now. Check your internet, then press Retry.";
export const BLOCKED_BY_EXTENSION =
  "A browser extension (like an ad blocker) may be blocking AgroFlow. Turn it off for this site and press Retry.";

const RAW_NETWORK = /failed to fetch|networkerror when attempting|load failed|network request failed|fetch failed|err_blocked_by_client|err_internet_disconnected|err_connection_refused/i;

export class NetworkFailure extends Error {
  constructor(public readonly blocked: boolean) {
    super(blocked ? BLOCKED_BY_EXTENSION : SERVER_UNREACHABLE);
    this.name = "NetworkFailure";
  }
}

/** True for the browser's own "the request never completed" errors. */
export function isRawNetworkError(error: unknown): boolean {
  if (error instanceof NetworkFailure) return false;
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
  return RAW_NETWORK.test(text);
}

const API_BASE = (import.meta.env["VITE_AGROFLOW_API_BASE"] ?? "").trim();
const PING = `${API_BASE}/api/public/ping`;

// One probe answers for every request that failed at about the same time
// (a page load fires several; supabase-js retries reads).
let probe: { at: number; result: Promise<boolean> } | null = null;

async function pingAnswers(): Promise<boolean> {
  try {
    const res = await fetch(PING, { method: "GET", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Builds the plain error for a failed request, logging the technical one. */
export async function networkFailureFor(url: string, error: unknown): Promise<NetworkFailure> {
  const now = Date.now();
  if (!probe || now - probe.at > 3000) probe = { at: now, result: pingAnswers() };
  // The ping itself failing proves nothing about a block.
  const blocked = !url.includes("/api/public/ping") && (await probe.result);
  console.warn(`AgroFlow: a request to ${url} did not complete${blocked ? " (the server answered a ping, so the browser likely blocked it)" : ""}.`, error);
  return new NetworkFailure(blocked);
}

/** The text to show a person for an error or an error's message. */
export function plainError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  // A supabase-js error is not always an Error instance, but has a message.
  const text = typeof error === "string" ? error
    : error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message : "";
  // supabase-js prefixes the name ("NetworkFailure: ..."): keep only ours.
  if (text.includes(BLOCKED_BY_EXTENSION)) return BLOCKED_BY_EXTENSION;
  if (text.includes(SERVER_UNREACHABLE)) return SERVER_UNREACHABLE;
  if (RAW_NETWORK.test(text) || (error instanceof Error && RAW_NETWORK.test(error.name))) {
    console.warn("AgroFlow: network error shown in plain words:", error);
    return SERVER_UNREACHABLE;
  }
  return text || fallback;
}
