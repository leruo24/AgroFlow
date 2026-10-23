/* Login screen markup and wiring, plus Forgot password and the new-password page a reset link
 * opens. States main.ts's render() puts into #root. Not PageIds in the router (see
 * app/router.ts): they are outside the signed-in shell. */

import {
  signIn, StaffOnlyError, STAFF_ONLY_MESSAGE, hasNonStaffSession, requestPasswordReset,
  hasRecoverySession, setNewPassword,
} from "@/app/auth";
import { appLinksHtml } from "@/lib/downloads";
import { plainError } from "@/lib/plainError";
import { brandHtml } from "@/ui/brand";

const BRAND = `
      <div class="auth-brand">
        <!-- The real app icon, the same one on the farmer's phone - so the
             console looks like part of the same product rather than a
             separate tool that happens to share a name. Relative path: the
             site is served from a sub-path on GitHub Pages. -->
        ${brandHtml("visual-brand", "")}
        <h1>AgroFlow</h1>
        <p class="muted">Staff sign-in</p>
      </div>`;

/* Shown instead of an error when a farmer's login reaches the console: where the app is. */
const STAFF_ONLY_HTML = `
      <div class="auth-staff-only" id="loginStaffOnly" role="alert" hidden>
        <p><b>${STAFF_ONLY_MESSAGE}</b></p>
        ${appLinksHtml()}
      </div>`;

