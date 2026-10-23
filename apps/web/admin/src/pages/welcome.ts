/* The public product page: what anyone who opens the AgroFlow link sees.
 * The link is shared with people who are not staff (a farmer, a sponsor, a lecturer, a partner
 * at the Cisco Edge Centre), so the page is for customers: what AgroFlow does, how it works,
 * request a call and get the app. Nothing from the console is on it, not even a link to it:
 * staff sign in at the separate /staff/ address (see main.ts).
 * It is one of the states in main.ts's render() and not a PageId in the router (see
 * app/router.ts): it is its own layout, outside the console's shell. */

import { Icon } from "@/lib/icons";
import { renderPublicSite, wirePublicSite } from "./publicSite";

/* The product page's phone screenshots (taken from the app with the simulated Mahikeng farm by
 * apps/mobile/scripts/visual-polish-screenshots.mjs ... product). Each has its own alt text. */
const APP_SHOTS: { file: string; caption: string; alt: string }[] = [
  { file: "home.jpg", caption: "Home",
    alt: "The AgroFlow app's Home screen for Mahikeng (Simulated): setup 11 of 17 done with a Continue button, and the drought card saying about 1 000 litres are left." },
  { file: "sensors.jpg", caption: "Sensor readings",
    alt: "A zone's Sensor Readings card: soil moisture 38% marked Good, temperature 27.4 °C, humidity 22%, water tank 1 000 litres and flow 6 litres a minute, updated 5 minutes ago." },
  { file: "irrigate.jpg", caption: "Water a zone",
    alt: "The zone's irrigation control: Automatic, Scheduled or Manual mode, how many minutes to water, and a Water now button." },
  { file: "alerts.jpg", caption: "Alerts",
    alt: "The Alerts screen listing a simulated alert that the maize zone is getting dry." },
  { file: "setup-location.jpg", caption: "Setup: is this your farm?",
    alt: "A setup step asking 'Is this your farm?' with Mahikeng, North West on a small map and the buttons Looks right and Something's wrong." },
  { file: "setup-irrigation.jpg", caption: "Setup: how is it watered?",
    alt: "A setup step asking how the maize zone is watered, with picture buttons for drip, sprinkler, micro-sprinkler, centre pivot, furrow and by hand." },
  { file: "drought.jpg", caption: "Drought mode",
    alt: "The drought card: drought mode is on, the water budget lasts 5 days at normal watering or 8 days in drought mode, and each zone's priority for today." },
];
import { ENQUIRY_SECTION_HTML, wireEnquiry } from "@/pages/enquiry";
import { initHardwareShowcase } from "@/features/hardware3d";
import { WEB_APP_URL, appLinksHtml } from "@/lib/downloads";

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

