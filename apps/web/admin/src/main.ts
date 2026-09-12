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

// Wires up every page's own interactions after each in-session navigation
// (go() -> swapContent -> this) - unrelated to the loading/signed-out/
// signed-in state machine below, and only ever fires once #content
// exists, i.e. while signed in.
setAfterRender(wirePageInteractions);

type ViewState = "loading" | "signed-out" | "signed-in";

function getRoot(): HTMLElement {
  const root = document.getElementById("root");
  if (!root) throw new Error("#root is missing from index.html");
  return root;
}

function currentState(): ViewState {
  return isAdminAuthenticated() ? "signed-in" : "signed-out";
}

function render(state: ViewState): void {
  const root = getRoot();
  root.innerHTML = ""; // unconditional clear - the only way any state's markup ends up in #root

  if (state === "loading") {
    root.innerHTML = `<div class="boot-loading" aria-live="polite">Loading…</div>`;
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
}

async function boot(): Promise<void> {
  render("loading"); // explicit, even though index.html's static #root content already shows this - every state this app can be in goes through render(), no exceptions
  await initAuth();
  render(currentState());
  onAuthChange(() => render(currentState()));
}

void boot();