export const LOGIN_HTML = `
  <div class="auth-screen">
    <form class="auth-card" id="loginForm" novalidate>
      ${BRAND}

      ${STAFF_ONLY_HTML}

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

      <p class="auth-back">
        <button type="button" id="loginForgot">Forgot password?</button>
      </p>

      <!-- A way out. Someone who followed the console link and is not staff
           had no route back to the page that explains what AgroFlow is - the
           login card was a dead end. -->
      <p class="auth-back">
        <button type="button" id="loginBackHome">Back to home</button>
      </p>
    </form>

    <form class="auth-card" id="forgotForm" novalidate hidden>
      ${BRAND}
      <h2 class="auth-title">Reset your password</h2>
      <p class="muted">Enter the email you sign in with. We email you a link to choose a new password.</p>

      <label class="drawer-field">
        <span>Email</span>
        <input type="email" id="forgotEmail" autocomplete="username" required />
      </label>

      <p class="auth-error" id="forgotError" hidden></p>
      <p class="auth-ok" id="forgotSent" role="status" hidden></p>

      <button type="submit" class="btn auth-submit" id="forgotSubmit">Send reset link</button>

      <p class="auth-back">
        <button type="button" id="forgotBack">Back to sign in</button>
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
  const staffOnly = root.querySelector<HTMLElement>("#loginStaffOnly");
  if (!form || !emailInput || !passwordInput || !errorEl || !submitBtn || !staffOnly) return;

  const showError = (message: string): void => {
    errorEl.textContent = message;
    errorEl.hidden = false;
  };
  const clearError = (): void => {
    errorEl.hidden = true;
    errorEl.textContent = "";
    staffOnly.hidden = true;
  };

  // A farmer already signed in to the web app on this site: tell them now, before they type.
  if (hasNonStaffSession()) staffOnly.hidden = false;

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
        if (err instanceof StaffOnlyError) {
          staffOnly.hidden = false;
          passwordInput.value = "";
          return;
        }
        showError(plainError(err, "Sign-in failed."));
      })
      .finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign in";
      });
    // On success, app/auth.ts's notify() makes main.ts render "signed-in", which replaces this
    // form, so there is nothing to do here.
  });

  // The product site is the site's root address, a separate page from /staff/.
  root.querySelector<HTMLButtonElement>("#loginBackHome")?.addEventListener("click", () => {
    window.location.assign(new URL("../", window.location.href).pathname);
  });

  wireForgot(root, form, emailInput);

  emailInput.focus();
}

/* Forgot password: same card, swapped. This console is for staff, and staff never use
 * Telegram (docs/telegram-farmers-only.md), so it is always Supabase's email: a link back to
 * this site's ?reset=1 page. The answer is the same whether or not the email has an account,
 * so the form cannot be used to find out who has one. */
function wireForgot(root: HTMLElement, loginForm: HTMLFormElement, loginEmail: HTMLInputElement): void {
  const form = root.querySelector<HTMLFormElement>("#forgotForm");
  const email = root.querySelector<HTMLInputElement>("#forgotEmail");
  const errorEl = root.querySelector<HTMLElement>("#forgotError");
  const sent = root.querySelector<HTMLElement>("#forgotSent");
  const submit = root.querySelector<HTMLButtonElement>("#forgotSubmit");
  if (!form || !email || !errorEl || !sent || !submit) return;

  root.querySelector<HTMLButtonElement>("#loginForgot")?.addEventListener("click", () => {
    loginForm.hidden = true;
    form.hidden = false;
    email.value = loginEmail.value.trim();
    errorEl.hidden = true;
    sent.hidden = true;
    email.focus();
  });

  root.querySelector<HTMLButtonElement>("#forgotBack")?.addEventListener("click", () => {
    form.hidden = true;
    loginForm.hidden = false;
    loginEmail.focus();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    sent.hidden = true;

    const value = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errorEl.textContent = "Enter the email address you sign in with.";
      errorEl.hidden = false;
      return;
    }

    submit.disabled = true;
    submit.textContent = "Sending…";
    void requestPasswordReset(value)
      .then(() => {
        sent.textContent = `If ${value} is an AgroFlow staff account, a reset link is on its way. ` +
          "Check your inbox and your spam folder. The link works once.";
        sent.hidden = false;
      })
      .catch((err: unknown) => {
        errorEl.textContent = plainError(err, "The reset email could not be sent. Try again in a minute.");
        errorEl.hidden = false;
      })
      .finally(() => {
        submit.disabled = false;
        submit.textContent = "Send reset link";
      });
  });
}

/* The page a reset link opens (?reset=1). supabase-js has already turned the link's tokens
 * into a session by the time this renders; no session means the link was used or expired. */
export function resetPasswordHtml(): string {
  if (!hasRecoverySession()) {
    return `
  <div class="auth-screen">
    <div class="auth-card" id="resetExpired">
      ${BRAND}
      <h2 class="auth-title">This reset link has expired</h2>
      <p class="muted">Reset links work once and only for a short time. Ask for a new one from the sign-in page, and check your spam folder for it.</p>
      <button type="button" class="btn auth-submit" id="resetToLogin">Go to sign in</button>
    </div>
  </div>`;
  }

  return `
  <div class="auth-screen">
    <form class="auth-card" id="resetForm" novalidate>
      ${BRAND}
      <h2 class="auth-title">Choose a new password</h2>

      <label class="drawer-field">
        <span>New password</span>
        <input type="password" id="resetPassword" autocomplete="new-password" minlength="8" required />
      </label>
      <label class="drawer-field">
        <span>Type it again</span>
        <input type="password" id="resetConfirm" autocomplete="new-password" minlength="8" required />
      </label>
      <p class="muted">At least 8 characters.</p>

      <p class="auth-error" id="resetError" hidden></p>

      <button type="submit" class="btn auth-submit" id="resetSubmit">Save new password</button>
    </form>
  </div>`;
}

/** onDone runs after a successful change (or from the expired page): main.ts drops ?reset=1
 *  and shows the console, or the sign-in page for someone who is not staff. */
export function wireResetPassword(root: HTMLElement, onDone: () => void): void {
  root.querySelector<HTMLButtonElement>("#resetToLogin")?.addEventListener("click", onDone);

  const form = root.querySelector<HTMLFormElement>("#resetForm");
  const pw = root.querySelector<HTMLInputElement>("#resetPassword");
  const again = root.querySelector<HTMLInputElement>("#resetConfirm");
  const errorEl = root.querySelector<HTMLElement>("#resetError");
  const submit = root.querySelector<HTMLButtonElement>("#resetSubmit");
  if (!form || !pw || !again || !errorEl || !submit) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const problem = pw.value.length < 8 ? "Use at least 8 characters."
      : pw.value !== again.value ? "The two passwords are not the same."
      : null;
    if (problem) {
      errorEl.textContent = problem;
      errorEl.hidden = false;
      return;
    }

    submit.disabled = true;
    submit.textContent = "Saving…";
    void setNewPassword(pw.value)
      .then(onDone)
      .catch((err: unknown) => {
        errorEl.textContent = plainError(err, "The password could not be saved. Try again.");
        errorEl.hidden = false;
        submit.disabled = false;
        submit.textContent = "Save new password";
      });
  });

  pw.focus();
}