const LEGACY_WELCOME_HTML = `
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
      <nav class="landing-nav" aria-label="Public website">
        <a href="#experience">Experience</a>
        <a href="#solutions">Solutions</a>
        <a href="#how-it-works">How it works</a>
        <a href="#technology">Technology</a>
        <a href="#about">About</a>
        <a href="#get-app">Get the app</a>
        <a href="#enquire">Contact</a>
      </nav>
    </header>

    <main class="landing-main">
      <section class="landing-hero">
        <p class="landing-eyebrow">Connected irrigation · practical farm decisions</p>
        <h1 class="landing-headline">
          A smarter way to manage water on your farm.
        </h1>
        <p class="landing-sub">
          AgroFlow brings field conditions, crop needs and irrigation action into one
          clear experience for South African farmers.
        </p>
        <div class="landing-hero-actions">
          <a class="btn" href="#enquire">Request a call</a>
          <a class="btn ghost landing-hero-app" href="#get-app">Get the app</a>
          <a class="landing-text-link" href="#how-it-works">See how it works <span aria-hidden="true">→</span></a>
        </div>
        <ul class="landing-proof" aria-label="AgroFlow system overview">
          <li><b>Field</b><span>Soil and crop conditions</span></li>
          <li><b>Platform</b><span>FAO-56-informed advice</span></li>
          <li><b>Irrigation</b><span>Controlled pump output</span></li>
        </ul>
      </section>

      <section class="landing-experience" id="experience" aria-labelledby="experienceHeading">
        <div class="landing-experience-copy">
          <p class="landing-eyebrow">Experience AgroFlow</p>
          <h2 id="experienceHeading">See irrigation decisions come to life.</h2>
          <p>Explore a live 3D field, respond to AgroFlow's recommendation, start an irrigation cycle and see how changing weather reshapes the plan.</p>
          <button type="button" class="btn landing-experience-launch" data-experience-launch>
            Launch interactive demo <span aria-hidden="true">→</span>
          </button>
          <small>No login, real devices or farm data. This is a deterministic demonstration.</small>
        </div>
        <div class="landing-experience-preview" aria-hidden="true">
          <div class="landing-experience-sky"></div>
          <div class="landing-experience-field">
            <i></i><i></i><i></i><i></i>
          </div>
          <div class="landing-experience-controller"><b>AgroFlow</b><span></span></div>
          <div class="landing-experience-card"><b>WATER TODAY</b><span>8 mm · 1,600 L</span></div>
        </div>
      </section>

      <section class="hardware-showcase" aria-labelledby="hardwareHeading" data-hardware-showcase>
        <header class="hardware-intro">
          <p class="hardware-eyebrow">From prototype to field controller</p>
          <h2 id="hardwareHeading" class="hardware-heading">The AgroFlow field controller</h2>
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
              <h3>Connected to the crop</h3>
              <p>The soil probe enters the root zone, the DHT11 measures the crop microclimate, and protected connections carry power and the pump output.</p>
            </article>

            <article class="hardware-stage" data-hardware-stage="2">
              <span class="hardware-stage-number">03</span>
              <h3>Inside AgroFlow</h3>
              <p>Open the weatherproof side-hinged lid to reveal the ESP32, 5 V relay, soil-sensor interface, protected terminals and routed wiring.</p>
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
            <div class="hardware-viewer" data-hardware-viewer aria-busy="true" style="--hardware-field:url('media/agroflow-field-backdrop.jpg')">
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
                <button type="button" data-hardware-hotspot="esp32" aria-label="ESP32 Controller" aria-controls="hardwareComponentInfo" hidden><span>ESP32 Controller</span></button>
                <button type="button" data-hardware-hotspot="soil" aria-label="Soil Moisture Sensor" aria-controls="hardwareComponentInfo"><span>Soil Moisture Sensor</span></button>
                <button type="button" data-hardware-hotspot="dht" aria-label="Temperature &amp; Humidity Sensor" aria-controls="hardwareComponentInfo"><span>Temperature &amp; Humidity Sensor</span></button>
                <button type="button" data-hardware-hotspot="relay" aria-label="5 V Relay Module" aria-controls="hardwareComponentInfo" hidden><span>5 V Relay Module</span></button>
                <button type="button" data-hardware-hotspot="pump" aria-label="Pump / Irrigation Output" aria-controls="hardwareComponentInfo"><span>Pump / Irrigation Output</span></button>
                <button type="button" data-hardware-hotspot="power" aria-label="Power Input" aria-controls="hardwareComponentInfo"><span>Power Input</span></button>
              </div>

              <div class="hardware-viewer-footer">
                <div class="hardware-component-info" id="hardwareComponentInfo" aria-live="polite">
                  <strong>Explore the controller</strong>
                  <span>Select a component marker to learn what it does.</span>
                </div>
                <div class="hardware-controls" aria-label="3D view controls">
                  <button type="button" data-hardware-rotate="left" aria-label="Rotate product left">&#8634;</button>
                  <button type="button" class="hardware-explore" data-hardware-toggle aria-expanded="false">Explore inside</button>
                  <button type="button" data-hardware-reset aria-label="Reset view">Reset view</button>
                  <button type="button" data-hardware-rotate="right" aria-label="Rotate product right">&#8635;</button>
                </div>
              </div>
            </div>
            <p class="hardware-caption">Interactive product visualisation based on the AgroFlow working prototype.</p>
          </div>
        </div>
      </section>

      <section class="landing-section public-band" id="how-it-works" aria-labelledby="howHeading">
        <p class="landing-eyebrow">How it works</p>
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

      <section class="landing-section" id="solutions" aria-labelledby="featuresHeading">
        <p class="landing-eyebrow">Solutions</p>
        <h2 id="featuresHeading" class="landing-h2">One connected view of every irrigation zone</h2>
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

      <section class="landing-section" id="the-app" aria-labelledby="appShotsHeading">
        <p class="landing-eyebrow">The app</p>
        <h2 id="appShotsHeading" class="landing-h2">What a farmer sees on their phone</h2>
        <p class="app-shots-note">Screens from the AgroFlow app with a simulated farm near Mahikeng. No real farm or person is shown.</p>
        <ul class="app-shots">
          ${APP_SHOTS.map((s) => `
            <li class="app-shot">
              <figure>
                <div class="phone-frame"><img src="media/app/${s.file}" alt="${escapeHtml(s.alt)}" loading="lazy" width="390" height="844" /></div>
                <figcaption>${escapeHtml(s.caption)}</figcaption>
              </figure>
            </li>`).join("")}
        </ul>
      </section>

      <section class="landing-section public-technology" id="technology" aria-labelledby="technologyHeading">
        <div>
          <p class="landing-eyebrow">Technology</p>
          <h2 id="technologyHeading" class="landing-h2">From field sensing to a controlled irrigation output.</h2>
          <p class="landing-step-body">The working prototype uses an ESP32 controller, a YL-69 resistive soil-moisture probe, a DHT11 temperature and humidity sensor, and a 5 V relay output for a connected pump. The node communicates with the AgroFlow API over Wi-Fi.</p>
        </div>
        <ol class="technology-flow" aria-label="AgroFlow technical flow">
          <li><b>Sense</b><span>Soil moisture and crop-zone temperature and humidity</span></li>
          <li><b>Decide</b><span>Farm coordinates, weather and FAO-56 crop-water calculations</span></li>
          <li><b>Act</b><span>ESP32 and relay switch the configured pump output within safety limits</span></li>
        </ol>
      </section>

      <section class="landing-section public-about" id="about" aria-labelledby="aboutHeading">
        <div>
          <p class="landing-eyebrow">About AgroFlow</p>
          <h2 id="aboutHeading" class="landing-h2">Built around the realities of water, distance and field work.</h2>
        </div>
        <p>AgroFlow is a connected smart-irrigation project that helps a farmer understand conditions in each crop zone, make informed watering decisions and keep a clear record of what happened. The current system combines field hardware, a farmer application, an administration console and backend services—without claiming sensors or gateways the prototype does not use.</p>
      </section>

      <section class="landing-section" id="get-app" aria-labelledby="getHeading">
        <p class="landing-eyebrow">For farmers</p>
        <h2 id="getHeading" class="landing-h2">Get the app</h2>
        <p class="landing-step-body">Already an AgroFlow farmer? Sign in on your phone with the
          email and password your AgroFlow representative gave you.</p>
        ${appLinksHtml()}
        ${WEB_APP_URL ? `
          <p class="landing-note">
            On an iPhone, open the web app in Safari and tap Share then "Add to Home Screen"
            to keep it with your other apps.
          </p>` : ""}
      </section>

      ${ENQUIRY_SECTION_HTML}

    </main>
    <footer class="landing-footer">
      <span>AgroFlow</span><span>Smart irrigation for real growing areas.</span>
    </footer>
  </div>`;

export const WELCOME_HTML = /\/staff(\/(index\.html)?)?$/.test(window.location.pathname) ? "" : renderPublicSite(LEGACY_WELCOME_HTML);

export function wireWelcome(root: HTMLElement): void {
  wirePublicSite(root);
  wireEnquiry(root);
  initHardwareShowcase(root);
  root.querySelector<HTMLButtonElement>("[data-experience-launch]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = "Preparing the field…";
    try {
      const { mountExperience } = await import("@/experience/mount");
      mountExperience(button);
    } finally {
      button.disabled = false;
      button.innerHTML = 'Launch interactive demo <span aria-hidden="true">→</span>';
    }
  });
}
