// PLAN-1.0 phase 6 (DESIGN 34): the pre-launch attack cycle (/rb-attack). The owner approves the
// scope once, in their own words, recorded on the control issue:
//   <!-- rockbuilt:attack-scope targets=<host,host> until=YYYY-MM-DD -->
//   <owner words>
// Only targets the owner named may be probed or attacked (`rb attack check <target>`), and never a
// third party: the skill refuses hosts of providers it does not own. A newer
// `<!-- rockbuilt:attack-scope-revoke -->` ends every scope before it.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readContract, sectionCommands } from './contract.mjs';
import { ensureControl } from './control.mjs';
import { ops } from './gh.mjs';
import { CliError, now } from './util.mjs';

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
export const SCOPE_DAYS = 30;
export const SCOPE_MAX_DAYS = 90;
// A target: a host (optionally *.domain), host:port, or a named own system such as
// supabase:<project-ref>. No scheme, no path, no spaces.
const TARGET = /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::[a-z0-9._-]+)?$/;
const SYSTEM = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._-]*$/;
// Hosting platforms: the owner may name their own project on them (exactly one label above the
// suffix, myapp.vercel.app), never a wildcard over them.
const HOSTING = ['app.n8n.cloud', 'supabase.co', 'vercel.app', 'netlify.app', 'up.railway.app', 'railway.app', 'fly.dev', 'herokuapp.com', 'pages.dev', 'github.io', 'firebaseapp.com', 'web.app', 'onrender.com', 'workers.dev', 'cloudfront.net', 'azurewebsites.net', 'ngrok-free.app', 'ngrok.io', 'n8n.cloud', 'deno.dev', 'glitch.me', 'replit.app'];
// Third parties: never a target, at any depth (review of 1.5.0: api.stripe.com was accepted).
const THIRD_PARTY = ['stripe.com', 'stripe.network', 'openai.com', 'anthropic.com', 'github.com', 'githubusercontent.com', 'amazonaws.com', 'googleapis.com', 'google.com', 'paypal.com', 'mercadopago.com', 'wompi.co', 'twilio.com', 'sendgrid.net', 'sendgrid.com', 'mailgun.org', 'resend.com', 'slack.com', 'cloudflare.com', 'azure.com', 'microsoft.com', 'apple.com', 'facebook.com', 'whatsapp.com', 'meta.com'];
// Second-level labels under which a two-label base is a public suffix (*.com.co, *.co.uk).
const SLD = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'gob', 'mil', 'ne', 'or', 'go']);
const under = (host, d) => host === d || host.endsWith(`.${d}`);

function refuseTarget(t) {
  if (SYSTEM.test(t) && !/^[a-z0-9.-]+:\d+$/.test(t)) return null; // supabase:<ref>
  const wild = t.startsWith('*.');
  const host = t.replace(/^\*\./, '').replace(/:[^:]*$/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && (/^169\.254\./.test(host) || /^0\./.test(host))) return 'a link-local or metadata address is never a target';
  const third = THIRD_PARTY.find((d) => under(host, d));
  if (third) return `${third} is a third party: never a target`;
  const hosting = HOSTING.find((d) => under(host, d));
  if (hosting) {
    if (wild || host === hosting) return `${hosting} is a shared host: name your own project on it (myapp.${hosting})`;
    if (host.slice(0, -hosting.length - 1).includes('.')) return `${host}: name your project as one label above ${hosting}`;
  }
  if (wild) {
    const labels = host.split('.');
    if (labels.length < 2 || (labels.length === 2 && SLD.has(labels[0]))) return `*.${host} is a public suffix: a wildcard needs a domain of the owner (*.example.com)`;
  }
  return null;
}

const time = (iso) => Date.parse(iso || '');
const day = (iso) => String(iso).slice(0, 10);
const addDays = (iso, d) => new Date(time(iso) + d * 86400000).toISOString().slice(0, 10);

export function normalizeTargets(list) {
  const out = [];
  for (const raw of String(list || '').split(',')) {
    const t = raw.trim().toLowerCase().replace(/\.$/, '');
    if (!t) continue;
    if (!TARGET.test(t) && !SYSTEM.test(t)) throw new CliError(`target "${raw.trim()}": a host, *.domain, host:port or system:id, without scheme or path`, 2);
    const why = refuseTarget(t);
    if (why) throw new CliError(`target "${t}": ${why}`, 2);
    out.push(t);
  }
  if (!out.length) throw new CliError('--targets needs at least one system of the owner', 2);
  return [...new Set(out)];
}

export function scopeMarker({ targets, until, probes = 'none' }) {
  return `<!-- rockbuilt:attack-scope targets=${targets.join(',')} until=${until} probes=${probes} -->`;
}

