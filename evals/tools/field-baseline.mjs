#!/usr/bin/env node
// Quality and interruption baseline of projects that use Rockbuilt (PLAN-1.0, item 0.2).
//
// Usage: node evals/tools/field-baseline.mjs <dump.json> [--md]
//
// The dump is fetched outside this script (the projects are private and live under other
// accounts) and never committed, because it holds client issue and PR text. Shape:
//   { "<owner>/<repo>": {
//       "prs":      [{ number, title, body, created_at, merged_at, head, labels: [name] }],
//       "issues":   [{ number, title, body, labels: [name], is_pr }],
//       "comments": [{ issue, body, created_at, user }] } }
// "comments" is the repo-wide issue comment list (GET /repos/{o}/{r}/issues/comments), so PR
// comments are included.
//
// Definitions (the same sources rb quality reads, scripts/lib/quality.mjs):
// - tier: the PR's rb:tier-<x> label, else its last `<!-- rockbuilt:tier X -->` line.
// - kickbacks: reviewer verdicts with outcome=fail on the task issue the PR closes (or is part
//   of); mechanical and ci from the PR's kickbacks line. A PR with neither has no review data
//   (planner lines do not count: before 0.10.0 reviewers did not post verdicts on the issue).
// - reverts: rb/revert-* branches or titles starting with "Revert".
// - escaped bugs: rb:bug issues whose body says "Introduced by #<n>" for a merged PR.
// - owner interventions: escalation comments (a question to the owner), merges through
//   `rb merge-gate --human-approved`, and merges with no merge-gate comment (done by hand).
//   Per day = total over the calendar days from the first to the last merge, both included.
import { readFileSync } from 'node:fs';

const REVIEWERS = { 'rb-verifier': 'verifier', 'rb-auditor': 'auditor', 'rb-security-reviewer': 'security' };
const SOURCES = ['verifier', 'auditor', 'security', 'mechanical', 'ci'];
const kv = (s) => Object.fromEntries([...String(s).matchAll(/([\w-]+)=(\S+)/g)].map((m) => [m[1], m[2]]));
const day = (iso) => String(iso).slice(0, 10);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

export function tierOf(pr) {
  for (const l of pr.labels || []) {
    const m = /^rb:tier-([abc])$/.exec(l);
    if (m) return m[1].toUpperCase();
  }
  const lines = [...String(pr.body || '').matchAll(/rockbuilt:tier\s+([ABC])\b/g)];
  return lines.length ? lines[lines.length - 1][1] : null;
}

function emptyBucket() {
  return { merged: 0, withReviewData: 0, withKickback: 0, kickbacks: Object.fromEntries(SOURCES.map((s) => [s, 0])) };
}

