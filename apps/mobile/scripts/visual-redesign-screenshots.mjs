// Visual redesign evidence at four widths and three languages, including Simple view
// and enlarged text. Fixtures are inherited from the existing screenshot harness. The
// real `expo export --platform web` build, served locally; Supabase and the API are fake
// hosts answered here, with the simulated Mahikeng farm. Usage (from apps/mobile):
//   EXPO_PUBLIC_SUPABASE_URL=https://testproject.supabase.co EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-anon-key \
//   EXPO_PUBLIC_AGROFLOW_API_BASE=https://api.agroflow.test npx expo export --clear --platform web --output-dir <build>
//   node scripts/visual-redesign-screenshots.mjs <build> ../../docs/test-evidence/visual-redesign ../web/admin
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const [, , buildArg, outDir, adminDir, w = "390", h = "844", mode = "all"] =
  process.argv;
const buildDir = path.resolve(buildArg);
const { chromium } = require(
  path.join(path.resolve(adminDir), "node_modules", "playwright-core"),
);

const FAKE_SUPABASE = "https://testproject.supabase.co";
const FAKE_API = "https://api.agroflow.test";
const REVIEW_THEME = process.env.VISUAL_THEME === 'dark' ? 'dark' : 'light';
const themeSuffix = process.env.VISUAL_THEME ? `-${REVIEW_THEME}` : '';
const FARMER = "00000000-0000-4000-8000-0000000000fa";

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
};
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(buildDir, url);
  if (
    !file.startsWith(buildDir) ||
    !fs.existsSync(file) ||
    fs.statSync(file).isDirectory()
  )
    file = path.join(buildDir, "index.html");
  res.writeHead(200, {
    "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
  });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(5196, r));
const BASE = "http://localhost:5196";

