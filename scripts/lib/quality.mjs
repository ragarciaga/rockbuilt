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
import { labelLevel, parseBody, parseStatusList, prKind } from './merge.mjs';
import { isApproval } from './approval.mjs';

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
  // PLAN-1.0 B3: the same counts per review level (labels rb:level-N, old tier labels, or the body).
  const levelOf = (p) => labelLevel((p.labels || []).map((l) => (typeof l === 'string' ? l : l.name))) || parseBody(p.body).level || 'none';
  const byLevel = {};
  const bucket = (lv) => (byLevel[lv] ||= { merged: 0, withKickback: 0, kickbacks: Object.fromEntries(SOURCES.map((s) => [s, 0])), reverts: 0, escaped: 0 });
  const levelByPr = new Map(prs.filter((p) => p.merged_at).map((p) => [p.number, levelOf(p)]));
  for (const p of merged) bucket(levelOf(p)).merged++;
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
    const b = bucket(levelOf(p));
    const mine = { mechanical: k ? k.mechanical : 0, ci: k ? k.ci : 0, verifier: rv.verifier, auditor: rv.auditor, security: rv.security };
    for (const s of SOURCES) b.kickbacks[s] += mine[s];
    if (SOURCES.some((s) => mine[s])) b.withKickback++;
  }
  const bugs = ops.issueList(c, { labels: ['rb:bug'], state: 'all', maxPages: 50 }).filter((i) => inWindow(i.created_at, since, until));
  const escaped = bugs.map((i) => {
    const refs = [...String(i.body || '').matchAll(/\bintroduced (?:by|in) #(\d+)\b/gi)].map((m) => Number(m[1])).filter((n) => mergedAll.has(n));
    return refs.length ? { issue: i.number, title: i.title, prs: [...new Set(refs)] } : null;
  }).filter(Boolean);
  for (const r of reverts) { const target = Number((r.head.ref.match(/^rb\/revert-(\d+)/) || [])[1]); if (levelByPr.has(target)) bucket(levelByPr.get(target)).reverts++; }
  for (const e of escaped) for (const pr of e.prs) if (levelByPr.has(pr)) bucket(levelByPr.get(pr)).escaped++;
  const interventions = ownerInterventions(c, merged, { since, until });
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
    byLevel,
    interventions,
    timing,
    rates: { escapedPerMerged: rate(escaped.length), revertsPerMerged: rate(reverts.length), kickbacksPerMerged: rate(SOURCES.reduce((a, s) => a + kick[s], 0), withLine) },
  };
}

// PLAN-1.0 B3: how often the owner was pulled in. Escalations, the owner's approvals of a plan,
// merges they had to ask for (--human-approved) and merges done by hand, per day of the window.
// Merges a delegation covered are counted apart: they did not interrupt.
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
export function ownerInterventions(c, merged, { since = null, until = null } = {}) {
  let comments = [];
  try { comments = ops.repoComments(c, { since: since == null ? null : new Date(since).toISOString() }); } catch { return null; }
  const inW = comments.filter((cm) => inWindow(cm.created_at, since, until));
  const escalations = inW.filter((cm) => /<!--\s*rockbuilt:escalation\b/.test(cm.body || '')).length;
  const approvals = inW.filter((cm) => TRUSTED.has(cm.author_association) && !/<!--\s*rockbuilt:/.test(cm.body || '') && isApproval(cm.body)).length;
  const gate = new Map();
  for (const cm of comments) if (/Merged by `rb merge-gate`/.test(cm.body || '')) gate.set(cm.number, cm.body);
  let humanApproved = 0;
  let delegated = 0;
  let byHand = 0;
  for (const p of merged) {
    const g = gate.get(p.number);
    if (!g) byHand++;
    else if (/merged by delegation/.test(g)) delegated++;
    else if (/human approved/.test(g)) humanApproved++;
  }
  const times = merged.map((p) => Date.parse(p.merged_at)).filter(Number.isFinite).sort((a, b) => a - b);
  const from = since ?? times[0];
  const to = until ?? (times.length ? Math.max(times[times.length - 1], Date.now()) : null);
  const days = from != null && to != null ? Math.max(1, Math.ceil((to - from) / 86400000)) : null;
  const total = escalations + approvals + humanApproved + byHand;
  return { escalations, approvals, humanApproved, byHand, delegated, total, days, perDay: days ? Math.round((total / days) * 10) / 10 : null };
}

export function qualityText(r) {
  const lines = [];
  lines.push(`Merged task PRs: ${r.merged}${r.withKickbackLine < r.merged ? ` (${r.merged - r.withKickbackLine} with no verdicts on the issue and no kickbacks line)` : ''}`);
  lines.push(`Kickbacks: ${SOURCES.map((s) => `${s} ${r.kickbacks[s]}`).join(', ')} (${r.rates.kickbacksPerMerged ?? '-'} per PR)`);
  lines.push(`  auditor ${r.kickbacks.auditor} = defects the verifier passed; ci ${r.kickbacks.ci} = defects every local check passed`);
  lines.push(`Reverts: ${r.reverts.length}${r.reverts.length ? ` (${r.reverts.map((x) => `#${x.pr}`).join(', ')})` : ''}`);
  for (const [lv, b] of Object.entries(r.byLevel || {})) {
    lines.push(`  level ${lv}: ${b.merged} merged, ${b.withKickback} with a kickback (verifier ${b.kickbacks.verifier}, auditor ${b.kickbacks.auditor}, security ${b.kickbacks.security}), ${b.reverts} reverted, ${b.escaped} escaped bugs`);
  }
  if (r.interventions) {
    const i = r.interventions;
    lines.push(`Owner interventions: ${i.total} in ${i.days} day(s), ${i.perDay} per day (escalations ${i.escalations}, plan approvals ${i.approvals}, merges asked for ${i.humanApproved}, merges by hand ${i.byHand}); ${i.delegated} merged by delegation`);
  }
  lines.push(`Bugs reported: ${r.bugs}; escaped from merged PRs: ${r.escaped.length}${r.escaped.length ? ` (${r.escaped.map((e) => `#${e.issue} from ${e.prs.map((p) => `#${p}`).join(',')}`).join('; ')})` : ''}`);
  if (r.timing && r.timing.length) {
    const avg = (k) => { const v = r.timing.map((t) => t[k]).filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : '-'; };
    lines.push(`Minutes per task from the issue record (${r.timing.length} PRs, average): to plan ${avg('plan')}, plan to first review ${avg('build')}, first to last review ${avg('review')}, PR open to merge ${avg('merge')}`);
  }
  return lines.join('\n');
}
