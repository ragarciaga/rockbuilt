// PLAN-1.0 phase 6 (DESIGN 34): the pre-launch attack cycle (/rb-attack). The owner approves the
// scope once, in their own words, recorded on the control issue:
//   <!-- rockbuilt:attack-scope targets=<host,host> until=YYYY-MM-DD -->
//   <owner words>
// Only targets the owner named may be probed or attacked (`rb attack check <target>`), and never a
// third party: the skill refuses hosts of providers it does not own. A newer
// `<!-- rockbuilt:attack-scope-revoke -->` ends every scope before it.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { ensureControl } from './control.mjs';
import { ops } from './gh.mjs';
import { CliError, now } from './util.mjs';

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
export const SCOPE_DAYS = 30;
export const SCOPE_MAX_DAYS = 90;
// A target: a host (optionally *.domain), host:port, or a named own system such as
// supabase:<project-ref>. No scheme, no path, no spaces.
const TARGET = /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::[a-z0-9._-]+)?$/;
// Shared providers are never a target as a whole: only a project of the owner on them, named
// explicitly (supabase:<ref>, a subdomain the owner controls).
const SHARED = /^(?:\*\.)?(?:[a-z0-9-]+\.)?(?:supabase\.co|vercel\.app|netlify\.app|railway\.app|fly\.dev|herokuapp\.com|github\.com|githubusercontent\.com|amazonaws\.com|googleapis\.com|openai\.com|anthropic\.com|stripe\.com|n8n\.cloud)$/;

const time = (iso) => Date.parse(iso || '');
const day = (iso) => String(iso).slice(0, 10);
const addDays = (iso, d) => new Date(time(iso) + d * 86400000).toISOString().slice(0, 10);

export function normalizeTargets(list) {
  const out = [];
  for (const raw of String(list || '').split(',')) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (!TARGET.test(t)) throw new CliError(`target "${raw.trim()}": a host, *.domain, host:port or system:id, without scheme or path`, 2);
    if (/^\*\.[a-z0-9-]+$/.test(t)) throw new CliError(`target "${t}": a wildcard needs a domain of the owner (*.example.com)`, 2);
    if (SHARED.test(t) && (t.startsWith('*.') || t.split('.').length <= 2)) throw new CliError(`target "${t}" is a shared provider, not a system of the owner: name the project (its subdomain or system:id)`, 2);
    out.push(t);
  }
  if (!out.length) throw new CliError('--targets needs at least one system of the owner', 2);
  return [...new Set(out)];
}

export function scopeMarker({ targets, until }) {
  return `<!-- rockbuilt:attack-scope targets=${targets.join(',')} until=${until} -->`;
}

// The scope in force at `at` (the newest), or null.
export function parseScope(comments, at = now().toISOString(), { canApprove = () => true } = {}) {
  let revokedAt = -Infinity;
  for (const cm of comments) {
    if (TRUSTED.has(cm.author_association) && /^\s*<!--\s*rockbuilt:attack-scope-revoke\s*-->/.test(cm.body || '')) revokedAt = Math.max(revokedAt, time(cm.created_at));
  }
  let found = null;
  for (const cm of comments) {
    if (!TRUSTED.has(cm.author_association) || !canApprove(cm.author)) continue;
    const m = String(cm.body || '').match(/^\s*<!--\s*rockbuilt:attack-scope\s+targets=(\S+)\s+until=(\d{4}-\d{2}-\d{2})\s*-->/);
    if (!m || time(cm.created_at) <= revokedAt) continue;
    let targets;
    try { targets = normalizeTargets(m[1]); } catch { continue; }
    const cap = addDays(cm.created_at, SCOPE_MAX_DAYS);
    const until = m[2] > cap ? cap : m[2];
    if (`${until}T23:59:59Z` < at) continue;
    const words = String(cm.body).replace(m[0], '').trim().split('\n').find((l) => l.trim()) || '';
    if (!found || time(cm.created_at) > time(found.at)) found = { targets, until, at: cm.created_at, by: cm.author || null, words: words.slice(0, 300) };
  }
  return found;
}

export function inScope(scope, target) {
  if (!scope) return false;
  const t = String(target || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
  return scope.targets.some((s) => {
    if (s === t) return true;
    if (s.startsWith('*.')) {
      const base = s.slice(2);
      const host = t.replace(/:[^:]*$/, '');
      return host.endsWith(`.${base}`);
    }
    return !s.includes(':') && t.replace(/:\d+$/, '') === s;
  });
}

function controlComments(c) {
  const ctl = ensureControl(c, { create: true });
  return { ctl, comments: ops.issueComments(c, ctl.number) };
}

const canApproveVia = (c) => {
  const perms = new Map();
  return (login) => {
    if (!login) return false;
    if (!perms.has(login)) { let p = null; try { p = ops.permission(c, login); } catch { p = null; } perms.set(login, p); }
    return ['admin', 'maintain', 'write'].includes(perms.get(login));
  };
};

export function recordScope(c, { words, targets, until = null }) {
  const w = String(words || '').trim();
  if (w.length < 8) throw new CliError('--words: the owner\'s own words approving the scope', 2);
  const list = normalizeTargets(targets);
  const today = day(now().toISOString());
  const u = until || addDays(now().toISOString(), SCOPE_DAYS);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(u)) throw new CliError('--until YYYY-MM-DD', 2);
  if (u < today) throw new CliError('--until is in the past', 2);
  if (u > addDays(now().toISOString(), SCOPE_MAX_DAYS)) throw new CliError(`--until at most ${SCOPE_MAX_DAYS} days ahead`, 2);
  const { ctl } = controlComments(c);
  const body = `${scopeMarker({ targets: list, until: u })}\n${w.split('\n')[0].slice(0, 300)}\n`;
  ops.issueComment(c, ctl.number, body);
  return { control: ctl.number, targets: list, until: u, words: w.split('\n')[0].slice(0, 300) };
}

export function showScope(c) {
  const { comments } = controlComments(c);
  return parseScope(comments, now().toISOString(), { canApprove: canApproveVia(c) });
}

export function revokeScope(c) {
  const { ctl } = controlComments(c);
  ops.issueComment(c, ctl.number, '<!-- rockbuilt:attack-scope-revoke -->\nAttack scope revoked.\n');
  return { control: ctl.number, revoked: true };
}

// The newest attack report in docs/security/ (attack-YYYY-MM-DD.md), or null.
export function latestAttackReport(root) {
  let names = [];
  try { names = readdirSync(path.join(root, 'docs', 'security')); } catch { return null; }
  const reports = names.filter((n) => /^attack-\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort();
  return reports.length ? `docs/security/${reports[reports.length - 1]}` : null;
}
