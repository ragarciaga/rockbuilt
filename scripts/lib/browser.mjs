// rb browser: the Chromium executable to use when Playwright's own download is missing or does not
// match the pinned version. Cloud images differ: one has /opt/pw-browsers/chromium as a link to the
// executable, another only /opt/pw-browsers/chromium-<n>/chrome-linux/chrome (3d_brain, 2026-10-23:
// every agent rediscovered the full path). Order: PW_CHROMIUM_PATH when it is a file, then the
// link, then the newest versioned build under PLAYWRIGHT_BROWSERS_PATH or /opt/pw-browsers.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

export function findBrowser(env = process.env) {
  const tried = [];
  const pick = (p, how) => { tried.push(p); return isFile(p) ? { path: p, how } : null; };
  if (env.PW_CHROMIUM_PATH) { const r = pick(env.PW_CHROMIUM_PATH, 'PW_CHROMIUM_PATH'); if (r) return { ...r, tried }; }
  for (const root of [...new Set([env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean))]) {
    const link = pick(path.join(root, 'chromium'), `${root}/chromium`);
    if (link) return { ...link, tried };
    let dirs = [];
    try { dirs = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)); } catch { continue; }
    dirs.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const d of dirs) {
      for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        const r = pick(path.join(root, d, sub), `${root}/${d}`);
        if (r) return { ...r, tried };
      }
    }
  }
  return { path: null, how: null, tried, exists: existsSync('/opt/pw-browsers') };
}
