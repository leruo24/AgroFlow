// Deep-link refresh and security-header check against a production build, served the way
// Vercel serves it: a real file first (/staff/ -> staff/index.html, /admin/ ->
// admin/index.html), then the vercel.json rewrites, otherwise 404, with the vercel.json
// headers on every response. Vite's dev server falls back to index.html for any path and
// sends none of the headers, so it cannot show this. Fake service hosts only: every request
// that is not to this local server is answered locally, and nothing live is contacted.
//
// Staff and public site (apps/web/admin), built with the Playwright suite's fake hosts:
//   VITE_SUPABASE_URL=https://testproject.supabase.co VITE_SUPABASE_ANON_KEY=test-anon-key \
//   VITE_AGROFLOW_API_BASE=https://api.agroflow.test npm run build && node scripts/check-deep-links.mjs
// Farmer web app (apps/mobile), exported with the same fake hosts and --clear (Metro can keep
// an earlier export's EXPO_PUBLIC_ values in its cache, and the app then falls back to :5080):
//   EXPO_PUBLIC_SUPABASE_URL=https://testproject.supabase.co EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-anon-key \n//   EXPO_PUBLIC_AGROFLOW_API_BASE=https://api.agroflow.test npx expo export --platform web --clear --output-dir <dir>
//   node scripts/check-deep-links.mjs --farmer <dir>
//
// Exit code 0 = every route opens fresh and after a refresh, the headers are there, and the
// report-only Content-Security-Policy reported nothing.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "@playwright/test";

const farmerAt = process.argv.indexOf("--farmer");
const farmer = farmerAt > 0;
const root = path.resolve(farmer ? process.argv[farmerAt + 1] : "dist");
const vercel = JSON.parse(fs.readFileSync(farmer ? "../../mobile/vercel.json" : "vercel.json", "utf8"));
// The build talks to fake hosts; the policy names the real ones. Swap them for the check, so
// the policy is tested as written, against the hosts this build really calls.
const REAL_TO_FAKE = [
  ["https://zcoalyxzvemiumnipufz.supabase.co", "https://testproject.supabase.co"],
  ["wss://zcoalyxzvemiumnipufz.supabase.co", "wss://testproject.supabase.co"],
  ["https://agroflow-production-998d.up.railway.app", "https://api.agroflow.test"],
];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".json": "application/json",
  ".woff2": "font/woff2", ".ttf": "font/ttf", ".ico": "image/x-icon", ".webm": "video/webm", ".glb": "model/gltf-binary" };

const matches = (source, urlPath) => new RegExp(`^${source}$`).test(urlPath);
function headersFor(urlPath) {
  const out = {};
  for (const rule of vercel.headers ?? []) {
    if (!matches(rule.source, urlPath)) continue;
    for (const { key, value } of rule.headers) {
      out[key] = REAL_TO_FAKE.reduce((v, [real, fake]) => v.split(real).join(fake), value);
    }
  }
  return out;
}
function resolve(urlPath) {
  const file = path.join(root, decodeURIComponent(urlPath));
  if (!file.startsWith(root)) return null;
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  if (fs.existsSync(path.join(file, "index.html"))) return path.join(file, "index.html");
  const rewrite = (vercel.rewrites ?? []).find(r => matches(r.source, urlPath));
  return rewrite ? path.join(root, rewrite.destination) : null;
}

