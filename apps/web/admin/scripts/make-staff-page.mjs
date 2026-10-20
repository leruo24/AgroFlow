// Writes staff/index.html from index.html: the staff console's own address (/staff/), which
// nothing on the public site links to. The same app (src/main.ts) runs there and shows only
// staff sign-in and the console; the root address only ever shows the product site.
// Generated so the two pages never drift: run by `npm run build` (prebuild) and committed so
// the dev server and Playwright have it too. Asset paths in index.html are relative (the site
// can live under a sub-path), so they get "../" here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const relative = /((?:href|poster)=")(?!https?:|\/|#|data:)([^"]+)"/g;
html = html.replace(relative, '$1../$2"');
html = html.replace('video.src = "media/', 'video.src = "../media/');
html = html.replace(/<title>[^<]*<\/title>/, '<title>AgroFlow staff sign-in</title>\n  <meta name="robots" content="noindex" />');
html = html.replace('<!doctype html>', '<!doctype html>\n<!-- Generated from index.html by scripts/make-staff-page.mjs. Do not edit by hand. -->');
fs.mkdirSync(path.join(root, 'staff'), { recursive: true });
fs.writeFileSync(path.join(root, 'staff', 'index.html'), html);
console.log('wrote staff/index.html');
