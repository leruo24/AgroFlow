/* Which navigation is current, and cancelling the reads of the ones that are not.
 * When the admin clicks quickly, a page clicked first can answer last and paint over the
 * newer one. This module holds a token saying which navigation is current, and an
 * AbortController per navigation, so a replaced page's reads are cancelled.
 * It imports only lib/plainError (which imports nothing) on purpose: the router writes to it
 * and the data layer reads from it, and putting it in the router would make an import loop. */

import { isRawNetworkError, networkFailureFor } from "@/lib/plainError";

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

/**
 * The newest navigation has committed its page. Reads started after this (a drawer
 * opening, a button's lookup) belong to the page on screen, so the next click must not
 * cancel them.
 */
export function endNavigation(t: number): void {
  if (t === token) rendering = false;
}

/* Requests that keep running whatever the admin clicks. The status light polls every
 * minute; cancelling it on a page change would just make it stale. */
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

/* `fetch`, but a read made while a navigation is rendering is tied to that navigation and
 * cancelled if the admin clicks somewhere else first.
 * Writes are never cancelled: a save that was asked for must not be lost to an unrelated click.
 * A cancelled read never settles: rejecting it would show an error state or dialog for a
 * page nobody is looking at. The unsettled promise is garbage-collected with that page. */
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

  if (!tieToNavigation) {
    try {
      return await fetch(input, init);
    } catch (error) {
      throw await plainFailure(url, error);
    }
  }

  const signal = controller!.signal;

  try {
    const response = await fetch(input, { ...init, signal });

    // The body is read here, under the same guard. The signal can fire while the body is still
    // streaming, and the caller's own `response.json()` would then throw an AbortError outside
    // this try. Page reads are small enough to buffer; downloads start from a click on a
    // rendered page, so they never come through here.
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
    throw await plainFailure(url, error);
  }
}

/* A request that never completed becomes a NetworkFailure in plain words; anything else
 * (an abort) passes through. */
async function plainFailure(url: string, error: unknown): Promise<unknown> {
  return isRawNetworkError(error) ? networkFailureFor(url, error) : error;
}

/** For error handlers: was this a cancelled navigation, not a real failure? */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