const now = new Date();
const ago = (hrs) => new Date(now - hrs * 3600e3).toISOString();
const farmRow = {
  farm_id: 1,
  owner_id: FARMER,
  name: "Mahikeng (Simulated)",
  location: "Mahikeng, North West",
  total_area: 0.5,
  status: "Active",
  latitude: -25.86522,
  longitude: 25.64421,
  is_simulated: true,
};
const zoneRow = (id, name, crop, kit, extra = {}) => ({
  id,
  farm_id: 1,
  name,
  location: "Field",
  crop_type: crop,
  planting_date: "2026-08-26",
  irrigation_mode: "automatic",
  moisture_threshold: 30,
  desired_moisture: 60,
  calibration_dry: kit ? 3900 : null,
  calibration_wet: kit ? 1500 : null,
  max_run_minutes: 8,
  flow_rate_lpm: 6,
  soil_type: "loam",
  area_m2: 60,
  is_simulated: true,
  ...extra,
});
const dashboard = () => ({
  profile: { id: FARMER, name: "Thabo Molefe" },
  farms: [farmRow],
  farm: farmRow,
  zones: [
    zoneRow(1, "Maize", "maize", true),
    zoneRow(2, "Beans", "dry_beans", true),
    zoneRow(3, "Leafy greens", "leafy_veg", false),
  ],
  readings: [1, 2].map((z) => ({
    zone_id: z,
    moisture: 3000,
    temperature: 27.4,
    humidity: 22,
    last_reading_at: ago(0.08),
  })),
  events: [
    {
      id: 1,
      zone_id: 1,
      started_at: ago(5),
      runtime_seconds: 480,
      trigger_source: "auto",
      estimated_litres: 48,
    },
  ],
  usage: [],
  weather: [],
  alerts: [
    {
      id: 1,
      zone_id: 1,
      alert_type: "low_moisture",
      severity: "warning",
      message: "Maize is getting dry.",
      created_at: ago(2),
      is_read: false,
    },
  ],
});
const setup = {
  crop: true,
  plantingDate: true,
  soil: true,
  area: true,
  flowRate: true,
  calibrated: true,
  hasKit: true,
};
const today = {
  farmId: 1,
  day: now.toISOString().slice(0, 10),
  zones: [
    {
      zoneId: 1,
      name: "Maize",
      action: {
        kind: "water",
        text: "Water about 9 min this morning (about 54 L)",
      },
      recommendedMinutes: 9,
      maxRunMinutes: 8,
      why: null,
      confidence: { level: "medium", reason: "Medium." },
      confidenceExplanation: null,
      nextStep: null,
      setup,
    },
    {
      zoneId: 2,
      name: "Beans",
      action: { kind: "skip", text: "No water needed today" },
      why: null,
      confidence: { level: "high", reason: "High." },
      confidenceExplanation: null,
      nextStep: null,
      setup,
    },
  ],
};
const drought = {
  farmId: 1,
  active: true,
  automatic: true,
  override: null,
  since: now.toISOString(),
  reason:
    "Drought mode on: tank about 20% full (drought line 25%); 2 mm of rain forecast over 7 days (less than 5 mm counts as dry).",
  budget: {
    litresLeft: 1000,
    normalDays: 5,
    droughtDays: 8,
    text: "You have about 1 000 L. At normal watering that lasts 5 days; in drought mode it lasts 8 days.",
  },
  summary: "Drought mode on: water Maize fully, Beans at half today.",
  zones: [
    {
      zoneId: 1,
      zoneName: "Maize",
      crop: "maize",
      priority: "full",
      fraction: 1,
      ky: 1.5,
      normalLitres: 42,
      droughtLitres: 42,
      why: "Maize in crop development is very sensitive to a water shortfall (FAO Ky 1.50).",
      irrigationType: "drip",
      efficiencyNote: "",
    },
  ],
  honesty:
    "Worked out from your farm's own tank estimate, soil readings and weather forecast. It is not a drought prediction or an official drought declaration.",
  source: "FAO Irrigation and Drainage Paper 66",
};
function apiAnswer(method, p) {
  if (p === "/api/farmer/dashboard") return dashboard();
  if (p === "/api/farmer/farms/1/today") return today;
  if (p === "/api/farmer/farms/1/drought") return drought;
  if (p === "/api/farmer/farms/1/community")
    return {
      reports: [],
      limit: {
        allowed: true,
        nextAllowedAt: null,
        message: "You can add up to 2 reports every 36 hours. You have 2 left.",
      },
      unverified: "",
    };
  if (p === "/api/farmer/farms/1/setup")
    return {
      farmId: 1,
      farm: {
        name: farmRow.name,
        location: farmRow.location,
        latitude: farmRow.latitude,
        longitude: farmRow.longitude,
        province: "North West",
        town: "Mahikeng",
        waterSource: "tank",
      },
      zones: [1, 2, 3].map((z) => ({
        zoneId: z,
        name: ["Maize", "Beans", "Leafy greens"][z - 1],
        crop: ["maize", "dry_beans", "leafy_veg"][z - 1],
        plantingDate: "2026-08-26",
        soilType: "loam",
        areaM2: 60,
        flowRateLpm: 6,
        irrigationType: "drip",
        maxRunMinutes: 8,
      })),
      tank: { capacityLitres: 5000, estimatedRemainingLitres: 1000 },
    };
  if (p === "/api/farmer/notification-preferences")
    return {
      wateringTelegram: true,
      lowTankTelegram: true,
      droughtTelegram: true,
      communityTelegram: true,
      weatherTelegram: true,
      communityOptIn: true,
      quietStart: null,
      quietEnd: null,
    };
  if (p === "/api/farmer/forecast")
    return {
      farmId: 1,
      zoneId: null,
      zoneName: null,
      message: null,
      days: Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now.getTime() + i * 86400e3);
        return {
          date: d.toISOString().slice(0, 10),
          weekday: d.toLocaleDateString("en-ZA", { weekday: "long" }),
          minC: 14 + (i % 3),
          maxC: 31 + (i % 4),
          rainMm: i === 5 ? 1.5 : 0,
          humidityPercent: 24 + i,
          icon: i === 5 ? "cloud" : "sun",
          advice: i === 0 ? "Water Maize this morning." : null,
        };
      }),
    };
  if (p === "/api/telegram/me") return { linked: true, alertsEnabled: true };
  if (p.startsWith("/api/farmer/weather"))
    return {
      current: { temperature_2m: 31, weather_code: 0 },
      daily: { precipitation_probability_max: [5] },
    };
  if (p.startsWith("/api/farmer/farms/1/tank"))
    return {
      farmId: 1,
      capacityLitres: 5000,
      estimatedRemainingLitres: 1000,
      lastRefillLitres: 1000,
      lastRefilledAt: ago(48),
      latestWaterPh: 6.8,
    };
  const zone = p.match(
    /\/api\/farmer\/zones\/(\d+)\/(hardware|soil-ph|insights|recommended)$/,
  );
  if (zone) {
    const [, id, what] = zone;
    if (what === "hardware")
      return id !== "3"
        ? {
            hardwareId: 1,
            deviceId: "AF-0123456789AB",
            deviceName: "Kit 1",
            online: true,
            lastSeen: ago(0.08),
            tokenStatus: "active",
          }
        : {
            hardwareId: null,
            deviceId: null,
            deviceName: null,
            online: false,
            lastSeen: null,
            tokenStatus: "no device",
          };
    if (what === "soil-ph") return { zoneId: Number(id), entries: [] };
    if (what === "insights") return { insights: [], growth: null };
    return { available: false };
  }
  return method === "GET" ? [] : {};
}

const browser = await chromium.launch();
fs.mkdirSync(outDir, { recursive: true });
const errors = [];
const viewport = { width: Number(w), height: Number(h) };