const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, "http://x").pathname;
  const headers = headersFor(urlPath);
  // Vercel redirects /staff to /staff/ (a directory); the same here.
  if (!farmer && (urlPath === "/staff" || urlPath === "/admin")) { res.writeHead(308, { ...headers, Location: urlPath + "/" }); return res.end(); }
  const file = resolve(urlPath);
  if (!file) { res.writeHead(404, { ...headers, "Content-Type": "text/plain" }); return res.end("404"); }
  res.writeHead(200, { ...headers, "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`); };

// Every inline script must be allowed by its hash, or the policy would block it once enforced.
const csp = (urlPath) => headersFor(urlPath)["Content-Security-Policy-Report-Only"] ?? "";
const htmlFiles = farmer ? ["index.html"] : ["index.html", "staff/index.html"];
for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const missing = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(m => `'sha256-${crypto.createHash("sha256").update(m[1], "utf8").digest("base64")}'`)
    .filter(h => !csp(file === "index.html" ? "/" : "/staff/").includes(h));
  check(`every inline script in ${file} is allowed by its hash in vercel.json`, missing.length === 0, missing.join(" "));
}

const browser = await chromium.launch();
const context = await browser.newContext();
// Report-only violations are announced as events: collect them on every page.
await context.addInitScript(() => {
  window.__cspViolations = [];
  document.addEventListener("securitypolicyviolation", e =>
    window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI || "(inline)"}`));
});
const page = await context.newPage();
// The build points at the fake hosts: answer them all locally, empty.
await page.route(url => !url.href.startsWith(base), route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
const violations = () => page.evaluate(() => window.__cspViolations ?? []);
const logoLoaded = () => page.evaluate(() => {
  const img = document.querySelector(".visual-brand img, img.brand-logo, img[src*='agroflow-icon']");
  return !!img && img.complete && img.naturalWidth > 0;
});

async function headersOk(route, response) {
  const h = response?.headers() ?? {};
  const pp = h["permissions-policy"] ?? "";
  const geo = !farmer && route.startsWith("/staff/") ? "geolocation=(self)" : "geolocation=()";
  return h["x-content-type-options"] === "nosniff" && h["referrer-policy"] === "strict-origin-when-cross-origin" &&
    h["x-frame-options"] === "SAMEORIGIN" && /camera=\(\)/.test(pp) && /microphone=\(\)/.test(pp) && pp.includes(geo) &&
    !!h["content-security-policy-report-only"] && !h["content-security-policy"];
}

if (farmer) {
  for (const route of ["/", "/login", "/settings", "/zone/1", "/legal?doc=terms"]) {
    const response = await page.goto(base + route, { waitUntil: "load" });
    const rendered = await page.locator("#root *").first().waitFor({ timeout: 20000 }).then(() => true, () => false);
    await page.reload({ waitUntil: "load" });
    const again = await page.locator("#root *").first().waitFor({ timeout: 20000 }).then(() => true, () => false);
    await page.waitForTimeout(1500);
    const v = await violations();
    check(`farmer app ${route} opens fresh and after refresh, with the headers and no CSP report`,
      response?.status() === 200 && rendered && again && await headersOk(route, response) && v.length === 0,
      `status ${response?.status()}${v.length ? `; CSP: ${[...new Set(v)].join(", ")}` : ""}`);
  }
} else {
  const publicRoutes = ["/", ...vercel.rewrites.map(r => r.source)];
  for (const route of publicRoutes) {
    const first = await page.goto(base + route, { waitUntil: "load" });
    const titled = await page.locator("#publicTitle").waitFor({ timeout: 15000 }).then(() => true, () => false);
    const current = await page.locator('.visual-header a[aria-current="page"]').getAttribute("href").catch(() => null);
    await page.reload({ waitUntil: "load" });
    const again = await page.locator("#publicTitle").waitFor({ timeout: 15000 }).then(() => true, () => false);
    await page.waitForTimeout(500);
    const v = await violations();
    check(`${route} opens fresh and after refresh, with the headers and no CSP report`,
      first?.status() === 200 && titled && again && current === route && await logoLoaded() && await headersOk(route, first) && v.length === 0,
      `status ${first?.status()}, selected ${current}${v.length ? `; CSP: ${[...new Set(v)].join(", ")}` : ""}`);
  }

  // The 3D demo: open it, which loads WebGL and its model, and listen for reports.
  await page.goto(base + "/technology", { waitUntil: "load" });
  await page.locator("[data-hardware-showcase]").scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(3000);
  const v3d = await violations();
  check("the 3D controller on /technology loads with no CSP report", v3d.length === 0, [...new Set(v3d)].join(", "));

  for (const route of ["/staff/", "/staff", "/admin/", "/#/admin"]) {
    const response = await page.goto(base + route, { waitUntil: "load" });
    await page.waitForURL(/\/staff\/(\?.*)?(#.*)?$/, { timeout: 15000 }).catch(() => {});
    const signIn = await page.locator("input[type=password]").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    const html = await page.content();
    check(`${route} reaches the staff sign-in, not the product page`,
      (response?.status() ?? 0) < 400 && /\/staff\/$/.test(new URL(page.url()).pathname) && signIn && !/data-public-menu/.test(html),
      `landed on ${new URL(page.url()).pathname}`);
    if (route === "/staff/") {
      await page.reload({ waitUntil: "load" });
      const still = await page.locator("input[type=password]").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
      const fresh = await page.request.get(base + "/staff/");
      const v = await violations();
      check("/staff/ survives a refresh, shows the logo, allows geolocation for the picker and has no CSP report",
        still && await logoLoaded() && await headersOk("/staff/", fresh) && v.length === 0,
        v.length ? `CSP: ${[...new Set(v)].join(", ")}` : "");
    }
  }

  const unknown = await page.goto(base + "/no-such-page", { waitUntil: "load" });
  check("an unknown address is a real 404, not a copy of the homepage", unknown?.status() === 404);
}

await browser.close();
server.close();
const failed = results.filter(ok => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
