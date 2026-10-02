/* Welcome screen - what anyone who is not signed in sees first.

   A fourth mutually exclusive state for main.ts's render(), alongside
   loading / signed-out / signed-in. It is deliberately NOT a PageId in the
   router (see app/router.ts): like the login screen it sits outside the
   authenticated app shell entirely.

   It changes nothing about how signing in works. The "Log in" button only asks
   main.ts to render the existing login screen; auth.ts and pages/login.ts are
   untouched, so a visitor who already has a valid admin session never sees this
   screen at all - render() sends them straight to the dashboard.

   No images and no CDN: the background is two CSS radial gradients and one
   inline SVG, so it works on GitHub Pages under any base path. */

import { Icon } from "@/lib/icons";

export const WELCOME_HTML = `
  <div class="welcome-screen">
    <!-- Decorative only: hidden from assistive tech, which should hear the
         headline first, not a description of a background. -->
    <svg class="welcome-bg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"
         aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="welcomeField" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.08" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <!-- Soft contour bands, suggesting cultivated land without drawing a
           literal picture of it. -->
      <path d="M0 560 C 220 500, 420 600, 640 545 S 1000 470, 1200 530 L1200 800 L0 800 Z"
            fill="url(#welcomeField)" />
      <path d="M0 650 C 260 600, 480 690, 700 640 S 1020 580, 1200 630 L1200 800 L0 800 Z"
            fill="#ffffff" fill-opacity="0.05" />
    </svg>

    <main class="welcome-card">
      <div class="welcome-brand">
        <span class="welcome-leaf">${Icon.sprout}</span>
        <p class="welcome-eyebrow">AgroFlow</p>
      </div>

      <h1 class="welcome-headline">Welcome to AgroFlow Admin</h1>

      <p class="welcome-sub">
        Help farmers water smarter. Monitor every zone, respond to requests, and
        keep farms running.
      </p>

      <ul class="welcome-points">
        <li>Register farms and zones</li>
        <li>Track live soil moisture</li>
        <li>Act on alerts and insights</li>
      </ul>

      <button type="button" class="btn welcome-login" id="welcomeLogin">Log in</button>
    </main>
  </div>`;

/** Wires the welcome screen's one control. Called by main.ts right after it
    puts WELCOME_HTML into #root - always a brand-new node, since #root was
    just cleared, so binding a fresh listener here on every call is correct
    rather than an accumulating leak. */
export function wireWelcome(root: HTMLElement, onLogin: () => void): void {
  const button = root.querySelector<HTMLButtonElement>("#welcomeLogin");
  if (!button) return;

  button.addEventListener("click", onLogin);

  // A real <button> is already keyboard-operable and in the tab order; moving
  // focus to it means a keyboard or screen-reader user lands on the only thing
  // there is to do here instead of having to tab in from the top.
  button.focus();
}
