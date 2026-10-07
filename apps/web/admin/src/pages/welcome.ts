/* The public landing page - what anyone who opens the AgroFlow link sees.

   WHY THIS IS NOT A LOGIN SCREEN
   The console link is shared with people who are not administrators: a
   lecturer, an examiner, a partner at the Cisco Edge Centre, a farmer curious
   about what the app is. Greeting them with an email and password field tells
   them nothing about AgroFlow and gives them nothing to do. This page explains
   the product and keeps "Admin login" as one button for the handful of people
   who need it.

   It is a mutually exclusive state in main.ts's render(), alongside
   loading / signed-out / signed-in - deliberately NOT a PageId in the router
   (see app/router.ts), because like the login screen it sits outside the
   authenticated app shell entirely.

   It changes nothing about how signing in works. "Admin login" only asks
   main.ts to render the existing login screen; auth.ts and pages/login.ts are
   untouched, so a visitor who already has a valid admin session never sees
   this page at all - render() sends them straight to the dashboard.

   NO IMAGES AND NO CDN: the background is inline SVG and CSS gradients, so it
   works on GitHub Pages under any base path and needs no network beyond the
   bundle itself. */

import { Icon } from "@/lib/icons";
import { ENQUIRY_SECTION_HTML, wireEnquiry } from "@/pages/enquiry";
import { initHardwareShowcase } from "@/features/hardware3d";

/* Download links come from configuration so the page can ship before the
   files exist. Each one is HIDDEN ENTIRELY when its variable is unset -
   a "Download" button that 404s is worse than no button, especially on the
   page a lecturer is looking at.

   Vite inlines these at build time, so they are baked into the static site
   and need no runtime lookup. */
const ANDROID_APK_URL = (import.meta.env["VITE_DOWNLOADS_ANDROID_APK_URL"] ?? "").trim();
const WEB_APP_URL = (import.meta.env["VITE_DOWNLOADS_WEB_APP_URL"] ?? "").trim();

const STEPS: { title: string; body: string }[] = [
  {
    title: "Sensors measure the soil",
    body: "A small kit in the field reads how wet the soil is, and the temperature around the crop, every half a minute.",
  },
  {
    title: "AgroFlow checks the crop and the weather",
    body: "We work out how much water that crop needs today from its growth stage and the local forecast, using the FAO-56 method.",
  },
  {
    title: "Farmers get clear advice",
    body: "Plain words on a phone - water now, or wait for the rain - and the pump can run on its own when the soil says so.",
  },
];

const FEATURES: { icon: string; title: string; body: string }[] = [
  { icon: Icon.droplet, title: "Live soil moisture", body: "See how wet every zone is, right now." },
  { icon: Icon.barChart, title: "7-day forecast advice", body: "What the week ahead means for watering, day by day." },
  { icon: Icon.radio, title: "Automatic watering", body: "The pump runs when the soil needs it, within limits you set." },
  { icon: Icon.bell, title: "Alerts on Telegram", body: "Dangerous weather and equipment faults, where you already are." },
  { icon: Icon.wrench, title: "Reports", body: "Water usage and soil records as a PDF, weekly or whenever you ask." },
];

