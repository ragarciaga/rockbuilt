// PLAN-1.0 G1 (DESIGN 33.1): exploration mode. A fixed time box on a rb/explore-<slug> branch, no
// reviewers, never merged (the gate refuses the branch). The clock is an empty commit on the
// branch (cached in .rockbuilt/explore/<slug>.json) so a session can check it instead of guessing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { currentBranch } from './repo.mjs';
import { CliError, git, now } from './util.mjs';

export const DEFAULT_HOURS = 2;
export const MAX_HOURS = 8;
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

function fileFor(root, slug) {
  if (!SLUG.test(String(slug || ''))) throw new CliError('slug: lowercase letters, digits and "-", up to 48 characters', 2);
  return path.join(root, '.rockbuilt', 'explore', `${slug}.json`);
}

export function startExploration(root, slug, { hours = DEFAULT_HOURS } = {}) {
  const file = fileFor(root, slug);
  const h = hours === true || hours === '' ? NaN : Number(hours);
  if (!Number.isFinite(h) || h <= 0 || h > MAX_HOURS) throw new CliError(`--hours between 0 and ${MAX_HOURS}`, 2);
  const branch = `rb/explore-${slug}`;
  const on = currentBranch(root);
  if (on !== branch) throw new CliError(`check out ${branch} first (git checkout -b ${branch} origin/<default>); now on ${on || 'a detached HEAD'}`, 2);
  if (existsSync(file) || fromBranch(root, slug)) throw new CliError(`${slug} already started: rb explore check ${slug}`, 3);
  const start = now();
  const rec = { slug, branch, hours: h, started: start.toISOString(), until: new Date(start.getTime() + h * 3600e3).toISOString(), conclusion: `docs/research/${slug}.md` };
  // The clock is a commit on the branch, so it survives a new session or container once pushed
  // (review of 1.4.0); the local file is a cache.
  const c = git(root, ['commit', '--allow-empty', '--no-verify', '-m', `explore: start ${slug} hours=${h} until=${rec.until}`]);
  if (!c.ok) throw new CliError(`could not record the clock on ${branch}: ${c.stderr || c.stdout}`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
  return { ...rec, minutesLeft: Math.round(h * 60), over: false };
}

// The earliest clock commit for the slug on the current branch, or null.
function fromBranch(root, slug) {
  const log = git(root, ['log', '--format=%s', '-n', '500', 'HEAD']);
  if (!log.ok) return null;
  const re = new RegExp(`^explore: start ${slug} hours=([0-9.]+) until=(\\S+)$`);
  const hits = log.stdout.split('\n').map((l) => l.match(re)).filter(Boolean);
  if (!hits.length) return null;
  const m = hits[hits.length - 1];
  const until = m[2];
  const hours = Number(m[1]);
  return { slug, branch: `rb/explore-${slug}`, hours, started: new Date(Date.parse(until) - hours * 3600e3).toISOString(), until, conclusion: `docs/research/${slug}.md` };
}

export function checkExploration(root, slug) {
  const file = fileFor(root, slug);
  const rec = fromBranch(root, slug) || (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
  if (!rec) throw new CliError(`no exploration ${slug} on this branch: rb explore start ${slug}`, 2);
  const left = Math.round((Date.parse(rec.until) - now().getTime()) / 60000);
  return { ...rec, minutesLeft: Math.max(0, left), over: left <= 0 };
}

export function exploreText(r) {
  return r.over
    ? `time is up for ${r.slug} (${r.hours} h since ${r.started}): stop exploring and write ${r.conclusion}`
    : `${r.slug}: ${r.minutesLeft} min left of ${r.hours} h (until ${r.until}); conclusion goes to ${r.conclusion}`;
}
