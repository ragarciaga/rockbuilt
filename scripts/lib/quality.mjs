// rb quality (DESIGN 23): is the speed costing quality? Counts, per period, what escaped the
// reviews, from GitHub only (no local state, so every surface sees the same numbers):
//
// - merged task PRs (rb/* task kind) and their kickbacks by source, from the PR body line
//   `<!-- rockbuilt:kickbacks verifier=<n> auditor=<n> security=<n> mechanical=<n> ci=<n> -->`;
//   an auditor kickback is a defect the verifier passed, a CI one a defect every local check passed;
// - reverts: `rb/revert-*` PRs opened in the period;
// - bugs reported in the period (`rb:bug` issues), and the escaped ones: those whose body names a
//   merged harness PR (`#<n>` or `Introduced by #<n>`).
import { ops } from './gh.mjs';
import { prKind } from './merge.mjs';

const SOURCES = ['mechanical', 'verifier', 'auditor', 'security', 'ci'];

export function parseKickbacks(body) {
  const m = String(body || '').match(/<!--\s*rockbuilt:kickbacks\s+([^>]*?)\s*-->/);
  if (!m) return null;
  const kv = Object.fromEntries([...m[1].matchAll(/([\w-]+)=(\d+)/g)].map((x) => [x[1], Number(x[2])]));
  return Object.fromEntries(SOURCES.map((s) => [s, kv[s] || 0]));
}

const inWindow = (iso, since, until) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) && (since == null || t >= since) && (until == null || t < until);
};

export function qualityReport(c, { since = null, until = null } = {}) {
  const prs = ops.prList(c, { state: 'all', headPrefix: 'rb/', maxPages: 50 });
  const merged = prs.filter((p) => p.merged_at && prKind(p.head.ref) === 'task' && inWindow(p.merged_at, since, until));
  const mergedAll = new Set(prs.filter((p) => p.merged_at && prKind(p.head.ref) === 'task').map((p) => p.number));
  const reverts = prs.filter((p) => p.head.ref.startsWith('rb/revert-') && inWindow(p.created_at, since, until));
  const kick = Object.fromEntries(SOURCES.map((s) => [s, 0]));
  let withLine = 0;
  for (const p of merged) {
    const k = parseKickbacks(p.body);
    if (!k) continue;
    withLine++;
    for (const s of SOURCES) kick[s] += k[s];
  }
  const bugs = ops.issueList(c, { labels: ['rb:bug'], state: 'all', maxPages: 50 }).filter((i) => inWindow(i.created_at, since, until));
  const escaped = bugs.map((i) => {
    const refs = [...String(i.body || '').matchAll(/#(\d+)\b/g)].map((m) => Number(m[1])).filter((n) => mergedAll.has(n));
    return refs.length ? { issue: i.number, title: i.title, prs: [...new Set(refs)] } : null;
  }).filter(Boolean);
  const n = merged.length;
  const rate = (x) => (n ? Math.round((x / n) * 100) / 100 : null);
  return {
    since: since == null ? null : new Date(since).toISOString(),
    until: until == null ? null : new Date(until).toISOString(),
    merged: n,
    withKickbackLine: withLine,
    kickbacks: kick,
    reverts: reverts.map((p) => ({ pr: p.number, title: p.title, merged: Boolean(p.merged_at) })),
    bugs: bugs.length,
    escaped,
    rates: { escapedPerMerged: rate(escaped.length), revertsPerMerged: rate(reverts.length), kickbacksPerMerged: rate(SOURCES.reduce((a, s) => a + kick[s], 0)) },
  };
}

export function qualityText(r) {
  const lines = [];
  lines.push(`Merged task PRs: ${r.merged}${r.withKickbackLine < r.merged ? ` (${r.merged - r.withKickbackLine} without a kickbacks line)` : ''}`);
  lines.push(`Kickbacks: ${SOURCES.map((s) => `${s} ${r.kickbacks[s]}`).join(', ')} (${r.rates.kickbacksPerMerged ?? '-'} per PR)`);
  lines.push(`  auditor ${r.kickbacks.auditor} = defects the verifier passed; ci ${r.kickbacks.ci} = defects every local check passed`);
  lines.push(`Reverts: ${r.reverts.length}${r.reverts.length ? ` (${r.reverts.map((x) => `#${x.pr}`).join(', ')})` : ''}`);
  lines.push(`Bugs reported: ${r.bugs}; escaped from merged PRs: ${r.escaped.length}${r.escaped.length ? ` (${r.escaped.map((e) => `#${e.issue} from ${e.prs.map((p) => `#${p}`).join(',')}`).join('; ')})` : ''}`);
  return lines.join('\n');
}
