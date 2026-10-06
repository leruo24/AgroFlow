/* Which navigation is current, and cancelling the reads of the ones that aren't.
 *
 * WHY THIS EXISTS (item 0b)
 * Clicking quickly made the console cycle through pages on its own. A test
 * with a backend answering in random order showed eight clicks producing
 * seventy-five hash changes. Three things compounded:
 *
 *   1. Every sidebar click navigated TWICE: the click called go(), and go()
 *      wrote location.hash, which fired hashchange, which called go() again.
 *   2. Nothing marked a navigation as superseded. A page clicked first could
 *      answer last and paint over the page clicked after it.
 *   3. When that stale page finished, it wrote ITS hash back - firing another
 *      hashchange for a page nobody wanted any more, which started the whole
 *      thing again. That loop is the "vibration".
 *
 * The fix has three parts, and this module is the shared half of two of them:
 * a token that says which navigation is current, and an AbortController per
 * navigation so the reads a superseded page started are cancelled rather than
 * left to finish and be thrown away.
 *
 * It imports nothing, on purpose. The router writes to it and the data layer
 * reads from it, and the router already imports every page - if this lived in
 * the router, the data layer importing it would close a loop.
 */

let token = 0;
let controller: AbortController | null = null;
let rendering = false;

/** Starts a navigation: supersedes the previous one and cancels its reads. */
export function beginNavigation(): number {
  token += 1;
  controller?.abort();
  controller = new AbortController();
  rendering = true;
  return token;
}

/** True while `t` is still the newest navigation. */
export function isCurrentNavigation(t: number): boolean {
  return t === token;
}

/** The newest navigation has committed its page. Reads started after this
    point - a drawer opening, a button's lookup - belong to the page the admin
    is looking at, not to a navigation, and must not be cancelled by the next
    click. */
export function endNavigation(t: number): void {
  if (t === token) rendering = false;
}

/* Requests that keep running whatever the admin clicks. The platform status
   light polls every minute; cancelling its request because somebody changed
   page would just make the light go stale. */
const BACKGROUND = ["/api/admin/health"];

function isRead(init: RequestInit | undefined, input: RequestInfo | URL): boolean {
  const method =
    init?.method ?? (typeof input === "object" && "method" in input ? input.method : undefined) ?? "GET";
  return method.toUpperCase() === "GET";
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/* `fetch`, except that a READ issued while a navigation is rendering is tied to
 * that navigation, and cancelled if the admin clicks somewhere else first.
 *
 * WHY WRITES ARE NEVER CANCELLED
 * A save in flight when somebody clicks the sidebar has still been asked for.
 * Cancelling it would lose the admin's work to a click that had nothing to do
 * with it.
 *
 * WHY A CANCELLED READ NEVER SETTLES
 * Rejecting it would send an AbortError into the page that asked - and most
 * pages turn a failed read into an error state, a console.error or an error
 * dialog. For a page that has already been superseded, all three are wrong:
 * nobody is looking at it. A promise that never settles simply abandons that
 * render where it stands. Nothing holds on to it, so it is collected with the
 * rest of the superseded page.
 */
export async function navigationAwareFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = urlOf(input);
  const tieToNavigation =
    rendering &&
    controller !== null &&
    isRead(init, input) &&
    !BACKGROUND.some((path) => url.includes(path)) &&
    // Auth traffic is never cancelled: a token refresh abandoned half-way
    // would sign the admin out.
    !url.includes("/auth/v1/");

  if (!tieToNavigation) return fetch(input, init);

  const signal = controller!.signal;

  try {
    const response = await fetch(input, { ...init, signal });

    // The body is read HERE, under the same guard. The signal can fire after
    // the headers arrive but while the body is still streaming, and then the
    // caller's own `response.json()` would throw an AbortError outside this
    // try - exactly the noise this exists to prevent. These are page reads,
    // small enough to buffer; downloads are started from a click on a page
    // that has already rendered, so they never reach this path.
    const body = await response.arrayBuffer();

    // The Response constructor throws for a body on these statuses, which
    // the API does use (204 from a delete).
    const nullBodyStatus = response.status === 204 || response.status === 205 || response.status === 304;

    return new Response(nullBodyStatus ? null : body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    if (signal.aborted) return new Promise<Response>(() => undefined);
    throw error;
  }
}

/** For error handlers: was this a cancelled navigation, not a real failure? */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
