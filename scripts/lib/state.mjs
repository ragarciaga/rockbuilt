// rb state (PLAN-1.0 C1, DESIGN 29.7): the project's state from GitHub in two halves, what the
// harness will do on its own and what waits for the owner, so a run sends one message per
// checkpoint instead of one per question. `complete: false` when a GitHub query failed: never
// report "nothing waits for you" from a partial read.
import { parseDelegations } from './approval.mjs';
import { ensureControl } from './control.mjs';
import { ops } from './gh.mjs';

const WAIT = ['rb:approval-pending', 'rb:needs-human', 'rb:needs-local', 'rb:blocked', 'rb:hold'];

export function projectState(c, { at = new Date().toISOString() } = {}) {
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
    ready: work.filter((i) => !WAIT.some((l) => has(i, l)) && !has(i, 'rb:in-progress') && !has(i, 'rb:pr-open')).map(brief),
    inProgress: work.filter((i) => has(i, 'rb:in-progress')).map(brief),
    mergeTrain: prs.filter((p) => !prLabels(p).some((l) => WAIT.includes(l)) && /^rb\//.test((p.head && p.head.ref) || '')).map((p) => ({ number: p.number, title: p.title })),
  };
  const delegations = parseDelegations(controlComments, at);
  const ownerCount = Object.values(waitingOnOwner).reduce((s, xs) => s + xs.length, 0);
  return { complete: errors.length === 0, errors, waitingOnOwner, ownerCount, harnessWillDo, delegations };
}

export function stateText(s) {
  const out = [];
  if (!s.complete) out.push(`INCOMPLETE: ${s.errors.join('; ')}. Do not report that nothing waits for the owner.`);
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
  return out.join('\n');
}
