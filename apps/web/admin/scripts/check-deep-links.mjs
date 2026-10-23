// Deep-link refresh check against the production build, served the way Vercel serves it:
// a real file first (/staff/ -> staff/index.html, /admin/ -> admin/index.html), then the
// vercel.json rewrites, otherwise 404. Vite's dev server falls back to index.html for any
// path, so it cannot show this. Fake service hosts only; nothing live is contacted.
//
// Build with the same fake hosts as the Playwright suite (the app needs Supabase settings to start):
//   VITE_SUPABASE_URL=https://testproject.supabase.co VITE_SUPABASE_ANON_KEY=test-anon-key \n//   VITE_AGROFLOW_API_BASE=https://api.agroflow.test npm run build && node scripts/check-deep-links.mjs
//
// Exit code 0 = every route opens fresh, survives a refresh and shows the logo.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve("dist");
const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".json": "application/json",
  ".woff2": "font/woff2", ".ico": "image/x-icon", ".webm": "video/webm", ".glb": "model/gltf-binary" };

function resolve(urlPath) {
  const file = path.join(root, decodeURIComponent(urlPath));
  if (!file.startsWith(root)) return null;
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  if (fs.existsSync(path.join(file, "index.html"))) return path.join(file, "index.html");
  const rewrite = (vercel.rewrites ?? []).find(r => r.source === urlPath);
  return rewrite ? path.join(root, rewrite.destination) : null;
}

const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, "http://x").pathname;
  // Vercel redirects /staff to /staff/ (a directory); the same here.
  if (urlPath === "/staff" || urlPath === "/admin") { res.writeHead(308, { Location: urlPath + "/" }); return res.end(); }
  const file = resolve(urlPath);
  if (!file) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("404"); }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const publicRoutes = ["/", ...vercel.rewrites.map(r => r.source)];
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`); };

const browser = await chromium.launch();
const page = await browser.newPage();
// The build points at real service hosts from .env, if any: answer them all locally, empty.
await page.route(url => !url.href.startsWith(base), route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
const logoLoaded = () => page.evaluate(() => {
  const img = document.querySelector(".visual-brand img, img.brand-logo, img[src*='agroflow-icon']");
  return !!img && img.complete && img.naturalWidth > 0;
});

for (const route of publicRoutes) {
  const first = await page.goto(base + route, { waitUntil: "load" });
  const titled = await page.locator("#publicTitle").waitFor({ timeout: 15000 }).then(() => true, () => false);
  const current = await page.locator('.visual-header a[aria-current="page"]').getAttribute("href").catch(() => null);
  await page.reload({ waitUntil: "load" });
  const again = await page.locator("#publicTitle").waitFor({ timeout: 15000 }).then(() => true, () => false);
  check(`${route} opens fresh and after refresh`, first?.status() === 200 && titled && again && current === route && await logoLoaded(),
    `status ${first?.status()}, selected ${current}`);
}

for (const route of ["/staff/", "/staff", "/admin/", "/#/admin"]) {
  const response = await page.goto(base + route, { waitUntil: "load" });
  await page.waitForURL(/\/staff\/(\?.*)?(#.*)?$/, { timeout: 15000 }).catch(() => {});
  const signIn = await page.locator("#loginForm, form[data-login], input[type=password]").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  const html = await page.content();
  check(`${route} reaches the staff sign-in, not the product page`,
    (response?.status() ?? 0) < 400 && /\/staff\/$/.test(new URL(page.url()).pathname) && signIn && !/data-public-menu/.test(html),
    `landed on ${new URL(page.url()).pathname}`);
  if (route === "/staff/") {
    await page.reload({ waitUntil: "load" });
    const still = await page.locator("input[type=password]").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    check("/staff/ survives a refresh and shows the logo", still && await logoLoaded());
  }
}

const unknown = await page.goto(base + "/no-such-page", { waitUntil: "load" });
check("an unknown address is a real 404, not a copy of the homepage", unknown?.status() === 404);

await browser.close();
server.close();
const failed = results.filter(ok => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