async function newPage(signedIn, language = "en") {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: "en-ZA",
    timezoneId: "Africa/Johannesburg",
    reducedMotion: "reduce",
  });
  await context.addInitScript(({ language, theme }) => {
    localStorage.setItem("agroflow_language", language);
    localStorage.setItem("agroflow_theme_preference", theme);
    localStorage.setItem(
      "agroflow_app_preferences",
      JSON.stringify({ showPageHelp: true, showRaindropHelper: false }),
    );
  }, { language, theme: REVIEW_THEME });
  if (signedIn)
    await context.addInitScript(
      ({ id }) => {
        if (window.localStorage.getItem("sb-testproject-auth-token")) return;
        const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 365;
        window.localStorage.setItem(
          "sb-testproject-auth-token",
          JSON.stringify({
            access_token:
              btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) +
              "." +
              btoa(
                JSON.stringify({
                  sub: id,
                  aud: "authenticated",
                  role: "authenticated",
                  exp,
                }),
              ) +
              ".fixture-signature",
            refresh_token: "test-refresh-token",
            token_type: "bearer",
            expires_in: 3600 * 24 * 365,
            expires_at: exp,
            user: {
              id,
              aud: "authenticated",
              role: "authenticated",
              email: "thabo@example.org",
              app_metadata: {},
              user_metadata: { name: "Thabo Molefe" },
              created_at: new Date().toISOString(),
            },
          }),
        );
        window.localStorage.setItem(
          `agroflow_setup:v2:${id}`,
          JSON.stringify({
            languageConfirmed: true,
            telegramDeclined: false,
            skipped: [],
            unsent: [],
            confirmed: ["location"],
            locationFlagged: false,
          }),
        );
      },
      { id: FARMER },
    );
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    };
    if (url.origin === BASE) return route.continue();
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    const json = (body) =>
      route.fulfill({
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    if (url.origin === FAKE_API)
      return json(apiAnswer(route.request().method(), url.pathname));
    if (url.origin === FAKE_SUPABASE) {
      if (url.pathname === "/auth/v1/user")
        return json({
          id: FARMER,
          aud: "authenticated",
          role: "authenticated",
          email: "thabo@example.org",
          app_metadata: {},
          user_metadata: { name: "Thabo Molefe" },
        });
      if (url.pathname === "/rest/v1/profile")
        return json({ must_change_password: false });
      return json([]);
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}

const toBottom = (page) =>
  page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll("div"))) {
      const s = getComputedStyle(el);
      if (
        (s.overflowY === "auto" || s.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight + 4
      )
        el.scrollTop = el.scrollHeight;
    }
  });

const checks = [];
for (const width of [320, 390, 768, 1366].filter(
  (value) =>
    !process.env.VISUAL_WIDTH || String(value) === process.env.VISUAL_WIDTH,
))
  for (const language of ["en", "af", "tn"].filter(
    (value) =>
      !process.env.VISUAL_LANGUAGE || value === process.env.VISUAL_LANGUAGE,
  )) {
    viewport.width = width;
    viewport.height = width === 768 ? 1024 : width === 1366 ? 768 : 844;
    const page = await newPage(true, language);
    for (const [name, url] of [
      ["home", "/"],
      ["zone", "/zone/1"],
      ["tank", "/tank"],
      ["settings", "/settings"],
      ...(process.env.VISUAL_EXTENDED ? [
        ['wizard-existing', '/setup?step=location'], ['irrigation', '/irrigation'],
        ['alerts', '/alerts'], ['history', '/history'], ['reports', '/reports'], ['forecast', '/forecast'],
      ] : []),
    ]) {
      await page.goto(BASE + url);
      await page.waitForTimeout(2800);
      await page.screenshot({
        path: path.join(outDir, `mobile-${name}-${language}${themeSuffix}-${width}.png`),
      });
      checks.push({
        language,
        width,
        screen: name,
        overflow: await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
      });
      if (name === "settings") {
        const toggle = page.getByRole("switch", {
          name:
            language === "af"
              ? "Eenvoudige aansig"
              : language === "tn"
                ? "Pono e e bonolo"
                : "Simple view",
        });
        await toggle.scrollIntoViewIfNeeded();
        await toggle.click();
        await page.goto(BASE + "/");
        await page.waitForTimeout(2000);
        await page.screenshot({
          path: path.join(outDir, `mobile-simple-${language}${themeSuffix}-${width}.png`),
        });
      }
    }
    await page.goto(BASE + "/");
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[dir="auto"]')) {
        const style = getComputedStyle(el);
        el.style.fontSize = parseFloat(style.fontSize) * 2 + "px";
        el.style.lineHeight = parseFloat(style.lineHeight) * 2 + "px";
      }
    });
    await page.screenshot({
      path: path.join(outDir, `mobile-home-${language}${themeSuffix}-${width}-text200.png`),
    });
    await page.context().close();
    console.log(JSON.stringify({ done: width, language }));
  }
console.log(JSON.stringify({ checks, pageErrors: errors }));
await browser.close();
server.close();