// The `## Security probes` commands of AGENTS.md and their fingerprint: the owner approves the
// list with the scope, and a list changed since (by any PR) does not run (review of 1.5.0).
export function probeList(root) {
  const cmds = sectionCommands(readContract(root).text, 'Security probes') || [];
  const hash = cmds.length ? createHash('sha256').update(cmds.join('\n')).digest('hex').slice(0, 12) : 'none';
  return { commands: cmds, hash };
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
    const m = String(cm.body || '').match(/^\s*<!--\s*rockbuilt:attack-scope\s+targets=(\S+)\s+until=(\d{4}-\d{2}-\d{2})(?:\s+probes=([0-9a-f]{12}|none))?\s*-->/);
    if (!m || time(cm.created_at) <= revokedAt) continue;
    let targets;
    try { targets = normalizeTargets(m[1]); } catch { continue; }
    const cap = addDays(cm.created_at, SCOPE_MAX_DAYS);
    const until = m[2] > cap ? cap : m[2];
    if (`${until}T23:59:59Z` < at) continue;
    const words = String(cm.body).replace(m[0], '').trim().split('\n').find((l) => l.trim()) || '';
    if (!found || time(cm.created_at) >= time(found.at)) found = { targets, until, probes: m[3] || 'none', at: cm.created_at, by: cm.author || null, words: words.slice(0, 300) };
  }
  return found;
}

// The host and port a target string really reaches, parsed like a client would (review of 1.5.0:
// "https://evil.com?.example.com" matched *.example.com). Userinfo, backslashes and spaces are
// refused outright.
export function targetOf(target) {
  const raw = String(target || '').trim();
  if (!raw || /[@\\\s]/.test(raw)) return null;
  const sys = raw.toLowerCase();
  if (SYSTEM.test(sys) && !/^[a-z0-9.-]+:\d+$/.test(sys) && !/^[a-z][a-z0-9+.-]*:\/\//.test(sys)) return { system: sys };
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`); } catch { return null; }
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host) return null;
  const scheme = u.protocol.replace(/:$/, '');
  const port = u.port || (scheme === 'https' || scheme === 'wss' ? '443' : scheme === 'http' || scheme === 'ws' ? '80' : '');
  return { host, port };
}

// A plain host covers its web ports (80 and 443); any other port must be named (host:port).
export function inScope(scope, target) {
  if (!scope) return false;
  const t = targetOf(target);
  if (!t) return false;
  return scope.targets.some((s) => {
    if (t.system) return s === t.system;
    if (SYSTEM.test(s) && !/^[a-z0-9.-]+:\d+$/.test(s)) return false;
    const m = s.match(/^(\*\.)?([^:]+)(?::(\d+))?$/);
    if (!m) return false;
    const [, wild, base, port] = m;
    const hostOk = wild ? t.host.endsWith(`.${base}`) : t.host === base;
    const portOk = port ? t.port === port : ['80', '443'].includes(t.port);
    return hostOk && portOk;
  });
}

function controlComments(c, create = true) {
  const ctl = ensureControl(c, { create });
  return { ctl, comments: ctl ? ops.issueComments(c, ctl.number) : [] };
}

const canApproveVia = (c) => {
  const perms = new Map();
  return (login) => {
    if (!login) return false;
    if (!perms.has(login)) { let p = null; try { p = ops.permission(c, login); } catch { p = null; } perms.set(login, p); }
    return ['admin', 'maintain', 'write'].includes(perms.get(login));
  };
};

export function recordScope(c, { words, targets, until = null, root = null }) {
  const w = String(words || '').trim();
  if (w.length < 8) throw new CliError('--words: the owner\'s own words approving the scope', 2);
  const list = normalizeTargets(targets);
  const today = day(now().toISOString());
  const u = until || addDays(now().toISOString(), SCOPE_DAYS);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(u)) throw new CliError('--until YYYY-MM-DD', 2);
  if (u < today) throw new CliError('--until is in the past', 2);
  if (u > addDays(now().toISOString(), SCOPE_MAX_DAYS)) throw new CliError(`--until at most ${SCOPE_MAX_DAYS} days ahead`, 2);
  const { ctl } = controlComments(c);
  const probes = root ? probeList(root) : { commands: [], hash: 'none' };
  const body = `${scopeMarker({ targets: list, until: u, probes: probes.hash })}\n${w.split('\n')[0].slice(0, 300)}\n${probes.commands.length ? `\nProbes approved with this scope:\n${probes.commands.map((x) => `- \`${x.replace(/`/g, "'")}\``).join('\n')}\n` : ''}`;
  ops.issueComment(c, ctl.number, body);
  return { control: ctl.number, targets: list, until: u, probes: probes.hash, words: w.split('\n')[0].slice(0, 300) };
}

export function showScope(c) {
  const { comments } = controlComments(c, false);
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
