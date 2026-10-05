/* AgroFlow Administration Console — entry point.

   Single-root render model: #root holds EXACTLY ONE of three mutually
   exclusive states - loading, signed-out (login), signed-in (the
   dashboard shell) - at any moment. render() always clears #root
   (innerHTML = "") before building the next state into it, so the
   previous state's markup is unconditionally destroyed first. There is
   no display:none/visibility/z-index/CSS-hide path anywhere in this
   flow: if a state isn't current, its markup is not in the DOM, full
   stop - not because something else is hiding it. */

import "@/styles/main.css";
import { SHELL_HTML } from "@/app/shell";
import { initNav, bootRouter, setAfterRender } from "@/app/router";
import { wirePageInteractions, initHeader, updateHeaderIdentity } from "@/app/interactions";
import { initAuth, onAuthChange, isAdminAuthenticated } from "@/app/auth";
import { LOGIN_HTML, wireLogin } from "@/pages/login";
import { WELCOME_HTML, wireWelcome } from "@/pages/welcome";
import { startHealthPolling, stopHealthPolling } from "@/app/health";

declare global {
  interface Window {
    // Defined by the inline script in index.html, before this bundle loads.
    // Optional because a test harness or a stripped page may not have it.
    __agroflowAppReady?: () => void;
  }
}

// Wires up every page's own interactions after each in-session navigation
// (go() -> swapContent -> this) - unrelated to the loading/signed-out/
// signed-in state machine below, and only ever fires once #content
// exists, i.e. while signed in.
setAfterRender(wirePageInteractions);

type ViewState = "loading" | "welcome" | "signed-out" | "signed-in";

/* Whether the visitor has asked to see the login form yet.

   A visitor with no session starts on the landing page and moves to
   "signed-out" (the login form) only by pressing Admin login.

   It is backed by the URL HASH rather than a variable alone, so that:
     * the login form has its own address (#/login) and can be linked to or
       bookmarked by the people who actually use it;
     * a reload of the bare root URL is a fresh arrival and lands on the
       landing page again, which is the lecturer's point - opening the console
       link must not greet you with a password box;
     * and the back button does what it looks like it does.

   Deliberately NOT localStorage: "I once pressed Log in" is not a fact worth
   remembering across visits, and persisting it would reintroduce exactly the
   behaviour being fixed.

   Someone who already has a valid admin session never touches this -
   currentState() returns "signed-in" before this is consulted. */
const LOGIN_HASH = "#/login";

function loginRequestedFromHash(): boolean {
  return window.location.hash === LOGIN_HASH;
}

function getRoot(): HTMLElement {
  const root = document.getElementById("root");
  if (!root) throw new Error("#root is missing from index.html");
  return root;
}

function currentState(): ViewState {
  if (isAdminAuthenticated()) return "signed-in";
  return loginRequestedFromHash() ? "signed-out" : "welcome";
}

function render(state: ViewState): void {
  const root = getRoot();
  root.innerHTML = ""; // unconditional clear - the only way any state's markup ends up in #root

  // Leaving the signed-in shell tears its timers down with it.
  if (state !== "signed-in") stopHealthPolling();

  if (state === "loading") {
    root.innerHTML = `<div class="boot-loading" aria-live="polite">Loading…</div>`;
    return;
  }

  if (state === "welcome") {
    root.innerHTML = WELCOME_HTML;
    wireWelcome(root, () => {
      // Changing the hash is what triggers the re-render, through the
      // hashchange listener in boot(). Setting it here AND rendering would
      // render twice.
      window.location.hash = LOGIN_HASH;
    });
    return;
  }

  if (state === "signed-out") {
    root.innerHTML = LOGIN_HTML;
    wireLogin(root);
    return;
  }

  // signed-in: a fresh #appShell every time (root was just cleared), so
  // re-running these wiring calls on every sign-in is correct, not a
  // double-bind - the previous shell's DOM, and every listener bound
  // directly to it, is already gone. window/document-level listeners
  // (bootRouter's hashchange, initHeader's outside-click) guard
  // themselves against double-binding instead, since window/document are
  // NOT destroyed when #root is cleared - see the idempotency guards in
  // app/router.ts and app/interactions.ts.
  root.innerHTML = SHELL_HTML;
  document.getElementById("sidebarToggle")?.addEventListener("click", () => {
    document.getElementById("sidebar")?.classList.toggle("open");
  });
  initNav();
  initHeader();
  bootRouter();
  updateHeaderIdentity();

  // The sidebar light and the header chip, refreshed every minute. Started
  // here rather than at boot because both elements only exist inside the
  // signed-in shell, and stopped on sign-out so a logged-out tab is not
  // polling an admin-only endpoint it can no longer reach.
  startHealthPolling();
}

async function boot(): Promise<void> {
  render("loading"); // explicit, even though index.html's static #root content already shows this - every state this app can be in goes through render(), no exceptions
  await initAuth();
  render(currentState());

  // #/login <-> landing, and the browser's back button between them. The
  // signed-in app has its own hash routes (#dashboard, #farms, ...) which
  // bootRouter owns; this listener only matters while signed out, so it
  // re-renders only when the current state would actually change.
  window.addEventListener("hashchange", () => {
    if (isAdminAuthenticated()) return;
    render(currentState());
  });

  onAuthChange(() => {
    // Signing out returns to the landing page, not straight back to a login
    // form - the same thing a new visitor sees. Clearing the hash is what
    // does it; the listener above then renders.
    if (!isAdminAuthenticated() && window.location.hash === LOGIN_HASH) {
      window.location.hash = "";
    }
    render(currentState());
  });

  // Tells index.html's loading animation that the app has finished starting:
  // bundle loaded, session check done, first real state rendered. The splash
  // leaves once this AND the video are done - see the script in index.html.
  //
  // Called in a finally-style position so a failed session check still
  // releases it; a visitor must never be left looking at a splash because
  // Supabase was unreachable.
  window.__agroflowAppReady?.();
}

void boot().catch((error: unknown) => {
  console.error("AgroFlow admin failed to start:", error);
  // Same reasoning as above: release the splash even on a failed boot, so
  // whatever the app managed to render is at least visible.
  window.__agroflowAppReady?.();
});
