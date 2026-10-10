/* Login screen markup and wiring. One of the three states main.ts's render() puts into
 * #root. Not a PageId in the router (see app/router.ts): it is outside the signed-in shell. */

import { signIn } from "@/app/auth";
import { plainError } from "@/lib/plainError";

export const LOGIN_HTML = `
  <div class="auth-screen">
    <form class="auth-card" id="loginForm" novalidate>
      <div class="auth-brand">
        <!-- The real app icon, the same one on the farmer's phone - so the
             console looks like part of the same product rather than a
             separate tool that happens to share a name. Relative path: the
             site is served from a sub-path on GitHub Pages. -->
        <img class="auth-logo" src="brand/agroflow-icon-192.png" alt="" width="68" height="68" />
        <h1>AgroFlow</h1>
        <p class="muted">Administration console</p>
      </div>

      <label class="drawer-field">
        <span>Email</span>
        <input type="email" id="loginEmail" autocomplete="username" required />
      </label>

      <label class="drawer-field">
        <span>Password</span>
        <input type="password" id="loginPassword" autocomplete="current-password" required />
      </label>

      <p class="auth-error" id="loginError" hidden></p>

      <button type="submit" class="btn auth-submit" id="loginSubmit">Sign in</button>

      <!-- A way out. Someone who followed the console link and is not an
           administrator had no route back to the page that explains what
           AgroFlow is - the login card was a dead end. -->
      <p class="auth-back">
        <button type="button" id="loginBackHome">Back to home</button>
      </p>
    </form>
  </div>`;

/**
 * Wires the login form. main.ts calls it after putting LOGIN_HTML into #root, which was
 * just cleared, so this is always a new form and fresh listeners do not pile up.
 */
export function wireLogin(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>("#loginForm");
  const emailInput = root.querySelector<HTMLInputElement>("#loginEmail");
  const passwordInput = root.querySelector<HTMLInputElement>("#loginPassword");
  const errorEl = root.querySelector<HTMLElement>("#loginError");
  const submitBtn = root.querySelector<HTMLButtonElement>("#loginSubmit");
  if (!form || !emailInput || !passwordInput || !errorEl || !submitBtn) return;

  const showError = (message: string): void => {
    errorEl.textContent = message;
    errorEl.hidden = false;
  };
  const clearError = (): void => {
    errorEl.hidden = true;
    errorEl.textContent = "";
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearError();

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      showError("Enter your email and password.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";

    void signIn(email, password)
      .catch((err: unknown) => {
        showError(plainError(err, "Sign-in failed."));
      })
      .finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign in";
      });
    // On success, app/auth.ts's notify() makes main.ts render "signed-in", which replaces this
    // form, so there is nothing to do here.
  });

  // Clearing the hash drops #/login, which main.ts's hashchange listener
  // renders as the landing page.
  root.querySelector<HTMLButtonElement>("#loginBackHome")?.addEventListener("click", () => {
    window.location.hash = "";
  });

  emailInput.focus();
}
