/* Where farmers get the app, for the public page and the staff-only notice on the login screen.
 * From configuration, so the pages can ship before the files exist; a link whose variable is
 * unset is left out, because a Download button that 404s is worse than none. Vite inlines
 * these at build time. */

import { esc } from "@/lib/format";

export const ANDROID_APK_URL = (import.meta.env["VITE_DOWNLOADS_ANDROID_APK_URL"] ?? "").trim();
// Registered users go straight to login; Get the app remains the download page.
export const WEB_APP_URL = 'https://agroflow-mobile.vercel.app/login';

/** The app links as buttons, or a sentence saying who to ask when neither is configured. */
export function appLinksHtml(): string {
  if (!ANDROID_APK_URL && !WEB_APP_URL) {
    return `<p class="landing-note">Ask your AgroFlow representative for the app, or
      <a href="#enquire">request a call</a> and we will help you get started.</p>`;
  }
  return `
    <div class="landing-downloads">
      ${ANDROID_APK_URL ? `
        <a class="btn landing-download" href="${esc(ANDROID_APK_URL)}" download data-app-link="android">
          Download for Android
        </a>` : ""}
      ${WEB_APP_URL ? `
        <a class="btn ghost landing-download" href="${esc(WEB_APP_URL)}" data-app-link="web">
          iPhone or computer: open the web app
        </a>` : ""}
    </div>`;
}