export function baselineRepo(data) {
  const byIssue = new Map();
  for (const c of data.comments) {
    if (!byIssue.has(c.issue)) byIssue.set(c.issue, []);
    byIssue.get(c.issue).push(c);
  }
  const merged = data.prs.filter((p) => p.merged_at);
  const mergedNums = new Set(merged.map((p) => p.number));
  const tiers = { A: 0, B: 0, C: 0, none: 0 };
  const byTier = { A: emptyBucket(), B: emptyBucket(), C: emptyBucket(), none: emptyBucket(), all: emptyBucket() };
  let humanApproved = 0;
  let byHand = 0;
  let quick = 0;
  for (const p of merged) {
    const body = String(p.body || '');
    const t = tierOf(p) || 'none';
    tiers[t]++;
    if (body.includes('rockbuilt:quick')) quick++;
    const gate = (byIssue.get(p.number) || []).filter((c) => String(c.body).includes('Merged by `rb merge-gate`'));
    if (!gate.length) byHand++;
    else if (gate[gate.length - 1].body.includes('human approved')) humanApproved++;

    const k = Object.fromEntries(SOURCES.map((s) => [s, 0]));
    const lines = [...body.matchAll(/rockbuilt:kickbacks\s+([^>]*?)\s*-->/g)];
    const line = lines.length ? kv(lines[lines.length - 1][1]) : null;
    if (line) for (const s of ['mechanical', 'ci']) k[s] += Number(line[s] || 0);
    const issue = [...body.matchAll(/(?:Closes|Fixes|Resolves|Part of)\s+#(\d+)/gi)].map((m) => Number(m[1]))[0];
    const verdicts = issue
      ? (byIssue.get(issue) || []).flatMap((c) => [...String(c.body).matchAll(/<!--\s*rockbuilt:status\s+([^>]*?)\s*-->/g)].map((m) => kv(m[1])))
          .filter((v) => REVIEWERS[v.stage])
      : [];
    if (verdicts.length) {
      for (const v of verdicts) if (v.outcome === 'fail') k[REVIEWERS[v.stage]]++;
    } else if (line) {
      for (const s of ['verifier', 'auditor', 'security']) k[s] += Number(line[s] || 0);
    }
    for (const b of [byTier[t], byTier.all]) {
      b.merged++;
      if (!verdicts.length && !line) continue;
      b.withReviewData++;
      if (SOURCES.some((s) => k[s])) b.withKickback++;
      for (const s of SOURCES) b.kickbacks[s] += k[s];
    }
  }
  const reverts = data.prs.filter((p) => String(p.head).startsWith('rb/revert-') || /^revert/i.test(p.title || '')).map((p) => p.number);
  const bugs = data.issues.filter((i) => !i.is_pr && (i.labels || []).includes('rb:bug'));
  const escaped = bugs
    .filter((i) => [...String(i.body || '').matchAll(/introduced (?:by|in) #(\d+)/gi)].some((m) => mergedNums.has(Number(m[1]))))
    .map((i) => i.number);
  const escalations = data.comments.filter((c) => String(c.body).includes('rockbuilt:escalation')).length;
  const days = merged.map((p) => day(p.merged_at)).sort();
  const spanDays = days.length ? Math.round((Date.parse(days[days.length - 1]) - Date.parse(days[0])) / 86400000) + 1 : 0;
  const interventions = escalations + humanApproved + byHand;
  const leveled = tiers.A + tiers.B + tiers.C;
  return {
    prs: data.prs.length,
    merged: merged.length,
    span: days.length ? [days[0], days[days.length - 1]] : null,
    spanDays,
    tiers,
    tierCShare: pct(tiers.C, leveled),
    quick,
    review: byTier,
    kickbackShare: pct(byTier.all.withKickback, byTier.all.withReviewData),
    reverts,
    bugs: bugs.length,
    escaped,
    interventions: { escalations, humanApproved, byHand, total: interventions, perDay: spanDays ? Math.round((interventions / spanDays) * 10) / 10 : null },
  };
}

export function baseline(dump) {
  return Object.fromEntries(Object.entries(dump).map(([repo, data]) => [repo, baselineRepo(data)]));
}

const cell = (v) => (v == null ? 'no data' : String(v));

export function toMarkdown(b) {
  const out = [];
  out.push('| Repo | Merged PRs | Days | Tier A/B/C/none | % C | Quick marker | Reverts | Bugs (escaped) | Owner interventions (escalations + approved merges + by hand) | Per day |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const [repo, r] of Object.entries(b)) {
    const i = r.interventions;
    out.push(`| ${repo} | ${r.merged} | ${r.spanDays} | ${r.tiers.A}/${r.tiers.B}/${r.tiers.C}/${r.tiers.none} | ${cell(r.tierCShare)} | ${r.quick} | ${r.reverts.length} | ${r.bugs} (${r.escaped.length}) | ${i.total} (${i.escalations} + ${i.humanApproved} + ${i.byHand}) | ${cell(i.perDay)} |`);
  }
  out.push('');
  out.push('| Repo | Tier | PRs with review data | With at least one kickback | verifier | auditor | security | mechanical | ci |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  for (const [repo, r] of Object.entries(b)) {
    for (const t of ['A', 'B', 'C', 'none', 'all']) {
      const x = r.review[t];
      if (!x.merged) continue;
      const share = x.withReviewData ? `${x.withKickback} (${pct(x.withKickback, x.withReviewData)}%)` : 'no data';
      const k = x.kickbacks;
      const name = t;
      out.push(`| ${repo} | ${name} | ${x.withReviewData} of ${x.merged} | ${share} | ${k.verifier} | ${k.auditor} | ${k.security} | ${k.mechanical} | ${k.ci} |`);
    }
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('field-baseline.mjs')) {
  const file = process.argv[2];
  if (!file || file === '--help') {
    console.log('Usage: node evals/tools/field-baseline.mjs <dump.json> [--md]');
    process.exit(file ? 0 : 1);
  }
  const b = baseline(JSON.parse(readFileSync(file, 'utf8')));
  console.log(process.argv.includes('--md') ? toMarkdown(b) : JSON.stringify(b, null, 2));
}
