// rb state (PLAN-1.0 C1, DESIGN 29.7): the project's state from GitHub in two halves, what the
// harness will do on its own and what waits for the owner, so a run sends one message per
// checkpoint instead of one per question. `complete: false` when a GitHub query failed: never
// report "nothing waits for you" from a partial read.
import { parseDelegations } from './approval.mjs';
import { ensureControl } from './control.mjs';
import { ops } from './gh.mjs';
import { versionStatus } from './doctor.mjs';
import { latestAttackReport } from './attack.mjs';
import { headerField, readContract } from './contract.mjs';
import { now } from './util.mjs';

const WAIT = ['rb:approval-pending', 'rb:needs-human', 'rb:needs-local', 'rb:blocked', 'rb:hold'];
// PLAN-1.0 D5: review follow-ups wait outside every queue until the owner promotes them.
const OUT = ['rb:unplanned', 'rb:parked'];

export function projectState(c, { at = now().toISOString(), root = null } = {}) {
  const errors = [];
  const tryRead = (what, fn, fallback) => {
    try { return fn(); } catch (e) { errors.push(`${what}: ${e.message}`); return fallback; }
  };
  const issues = tryRead('issues', () => ops.issueList(c, { state: 'open', maxPages: 20 }), []);
  const prs = tryRead('pull requests', () => ops.prList(c, { state: 'open', maxPages: 10 }), []);
  const ctl = tryRead('control issue', () => ensureControl(c, { create: false }), null);
  const controlComments = ctl ? tryRead('control comments', () => ops.issueComments(c, ctl.number), []) : [];
  const brief = (i) => ({ number: i.number, title: i.title });
  const has = (i, l) => (i.labels || []).includes(l);
  const prLabels = (p) => (p.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const work = issues.filter((i) => has(i, 'rb:task') || has(i, 'rb:bug'));
  const waitingOnOwner = {
    approvals: issues.filter((i) => has(i, 'rb:approval-pending')).map(brief),
    questions: issues.filter((i) => has(i, 'rb:needs-human') && !has(i, 'rb:approval-pending')).map(brief),
    local: issues.filter((i) => has(i, 'rb:needs-local')).map(brief),
    blocked: issues.filter((i) => has(i, 'rb:blocked')).map(brief),
    held: issues.filter((i) => has(i, 'rb:hold')).map(brief),
    pullRequests: prs.filter((p) => prLabels(p).some((l) => ['rb:approval-pending', 'rb:hold', 'rb:needs-human'].includes(l))).map((p) => ({ number: p.number, title: p.title, labels: prLabels(p).filter((l) => WAIT.includes(l)) })),
  };
  const harnessWillDo = {
    ready: work.filter((i) => ![...WAIT, ...OUT].some((l) => has(i, l)) && !has(i, 'rb:in-progress') && !has(i, 'rb:pr-open')).map(brief),
    inProgress: work.filter((i) => has(i, 'rb:in-progress')).map(brief),
    mergeTrain: prs.filter((p) => !prLabels(p).some((l) => WAIT.includes(l)) && /^rb\//.test((p.head && p.head.ref) || '')).map((p) => ({ number: p.number, title: p.title })),
  };
  const followups = { unplanned: issues.filter((i) => has(i, 'rb:unplanned')).map(brief), parked: issues.filter((i) => has(i, 'rb:parked')).map(brief) };
  const delegations = parseDelegations(controlComments, at);
  const ownerCount = Object.values(waitingOnOwner).reduce((s, xs) => s + xs.length, 0);
  const harness = root ? versionStatus(root) : null;
  // PLAN-1.0 H1 and H5: critical attack findings come before everything; the launch milestone
  // (`Launch: YYYY-MM-DD` in AGENTS.md) is reminded while no attack report exists.
  const launchBlockers = issues.filter((i) => has(i, 'rb:launch-blocker')).map(brief);
  return { complete: errors.length === 0, errors, launchBlockers, launch: root ? launchInfo(root, at) : null, waitingOnOwner, ownerCount, harnessWillDo, followups, delegations, harness };
}

export function launchInfo(root, at = now().toISOString()) {
  const raw = (headerField(readContract(root).text, 'Launch') || '').trim();
  const date = (raw.match(/^\d{4}-\d{2}-\d{2}\b/) || [])[0] || null;
  const live = /^live\b/i.test(raw);
  // A value that is neither a date, `live` nor `not set` is reported, never read as "not set".
  const unreadable = Boolean(raw) && !date && !live && !/^(not set|none|-)\b/i.test(raw) ? raw : null;
  const attackReport = latestAttackReport(root);
  const daysLeft = date ? Math.ceil((Date.parse(`${date}T00:00:00Z`) - Date.parse(at)) / 86400000) : null;
  return { date, live, set: Boolean(date) || live, unreadable, daysLeft, attackReport };
}

export function stateText(s) {
  const out = [];
  if (s.launchBlockers && s.launchBlockers.length) out.push(`LAUNCH BLOCKERS (${s.launchBlockers.length}): ${s.launchBlockers.map((x) => `#${x.number} ${x.title}`).join('; ')}. No launch to real users while open.`);
  if (s.launch && s.launch.set && !s.launch.attackReport) out.push(s.launch.live ? 'Live with real users and no attack report: run /rb-attack.' : `Launch ${s.launch.date} (${s.launch.daysLeft >= 0 ? `in ${s.launch.daysLeft} days` : `${-s.launch.daysLeft} days ago`}): no attack report yet: run /rb-attack before real users arrive.`);
  if (s.launch && s.launch.unreadable) out.push(`AGENTS.md "Launch: ${s.launch.unreadable}" is not YYYY-MM-DD, live or not set: fix it so the launch reminder works.`);
  if (!s.complete) out.push(`INCOMPLETE: ${s.errors.join('; ')}. Do not report that nothing waits for the owner.`);
  if (s.harness && s.harness.behind) out.push(`Rockbuilt ${s.harness.vendored} in this project, ${s.harness.plugin} available: say "update rockbuilt"`);
  for (const d of s.delegations) out.push(`Delegation in force: ${d.scope}${d.run ? ` (run ${d.run})` : ''} until ${d.until}: ${d.words}`);
  const w = s.waitingOnOwner;
  const list = (name, xs) => { if (xs.length) out.push(`${name}: ${xs.map((x) => `#${x.number} ${x.title}`).join('; ')}`); };
  out.push(`Waiting for the owner (${s.ownerCount}):`);
  list('  plans to approve', w.approvals);
  list('  questions', w.questions);
  list('  steps on their machine', w.local);
  list('  blocked', w.blocked);
  list('  on hold', w.held);
  list('  pull requests', w.pullRequests);
  const h = s.harnessWillDo;
  out.push('The harness will do on its own:');
  list('  ready', h.ready);
  list('  in progress', h.inProgress);
  list('  merge train', h.mergeTrain);
  if (s.followups && (s.followups.unplanned.length || s.followups.parked.length)) {
    out.push('Follow-ups (outside the queue until you promote them with rb:task):');
    list('  unplanned', s.followups.unplanned);
    list('  parked', s.followups.parked);
  }
  return out.join('\n');
}
