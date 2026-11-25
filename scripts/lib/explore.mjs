// PLAN-1.0 G1 (DESIGN 33.1): exploration mode. A fixed time box on a rb/explore-<slug> branch, no
// reviewers, never merged (the gate refuses the branch). The clock lives in
// .rockbuilt/explore/<slug>.json so a session can check it instead of guessing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { currentBranch } from './repo.mjs';
import { CliError, now } from './util.mjs';

export const DEFAULT_HOURS = 2;
export const MAX_HOURS = 8;
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

function fileFor(root, slug) {
  if (!SLUG.test(String(slug || ''))) throw new CliError('slug: lowercase letters, digits and "-", up to 48 characters', 2);
  return path.join(root, '.rockbuilt', 'explore', `${slug}.json`);
}

export function startExploration(root, slug, { hours = DEFAULT_HOURS } = {}) {
  const file = fileFor(root, slug);
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0 || h > MAX_HOURS) throw new CliError(`--hours between 0 and ${MAX_HOURS}`, 2);
  const branch = `rb/explore-${slug}`;
  const on = currentBranch(root);
  if (on !== branch) throw new CliError(`check out ${branch} first (git checkout -b ${branch} origin/<default>); now on ${on || 'a detached HEAD'}`, 2);
  if (existsSync(file)) throw new CliError(`${slug} already started: rb explore check ${slug}`, 3);
  const start = now();
  const rec = { slug, branch, hours: h, started: start.toISOString(), until: new Date(start.getTime() + h * 3600e3).toISOString(), conclusion: `docs/research/${slug}.md` };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
  return { ...rec, minutesLeft: Math.round(h * 60), over: false };
}

export function checkExploration(root, slug) {
  const file = fileFor(root, slug);
  if (!existsSync(file)) throw new CliError(`no exploration ${slug}: rb explore start ${slug}`, 2);
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  const left = Math.round((Date.parse(rec.until) - now().getTime()) / 60000);
  return { ...rec, minutesLeft: Math.max(0, left), over: left <= 0 };
}

export function exploreText(r) {
  return r.over
    ? `time is up for ${r.slug} (${r.hours} h since ${r.started}): stop exploring and write ${r.conclusion}`
    : `${r.slug}: ${r.minutesLeft} min left of ${r.hours} h (until ${r.until}); conclusion goes to ${r.conclusion}`;
}
