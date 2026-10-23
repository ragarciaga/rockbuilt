// rb quality (DESIGN 23): is the speed costing quality? Counts, per period, what escaped the
// reviews, from GitHub only (no local state, so every surface sees the same numbers):
//
// - merged task PRs (rb/* task kind) and their kickbacks by source, from the PR body line
//   `<!-- rockbuilt:kickbacks verifier=<n> auditor=<n> security=<n> mechanical=<n> ci=<n> -->`;
//   an auditor kickback is a defect the verifier passed, a CI one a defect every local check passed;
// - reverts: `rb/revert-*` PRs opened in the period;
// - bugs reported in the period (`rb:bug` issues), and the escaped ones: those whose body names a
//   merged harness PR as `Introduced by #<n>` (rb-fix writes it when it traces the cause).
import { ops } from './gh.mjs';
import { parseBody, parseStatusList, prKind } from './merge.mjs';

const SOURCES = ['mechanical', 'verifier', 'auditor', 'security', 'ci'];

export function parseKickbacks(body) {
  const all = [...String(body || '').matchAll(/<!--\s*rockbuilt:kickbacks\s+([^>]*?)\s*-->/g)];
  if (!all.length) return null;
  const m = all[all.length - 1];
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
  // Reviewer kickbacks come from the verdicts posted on the task issue (every pass and fail goes
  // there, and the gate checks it), so they no longer depend on a line someone must remember
  // (rockbuilt #34). The PR line still gives mechanical and CI kickbacks, and is the fallback for
  // PRs from before 0.10.0.
  const REVIEWERS = { 'rb-verifier': 'verifier', 'rb-auditor': 'auditor', 'rb-security-reviewer': 'security' };
  const timing = [];
  for (const p of merged) {
    const k = parseKickbacks(p.body);
    const pb = parseBody(p.body);
    const issue = pb.closes[0] || pb.partOf[0];
    let fromIssue = null;
    if (issue) {
      try {
        const comments = ops.issueComments(c, issue).filter((cm) => ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(cm.author_association));
        const verdicts = comments.flatMap((cm) => parseStatusList(cm.body).map((v) => ({ ...v, at: cm.created_at })));
        if (verdicts.length) {
          fromIssue = { verifier: 0, auditor: 0, security: 0 };
          for (const v of verdicts) if (REVIEWERS[v.stage] && v.outcome === 'fail') fromIssue[REVIEWERS[v.stage]]++;
          const plan = comments.find((cm) => /^<!--\s*rockbuilt:plan\b/m.test(cm.body));
          const claim = comments.find((cm) => /<!--\s*rockbuilt:claim\b/.test(cm.body));
          const times = verdicts.map((v) => Date.parse(v.at)).filter(Number.isFinite).sort((a, b) => a - b);
          const min = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 60000) : null);
          const t0 = Date.parse((claim || plan || {}).created_at);
          const tp = Date.parse((plan || {}).created_at);
          timing.push({ pr: p.number, issue, plan: min(t0, tp), build: min(tp, times[0]), review: min(times[0], times[times.length - 1]), merge: min(Date.parse(p.created_at), Date.parse(p.merged_at)) });
        }
      } catch {
        fromIssue = null;
      }
    }
    if (!k && !fromIssue) continue;
    withLine++;
    if (k) { kick.mechanical += k.mechanical; kick.ci += k.ci; }
    const rv = fromIssue || k;
    kick.verifier += rv.verifier; kick.auditor += rv.auditor; kick.security += rv.security;
  }
  const bugs = ops.issueList(c, { labels: ['rb:bug'], state: 'all', maxPages: 50 }).filter((i) => inWindow(i.created_at, since, until));
  const escaped = bugs.map((i) => {
    const refs = [...String(i.body || '').matchAll(/\bintroduced (?:by|in) #(\d+)\b/gi)].map((m) => Number(m[1])).filter((n) => mergedAll.has(n));
    return refs.length ? { issue: i.number, title: i.title, prs: [...new Set(refs)] } : null;
  }).filter(Boolean);
  const n = merged.length;
  const rate = (x, d = n) => (d ? Math.round((x / d) * 100) / 100 : null);
  return {
    since: since == null ? null : new Date(since).toISOString(),
    until: until == null ? null : new Date(until).toISOString(),
    merged: n,
    withKickbackLine: withLine,
    kickbacks: kick,
    reverts: reverts.map((p) => ({ pr: p.number, title: p.title, merged: Boolean(p.merged_at) })),
    bugs: bugs.length,
    escaped,
    timing,
    rates: { escapedPerMerged: rate(escaped.length), revertsPerMerged: rate(reverts.length), kickbacksPerMerged: rate(SOURCES.reduce((a, s) => a + kick[s], 0), withLine) },
  };
}

export function qualityText(r) {
  const lines = [];
  lines.push(`Merged task PRs: ${r.merged}${r.withKickbackLine < r.merged ? ` (${r.merged - r.withKickbackLine} with no verdicts on the issue and no kickbacks line)` : ''}`);
  lines.push(`Kickbacks: ${SOURCES.map((s) => `${s} ${r.kickbacks[s]}`).join(', ')} (${r.rates.kickbacksPerMerged ?? '-'} per PR)`);
  lines.push(`  auditor ${r.kickbacks.auditor} = defects the verifier passed; ci ${r.kickbacks.ci} = defects every local check passed`);
  lines.push(`Reverts: ${r.reverts.length}${r.reverts.length ? ` (${r.reverts.map((x) => `#${x.pr}`).join(', ')})` : ''}`);
  lines.push(`Bugs reported: ${r.bugs}; escaped from merged PRs: ${r.escaped.length}${r.escaped.length ? ` (${r.escaped.map((e) => `#${e.issue} from ${e.prs.map((p) => `#${p}`).join(',')}`).join('; ')})` : ''}`);
  if (r.timing && r.timing.length) {
    const avg = (k) => { const v = r.timing.map((t) => t[k]).filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : '-'; };
    lines.push(`Minutes per task from the issue record (${r.timing.length} PRs, average): to plan ${avg('plan')}, plan to first review ${avg('build')}, first to last review ${avg('review')}, PR open to merge ${avg('merge')}`);
  }
  return lines.join('\n');
}
