/* Login screen markup + wiring. One of the three mutually exclusive
   states main.ts's render() puts into #root. Not a PageId in the router
   (see app/router.ts): outside the authenticated app shell entirely. */

import { signIn } from "@/app/auth";

export const LOGIN_HTML = `
  <div class="auth-screen">
    <form class="auth-card" id="loginForm" novalidate>
      <div class="auth-brand">
        <span class="leaf">🌱</span>
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
    </form>
  </div>`;

/** Wires the login form. Called by main.ts right after it puts
    LOGIN_HTML into #root - always a brand-new form node (#root was just
    cleared), so binding fresh listeners here every call is correct, not
    an accumulating leak: the previous form and its listeners, if any,
    are already gone with the DOM they were attached to. */
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
        showError(err instanceof Error ? err.message : "Sign-in failed.");
      })
      .finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign in";
      });
    // On success, app/auth.ts's notify() triggers main.ts's render() with
    // "signed-in", which clears #root and replaces this form entirely -
    // nothing to do here in that case.
  });

  emailInput.focus();
}
