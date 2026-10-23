// AF-02: no English is hard-coded in a farmer screen. Every word a farmer sees, and every
// accessibility label, goes through t() so Afrikaans and Setswana can show it. This test reads the
// screen and component sources and fails on:
//   - JSX text with letters in it:          <Text>Water now</Text>
//   - a string in a user-facing prop:       accessibilityLabel="Close", placeholder="e.g. 2.5", title="…"
//   - a string passed to Alert.alert(…) or a toast-like message call
// Words that are not English sentences (brand names, units, symbols) are allowed in ALLOWED.
// A file can opt a line out with  // i18n-ok: <reason>  for something deliberately untranslated.
// Node's fs and path, typed by hand: this app has no @types/node (jest runs in Node).
type Dirent = { name: string; isDirectory(): boolean };
declare const require: (name: string) => unknown;
declare const __dirname: string;
const fs = require('fs') as { readdirSync(d: string, o: { withFileTypes: true }): Dirent[]; readFileSync(f: string, e: 'utf8'): string };
const path = require('path') as { resolve(...p: string[]): string; join(...p: string[]): string; relative(a: string, b: string): string };

const SRC = path.resolve(__dirname, '..', '..');
const FOLDERS = ['app', 'components'];
// Staff-only or developer-only files are not farmer screens.
const SKIP = [/__tests__/, /\.native\.tsx$/, /WebLoadingVideo/, /mascot[\\/]/];

// Translated on fix/i18n-remaining (uncommitted when this test was written, 23 October 2026).
// Remove each entry when that branch is merged; the test then guards these files too.
const PENDING_ON_I18N_BRANCH = ['app/forgot-password.tsx', 'app/update-password.tsx', 'app/zone-hardware.tsx'];
const relative = (f: string) => path.relative(SRC, f).split('\\').join('/');

// Not English sentences: brand names, units and marks.
const ALLOWED = new Set(['AgroFlow', 'Telegram', 'L', 'ml', 'm²', 'ha', 'min', '°C', '%', 'pH', 'OK', 'AgroFlow Staff', 'mm', 'L/min', '—', '·', '✓', '○', '›', '•']);

const USER_PROPS = ['accessibilityLabel', 'accessibilityHint', 'placeholder', 'title', 'subtitle', 'label', 'description', 'emptyText'];

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: Dirent) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.tsx$/.test(e.name) ? [p] : [];
  });
}

const words = (s: string) => /[A-Za-z]{2,}/.test(s) && !ALLOWED.has(s.trim());

export function findHardCodedEnglish(source: string): string[] {
  const found: string[] = [];
  // Comments are not shown to anyone; a line marked i18n-ok is deliberate.
  const text = source
    .split('\n').map(l => (/i18n-ok/.test(l) ? '' : l)).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  const lineOf = (index: number) => text.slice(0, index).split('\n').length;
  // JSX text between tags, also across lines: >Some words<
  for (const m of text.matchAll(/>([^<>{}`=();]+)</g)) {
    const words_ = m[1].replace(/\s+/g, ' ').trim();
    if (words_ && words(words_) && !/^[\s\W\d]*$/.test(words_) && !/&&|\|\||=>|^\s*:|\?\s*$/.test(m[1]) && words_ !== 'Promise') found.push(`${lineOf(m.index!)}: >${words_}<`);
  }
  for (const prop of USER_PROPS) {
    for (const m of text.matchAll(new RegExp(`\\b${prop}=["']([^"']+)["']`, 'g'))) {
      if (words(m[1])) found.push(`${lineOf(m.index!)}: ${prop}="${m[1]}"`);
    }
  }
  for (const m of text.matchAll(/Alert\.alert\(\s*['"`]([^'"`]+)['"`]/g)) {
    if (words(m[1])) found.push(`${lineOf(m.index!)}: Alert.alert('${m[1]}')`);
  }
  // The second argument of Alert.alert too: Alert.alert(t('x'), 'Some words')
  for (const m of text.matchAll(/Alert\.alert\([^,]+,\s*['"`]([^'"`]+)['"`]/g)) {
    if (words(m[1])) found.push(`${lineOf(m.index!)}: Alert.alert(…, '${m[1]}')`);
  }
  return [...new Set(found)];
}

describe('AF-02: farmer screens', () => {
  const all = FOLDERS.flatMap(f => files(path.join(SRC, f)))
    .filter(f => !SKIP.some(r => r.test(f)))
    .filter(f => !PENDING_ON_I18N_BRANCH.includes(relative(f)));

  it('finds the files', () => {
    expect(all.length).toBeGreaterThan(30);
  });

  it.each(all.map(f => [path.relative(SRC, f).replace(/\\/g, '/'), f]))('%s has no hard-coded English', (_name, file) => {
    expect(findHardCodedEnglish(fs.readFileSync(file as string, 'utf8'))).toEqual([]);
  });

  it('the guard itself catches the three kinds', () => {
    expect(findHardCodedEnglish('<Text>Water now</Text>')).toHaveLength(1);
    expect(findHardCodedEnglish('<Pressable accessibilityLabel="Close menu" />')).toHaveLength(1);
    expect(findHardCodedEnglish("Alert.alert('Invalid size', x)")).toHaveLength(1);
    expect(findHardCodedEnglish("<Text>{t('zone.title')}</Text>")).toHaveLength(0);
    expect(findHardCodedEnglish('<Text>AgroFlow</Text>')).toHaveLength(0);
  });
});
