/* Login screen markup and wiring, plus Forgot password and the new-password page a reset link
 * opens. States main.ts's render() puts into #root. Not PageIds in the router (see
 * app/router.ts): they are outside the signed-in shell. */

import {
  signIn, StaffOnlyError, STAFF_ONLY_MESSAGE, hasNonStaffSession, requestPasswordReset,
  hasRecoverySession, setNewPassword, resetPasswordWithCode,
} from "@/app/auth";
import { appLinksHtml } from "@/lib/downloads";
import { plainError } from "@/lib/plainError";

const BRAND = `
      <div class="auth-brand">
        <!-- The real app icon, the same one on the farmer's phone - so the
             console looks like part of the same product rather than a
             separate tool that happens to share a name. Relative path: the
             site is served from a sub-path on GitHub Pages. -->
        <img class="auth-logo" src="brand/agroflow-icon-192.png" alt="" width="68" height="68" />
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
      <p class="auth-ok" id="loginNotice" role="status" hidden></p>

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
      <p class="muted">Enter the email you sign in with. We send a code to your AgroFlow Telegram.</p>

      <label class="drawer-field">
        <span>Email</span>
        <input type="email" id="forgotEmail" autocomplete="username" required />
      </label>

      <p class="auth-error" id="forgotError" hidden></p>
      <p class="auth-ok" id="forgotSent" role="status" hidden></p>

      <button type="submit" class="btn auth-submit" id="forgotSubmit">Send code</button>

      <div id="forgotCodeStep" hidden>
        <label class="drawer-field">
          <span>6-digit code from Telegram</span>
          <input type="text" id="forgotCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7" />
        </label>
        <label class="drawer-field">
          <span>New password</span>
          <input type="password" id="forgotNewPassword" autocomplete="new-password" minlength="8" />
        </label>
        <p class="auth-error" id="forgotCodeError" hidden></p>
        <button type="button" class="btn auth-submit" id="forgotChange">Change password</button>
      </div>

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

  // Clearing the hash drops #/login, which main.ts's hashchange listener
  // renders as the landing page.
  root.querySelector<HTMLButtonElement>("#loginBackHome")?.addEventListener("click", () => {
    window.location.hash = "";
  });

  wireForgot(root, form, emailInput);

  emailInput.focus();
}

/* Forgot password: same card, swapped. The answer is the same whether or not the email has an
 * account, so the form cannot be used to find out who has one. Then the code from Telegram and
 * a new password; staff with no Telegram get an email link instead (the ?reset=1 page). */
function wireForgot(root: HTMLElement, loginForm: HTMLFormElement, loginEmail: HTMLInputElement): void {
  const form = root.querySelector<HTMLFormElement>("#forgotForm");
  const email = root.querySelector<HTMLInputElement>("#forgotEmail");
  const errorEl = root.querySelector<HTMLElement>("#forgotError");
  const sent = root.querySelector<HTMLElement>("#forgotSent");
  const submit = root.querySelector<HTMLButtonElement>("#forgotSubmit");
  const codeStep = root.querySelector<HTMLElement>("#forgotCodeStep");
  const code = root.querySelector<HTMLInputElement>("#forgotCode");
  const newPassword = root.querySelector<HTMLInputElement>("#forgotNewPassword");
  const codeError = root.querySelector<HTMLElement>("#forgotCodeError");
  const change = root.querySelector<HTMLButtonElement>("#forgotChange");
  if (!form || !email || !errorEl || !sent || !submit || !codeStep || !code || !newPassword || !codeError || !change) return;

  root.querySelector<HTMLButtonElement>("#loginForgot")?.addEventListener("click", () => {
    loginForm.hidden = true;
    form.hidden = false;
    email.value = loginEmail.value.trim();
    errorEl.hidden = true;
    sent.hidden = true;
    codeStep.hidden = true;
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
      .then((message) => {
        sent.textContent = `${message} Staff with no Telegram: we email you a reset link instead.`;
        sent.hidden = false;
        codeStep.hidden = false;
        submit.textContent = "Send a new code";
        code.focus();
      })
      .catch((err: unknown) => {
        errorEl.textContent = plainError(err, "The code could not be sent. Try again in a minute.");
        errorEl.hidden = false;
        submit.textContent = "Send code";
      })
      .finally(() => {
        submit.disabled = false;
      });
  });

  change.addEventListener("click", () => {
    codeError.hidden = true;
    const digits = code.value.replace(/\s/g, "");
    if (!/^\d{6}$/.test(digits)) {
      codeError.textContent = "Enter the 6-digit code from Telegram.";
      codeError.hidden = false;
      return;
    }
    if (newPassword.value.length < 8) {
      codeError.textContent = "Use at least 8 characters for your new password.";
      codeError.hidden = false;
      return;
    }
    change.disabled = true;
    change.textContent = "Changing…";
    void resetPasswordWithCode(email.value.trim(), digits, newPassword.value)
      .then((message) => {
        form.hidden = true;
        loginForm.hidden = false;
        loginEmail.value = email.value.trim();
        const notice = root.querySelector<HTMLElement>("#loginNotice");
        if (notice) {
          notice.textContent = message;
          notice.hidden = false;
        }
        root.querySelector<HTMLInputElement>("#loginPassword")?.focus();
      })
      .catch((err: unknown) => {
        codeError.textContent = plainError(err, "The password could not be changed. Try again.");
        codeError.hidden = false;
      })
      .finally(() => {
        change.disabled = false;
        change.textContent = "Change password";
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
      <p class="muted">Reset links work once and only for a short time. Ask for a new one from the sign-in page.</p>
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