function escapeHtml(value: string): string {
  const map: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

export const WELCOME_HTML = `
  <div class="landing">
    <!-- Decorative only: hidden from assistive tech, which should hear the
         headline first, not a description of a background. -->
    <svg class="landing-bg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"
         aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="landingField" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.10" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 560 C 220 500, 420 600, 640 545 S 1000 470, 1200 530 L1200 800 L0 800 Z"
            fill="url(#landingField)" />
      <path d="M0 650 C 260 600, 480 690, 700 640 S 1020 580, 1200 630 L1200 800 L0 800 Z"
            fill="#ffffff" fill-opacity="0.05" />
    </svg>

    <header class="landing-top">
      <div class="landing-brand">
        <img class="landing-logo" src="brand/agroflow-icon-192.png" alt="" width="40" height="40" />
        <span class="landing-wordmark">AgroFlow</span>
      </div>
      <button type="button" class="btn landing-login-top" id="welcomeLogin">Admin login</button>
    </header>

    <main class="landing-main">
      <section class="landing-hero">
        <h1 class="landing-headline">
          AgroFlow: smart irrigation for South African farmers
        </h1>
        <p class="landing-sub">
          Sensors in the soil, weather from the sky, and simple advice that tells farmers
          exactly when and how much to water.
        </p>
      </section>

      <section class="hardware-showcase" aria-labelledby="hardwareHeading" data-hardware-showcase>
        <header class="hardware-intro">
          <p class="hardware-eyebrow">From prototype to field controller</p>
          <h2 id="hardwareHeading" class="hardware-heading">Inside AgroFlow</h2>
          <p class="hardware-lede">
            Explore a productised view of the hardware behind each AgroFlow irrigation zone.
          </p>
        </header>

        <div class="hardware-story">
          <div class="hardware-story-copy">
            <article class="hardware-stage is-active" data-hardware-stage="0">
              <span class="hardware-stage-number">01</span>
              <h3>Built for the field</h3>
              <p>A protected field unit brings sensing, connectivity and irrigation control together close to the crop.</p>
            </article>

            <article class="hardware-stage" data-hardware-stage="1">
              <span class="hardware-stage-number">02</span>
              <h3>Weatherproof connections</h3>
              <p>Waterproof cable glands organise the soil sensor, DHT11, pump output and power connections at the enclosure edge.</p>
            </article>

            <article class="hardware-stage" data-hardware-stage="2">
              <span class="hardware-stage-number">03</span>
              <h3>Open the controller</h3>
              <p>Lift the removable lid to reveal the ESP32, relay board, sensor interface, terminal connections and clean cable routing.</p>
            </article>

            <article class="hardware-stage" data-hardware-stage="3">
              <span class="hardware-stage-number">04</span>
              <h3>Sense</h3>
              <p>The soil probe and DHT11 measure field conditions. The ESP32 reads those sensors and reports their measurements to the AgroFlow platform.</p>
            </article>

            <article class="hardware-stage" data-hardware-stage="4">
              <span class="hardware-stage-number">05</span>
              <h3>Act</h3>
              <p>Irrigation decisions are sent to the field controller, which uses its relay module to switch the connected pump output.</p>
            </article>

            <article class="hardware-stage hardware-stage-final" data-hardware-stage="5">
              <span class="hardware-stage-number">06</span>
              <h3>From field conditions to irrigation action.</h3>
              <p>One connected unit closes the loop between the crop zone, the AgroFlow platform and controlled watering.</p>
            </article>
          </div>

          <div class="hardware-viewer-column">
            <div class="hardware-viewer" data-hardware-viewer aria-busy="true">
              <div class="hardware-fallback" data-hardware-fallback role="img"
                   aria-label="AgroFlow field controller flow diagram">
                <div class="hardware-fallback-unit" aria-hidden="true">
                  <span>AgroFlow</span>
                  <i></i><i></i><i></i><i></i>
                </div>
                <strong>AgroFlow Field Controller</strong>
                <span>Sensors <b aria-hidden="true">&rarr;</b> ESP32 <b aria-hidden="true">&rarr;</b> Relay <b aria-hidden="true">&rarr;</b> Pump</span>
              </div>

              <div class="hardware-canvas" data-hardware-canvas></div>

              <div class="hardware-hotspots" aria-label="Hardware components">
                <button type="button" data-hardware-hotspot="esp32" aria-controls="hardwareComponentInfo">ESP32 Controller</button>
                <button type="button" data-hardware-hotspot="soil" aria-controls="hardwareComponentInfo">Soil Moisture Sensor</button>
                <button type="button" data-hardware-hotspot="dht" aria-controls="hardwareComponentInfo">DHT11 Sensor</button>
                <button type="button" data-hardware-hotspot="relay" aria-controls="hardwareComponentInfo">Relay Module</button>
                <button type="button" data-hardware-hotspot="pump" aria-controls="hardwareComponentInfo">Pump Output</button>
                <button type="button" data-hardware-hotspot="power" aria-controls="hardwareComponentInfo">Power Input</button>
              </div>

              <div class="hardware-viewer-footer">
                <div class="hardware-component-info" id="hardwareComponentInfo" aria-live="polite">
                  <strong>Explore the controller</strong>
                  <span>Select a component marker to learn what it does.</span>
                </div>
                <div class="hardware-controls" aria-label="3D view controls">
                  <button type="button" data-hardware-rotate="left" aria-label="Rotate product left">&#8634;</button>
                  <button type="button" data-hardware-reset aria-label="Reset product view">Reset view</button>
                  <button type="button" data-hardware-rotate="right" aria-label="Rotate product right">&#8635;</button>
                </div>
              </div>
            </div>
            <p class="hardware-caption">Interactive product visualisation based on the AgroFlow working prototype.</p>
          </div>
        </div>
      </section>

      <section class="landing-section" aria-labelledby="howHeading">
        <h2 id="howHeading" class="landing-h2">How it works</h2>
        <ol class="landing-steps">
          ${STEPS.map((s, i) => `
            <li class="landing-step">
              <span class="landing-step-n" aria-hidden="true">${i + 1}</span>
              <div>
                <h3 class="landing-step-title">${escapeHtml(s.title)}</h3>
                <p class="landing-step-body">${escapeHtml(s.body)}</p>
              </div>
            </li>`).join("")}
        </ol>
      </section>

      <section class="landing-section" aria-labelledby="featuresHeading">
        <h2 id="featuresHeading" class="landing-h2">What it does</h2>
        <ul class="landing-features">
          ${FEATURES.map((f) => `
            <li class="landing-feature">
              <span class="landing-feature-ico" aria-hidden="true">${f.icon}</span>
              <div>
                <h3 class="landing-feature-title">${escapeHtml(f.title)}</h3>
                <p class="landing-feature-body">${escapeHtml(f.body)}</p>
              </div>
            </li>`).join("")}
        </ul>
      </section>

      ${ANDROID_APK_URL || WEB_APP_URL ? `
      <section class="landing-section" aria-labelledby="getHeading">
        <h2 id="getHeading" class="landing-h2">Get the app</h2>
        <div class="landing-downloads">
          ${ANDROID_APK_URL ? `
            <a class="btn landing-download" href="${escapeHtml(ANDROID_APK_URL)}" download>
              Download for Android
            </a>` : ""}
          ${WEB_APP_URL ? `
            <a class="btn ghost landing-download" href="${escapeHtml(WEB_APP_URL)}">
              iPhone: open the web app
            </a>` : ""}
        </div>
        ${WEB_APP_URL ? `
          <p class="landing-note">
            On an iPhone, open the web app in Safari and tap Share then "Add to Home Screen"
            to keep it with your other apps.
          </p>` : ""}
      </section>` : ""}

      ${ENQUIRY_SECTION_HTML}

      <div class="landing-cta">
        <button type="button" class="btn landing-login" id="welcomeLoginBottom">Admin login</button>
      </div>
    </main>
  </div>`;

/* onLogin is called by BOTH login buttons - the one in the header and the one
   at the end of the page. A visitor who has read the whole page should not
   have to scroll back up to act on it. */
export function wireWelcome(root: HTMLElement, onLogin: () => void): void {
  root.querySelectorAll<HTMLButtonElement>("#welcomeLogin, #welcomeLoginBottom")
    .forEach((button) => button.addEventListener("click", onLogin));
  wireEnquiry(root);
  initHardwareShowcase(root);
}
