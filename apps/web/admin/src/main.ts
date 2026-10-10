/* AgroFlow Administration Console: entry point.
 * #root holds exactly one of three states at a time: loading, signed-out (login) or
 * signed-in (the dashboard shell). render() clears #root before building the next state,
 * so a state that is not current is not in the DOM at all (nothing is just hidden). */

import "@/styles/main.css";
import { SHELL_HTML } from "@/app/shell";
import { initNav, bootRouter, setAfterRender } from "@/app/router";
import { wirePageInteractions, initHeader, updateHeaderIdentity } from "@/app/interactions";
import { initAuth, onAuthChange, isAdminAuthenticated, signOut } from "@/app/auth";
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

// Wires up each page's interactions after every in-session navigation (go() ->
// swapContent -> this). Separate from the state machine below; only fires while signed in.
setAfterRender(wirePageInteractions);

type ViewState = "loading" | "welcome" | "signed-out" | "signed-in";

/* Whether the visitor has asked to see the login form yet.
 * A visitor with no session starts on the landing page and gets the login form only by
 * pressing Admin login. It is kept in the URL hash, so #/login can be bookmarked, a reload
 * of the bare URL lands on the landing page again (the console link must not open on a
 * password box), and the back button works. Not in localStorage on purpose: it is not worth
 * remembering across visits.
 * A visitor with a valid admin session never reaches this; currentState() returns
 * "signed-in" first. */
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

/* The state #root is currently showing. render() records it, so an auth event
   that does not change it can be told apart from one that does. */
let shownState: ViewState | null = null;

function render(state: ViewState): void {
  shownState = state;
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

  // signed-in: #root was just cleared, so this is a new #appShell and its wiring can run on
  // every sign-in; the old shell's listeners went with its DOM. window/document listeners
  // (bootRouter's hashchange, initHeader's outside-click) stay, so they guard against double
  // binding themselves (see app/router.ts and app/interactions.ts).
  root.innerHTML = SHELL_HTML;
  document.getElementById("sidebarToggle")?.addEventListener("click", () => {
    document.getElementById("sidebar")?.classList.toggle("open");
  });
  initNav();
  initHeader();
  // Log out, in the sidebar footer and the avatar menu: ends the Supabase session, then shows
  // the landing page with a clean address. onAuthChange below renders it; replaceState drops
  // the old #page without firing hashchange, so nothing renders twice.
  root.querySelectorAll<HTMLButtonElement>("[data-logout]").forEach((button) =>
    button.addEventListener("click", () => {
      document.getElementById("avatarMenu")?.classList.remove("open");
      void signOut().then(() => {
        history.replaceState(null, "", window.location.pathname + window.location.search);
        if (shownState !== "welcome") render(currentState());
      });
    }),
  );
  bootRouter();
  updateHeaderIdentity();

  // The sidebar light and header chip, refreshed every minute. Started here because both only
  // exist in the signed-in shell, and stopped on sign-out so a logged-out tab does not poll an
  // admin-only endpoint.
  startHealthPolling();
}

async function boot(): Promise<void> {
  render("loading"); // explicit, even though index.html's static #root content already shows this - every state this app can be in goes through render(), no exceptions
  await initAuth();
  render(currentState());

  // #/login <-> landing, and the back button between them. The signed-in app's hash routes
  // (#dashboard, #farms, ...) belong to bootRouter; this listener only matters while signed
  // out, so it re-renders only when the state would change.
  window.addEventListener("hashchange", () => {
    if (isAdminAuthenticated()) return;
    const next = currentState();
    if (next !== shownState) render(next);
    else if (next === "welcome" && window.location.hash === "#enquire") {
      // Anchor links on the public page do not rebuild it. Expand the collapsed contact form on
      // same-page navigation.
      document.getElementById("enquiryOpen")?.click();
    }
  });

  onAuthChange(() => {
    // Signing out goes to the landing page, not a login form, the same as a new visitor sees.
    // Clearing the hash does it; the listener above renders.
    if (!isAdminAuthenticated() && window.location.hash === LOGIN_HASH) {
      window.location.hash = "";
    }

    const next = currentState();

    /* Still signed in: refresh the name in the header and rebuild nothing. supabase-js sends
     * many auth events while signed in (TOKEN_REFRESHED on a timer, SIGNED_IN when the tab gets
     * focus), so we rebuild the shell only when the state changes: signing in or out. */
    if (next === "signed-in" && shownState === "signed-in") {
      updateHeaderIdentity();
      return;
    }

    render(next);
  });

  // Tells index.html's loading animation that the app has started: bundle loaded, session
  // checked, first state rendered. The splash leaves once this and the video are done (see
  // the script in index.html). In a finally-style spot so a failed session check still
  // releases it; nobody should be stuck on a splash because Supabase was unreachable.
  window.__agroflowAppReady?.();
}

void boot().catch((error: unknown) => {
  console.error("AgroFlow admin failed to start:", error);
  // Release the splash even on a failed boot, so whatever did render is visible.
  window.__agroflowAppReady?.();
});
