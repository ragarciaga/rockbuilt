// Unattended-run state in GitHub (DESIGN.md section 9): control issue, lock, stop switch, escalation, digest.
import { ops } from './gh.mjs';
import { CliError, now } from './util.mjs';

export const CONTROL_TITLE = 'Rockbuilt control';
export const LOCK_STALE_MS = 3 * 60 * 60 * 1000;
export const LOCK_RENEW_MIN = 30;

const CONTROL_BODY = [
  '<!-- rockbuilt:control -->',
  'Rockbuilt control issue. Unattended runs take the lock here (label `rb:running`) and post one digest',
  'comment per run. Add the label `rb:stop` to this issue (or to any open issue) to stop runs.',
  'Do not close this issue.',
].join('\n');

// Comment reads page up to 2000 comments; rotate well before that so the latest lock event stays visible.
export const CONTROL_ROTATE_AT = 1500;

// Finds the open control issue (label rb:control, else by title) or creates it. A full control
// issue that is not locked or stopped is closed and replaced by a fresh one.
export function ensureControl(c, { create = true } = {}) {
  let list = ops.issueList(c, { labels: ['rb:control'], state: 'open' });
  if (!list.length) list = ops.issueList(c, { state: 'open' }).filter((i) => i.title === CONTROL_TITLE);
  if (list.length) {
    const issue = list.sort((a, b) => a.number - b.number)[0];
    if (!issue.labels.includes('rb:control')) ops.labelAdd(c, issue.number, ['rb:control']);
    const full = (issue.comment_count || 0) >= CONTROL_ROTATE_AT;
    if (!(full && create && !issue.labels.includes('rb:running') && !issue.labels.includes('rb:stop'))) {
      return { number: issue.number, created: false, labels: issue.labels };
    }
    ops.labelsEnsure(c);
    const next = ops.issueCreate(c, { title: CONTROL_TITLE, body: `${CONTROL_BODY}\nPrevious control issue: #${issue.number}.`, labels: ['rb:control'] });
    ops.issueComment(c, issue.number, `<!-- rockbuilt:rotated to=${next.number} -->\nThis control issue is full; continued in #${next.number}.`);
    ops.labelRemove(c, issue.number, 'rb:control');
    ops.issueEdit(c, issue.number, { state: 'closed' });
    return { number: next.number, created: true, labels: next.labels, rotatedFrom: issue.number };
  }
  if (!create) return null;
  ops.labelsEnsure(c);
  const issue = ops.issueCreate(c, { title: CONTROL_TITLE, body: CONTROL_BODY, labels: ['rb:control'] });
  return { number: issue.number, created: true, labels: issue.labels };
}

const LOCK_RE = /<!--\s*rockbuilt:(lock|unlock)\s+run=(\S+)\s+at=(\S+)\s*-->/;

// Lock state from the control issue labels and its latest lock/unlock comment.
export function lockState(c, control, at = now()) {
  const view = ops.issueView(c, control);
  const events = view.comments.map((cm) => {
    const m = cm.body.match(LOCK_RE);
    return m ? { kind: m[1], run: m[2], at: Date.parse(m[3]) || Date.parse(cm.created_at) } : null;
  }).filter(Boolean);
  const last = events[events.length - 1] || null;
  const labelled = view.labels.includes('rb:running');
  if (!labelled || !last || last.kind !== 'lock') {
    return { control, held: false, run: null, at: null, ageMinutes: null, stale: false, labelled };
  }
  const age = at.getTime() - last.at;
  // A run renews its lock with more lock comments (acquire by the same run); `since` is when it
  // took it (the oldest of its consecutive lock comments; another run's event in between ends it), and
  // `runMinutes` is the run's age for time budgets (`ageMinutes` is the time since the last renewal).
  let first = last.at;
  for (let k = events.length - 1; k >= 0 && events[k].kind === 'lock' && events[k].run === last.run; k--) first = events[k].at;
  return {
    control, held: age < LOCK_STALE_MS, run: last.run, at: new Date(last.at).toISOString(), since: new Date(first).toISOString(),
    ageMinutes: Math.round(age / 60000), runMinutes: Math.round((at.getTime() - first) / 60000), stale: age >= LOCK_STALE_MS, labelled,
  };
}

function runId(id) {
  if (!id || id === true || !/^[A-Za-z0-9._:-]+$/.test(String(id))) throw new CliError('--run <id> is required (letters, digits, . _ : -)', 2);
  return String(id);
}

export function acquireLock(c, run) {
  const id = runId(run);
  const control = ensureControl(c).number;
  const at = now();
  const st = lockState(c, control, at);
  if (st.held && st.run !== id) return { acquired: false, control, holder: st.run, since: st.at, ageMinutes: st.ageMinutes };
  // The same run asking again renews the lock once it is 30 minutes old, so a long run never goes
  // stale while it works (3d_brain cycle-4889aa8-pwzk: merge-gate refused at 189 min).
  if (st.held && st.run === id && st.ageMinutes < LOCK_RENEW_MIN) return { acquired: true, control, run: id, already: true };
  if (st.held && st.run === id) {
    const iso = at.toISOString();
    ops.issueComment(c, control, `<!-- rockbuilt:lock run=${id} at=${iso} -->\nLock renewed by run \`${id}\` at ${iso}.`);
    return { acquired: true, control, run: id, already: true, renewed: true };
  }
  ops.labelAdd(c, control, ['rb:running']);
  const iso = at.toISOString();
  const note = st.stale ? ` (took over a stale lock from run ${st.run}, ${st.ageMinutes} min old)` : '';
  ops.issueComment(c, control, `<!-- rockbuilt:lock run=${id} at=${iso} -->\nLock acquired by run \`${id}\` at ${iso}${note}.`);
  // Lost a race when another run's lock comment landed after ours.
  const after = lockState(c, control, at);
  if (after.run !== id) return { acquired: false, control, holder: after.run, since: after.at, race: true };
  return { acquired: true, control, run: id, tookOverStale: Boolean(st.stale), previous: st.stale ? st.run : null };
}

export function releaseLock(c, run) {
  const id = runId(run);
  const control = ensureControl(c).number;
  const st = lockState(c, control);
  if (st.held && st.run !== id) return { released: false, control, holder: st.run, reason: `lock held by run ${st.run}` };
  if (st.labelled) ops.labelRemove(c, control, 'rb:running');
  const iso = now().toISOString();
  ops.issueComment(c, control, `<!-- rockbuilt:unlock run=${id} at=${iso} -->\nLock released by run \`${id}\` at ${iso}.`);
  return { released: true, control, run: id };
}

export function lockStatus(c) {
  const control = ensureControl(c, { create: false });
  if (!control) return { control: null, held: false, run: null, stale: false, detail: 'no control issue yet' };
  return lockState(c, control.number);
}

// Stop switch: any open issue labelled rb:stop (the control issue included).
// The label-filtered list lags a few seconds behind label changes (seen live: 3 to 6 s), so the
// control issue is also read directly, which is immediate. Either source saying stop means stop.
export function stopStatus(c) {
  const issues = ops.issueList(c, { labels: ['rb:stop'], state: 'open' }).map((i) => ({ number: i.number, title: i.title }));
  const control = ensureControl(c, { create: false });
  if (control && !issues.some((i) => i.number === control.number)) {
    const view = ops.issueView(c, control.number);
    if (view.state === 'open' && view.labels.includes('rb:stop')) issues.unshift({ number: control.number, title: view.title });
  }
  return { stop: issues.length > 0, issues };
}

// With renew, a run whose own lock went stale (no other run took it) renews it and still holds it.
export function holdsLock(c, run, { renew = false } = {}) {
  const control = ensureControl(c, { create: false });
  if (!control) return { held: false, detail: 'no control issue' };
  let st = lockState(c, control.number);
  if (renew && st.run === String(run)) {
    const a = acquireLock(c, run);
    if (a.acquired) st = lockState(c, control.number);
  }
  if (!st.held) return { held: false, detail: st.stale ? `lock is stale (run ${st.run}, ${st.ageMinutes} min)` : 'lock not held' };
  if (st.run !== String(run)) return { held: false, detail: `lock held by run ${st.run}` };
  return { held: true, detail: `held by run ${run}`, since: st.since };
}

// A tier C plan reaches the human only after the security reviewer read it (rb-build step 3b):
// the newest trusted plan comment says tier=C, so a `mode=plan` security status line must be newer.
// Prose alone was skipped (eval build-tier-c-escalates, 0.6.0 and 0.7.0): the orchestrator escalated
// the planner's open question first and never reached 3b.
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export function requirePlanReview(c, issue) {
  const view = ops.issueView(c, issue);
  // Only the first escalation of a plan that is not yet approved or built: later escalations on
  // the same issue (blocked task, CI red, merge conflict) and plans from before 0.8.0 that were
  // already approved never stall on it.
  if (['rb:approved', 'rb:pr-open', 'rb:blocked'].some((l) => view.labels.includes(l))) return;
  const comments = view.comments.filter((cm) => TRUSTED.has(cm.author_association));
  let plan = -1;
  for (let i = comments.length - 1; i >= 0; i--) {
    if (/^<!--\s*rockbuilt:plan\b[^>]*\btier=C\b/im.test(comments[i].body)) { plan = i; break; }
    if (/^<!--\s*rockbuilt:plan\b/im.test(comments[i].body)) return;
  }
  if (plan === -1) return;
  const after = comments.slice(plan);
  if (after.slice(1).some((cm) => /<!--\s*rockbuilt:escalation\b/.test(cm.body) || /<!--\s*rockbuilt:status\s+[^>]*stage=rb-verifier/.test(cm.body))) return;
  const reviewed = after.some((cm) => /<!--\s*rockbuilt:status\s+[^>]*stage=rb-security-reviewer[^>]*\bmode=plan\b/.test(cm.body));
  if (!reviewed) throw new CliError(`#${issue} has a tier C plan without its security read: dispatch rb-security-reviewer with Mode: plan, post its verdict on the issue (rb-build step 3b), then escalate`, 3);
}

export function escalate(c, issue, { kind, title, body }) {
  if (!['human', 'local'].includes(kind)) throw new CliError('--kind must be human or local', 2);
  if (!title) throw new CliError('--title is required', 2);
  const label = kind === 'human' ? 'rb:needs-human' : 'rb:needs-local';
  const text = `<!-- rockbuilt:escalation kind=${kind} -->\n### ${title}\n\n${body || ''}`.trimEnd();
  let number = issue;
  let created = false;
  if (String(issue) === 'new') {
    const i = ops.issueCreate(c, { title, body: text, labels: [label] });
    return { issue: i.number, created: true, label, kind };
  }
  if (kind === 'human') requirePlanReview(c, number);
  ops.labelAdd(c, number, [label]);
  ops.issueComment(c, number, text);
  number = Number(String(number).replace(/^#/, ''));
  return { issue: number, created, label, kind };
}

export function postDigest(c, text) {
  const control = ensureControl(c).number;
  const iso = now().toISOString();
  const comment = ops.issueComment(c, control, `<!-- rockbuilt:digest at=${iso} -->\n${text.trim()}\n`);
  return { control, comment: comment.id, at: iso };
}

// Flaky candidates (DESIGN 21): a test that failed and then passed on a re-run with no code change.
// Recorded as marked comments on the control issue, never skipped; rb-retro reads the counts.
const FLAKY_RE = /<!--\s*rockbuilt:flaky\s+test=(\S+)\s+pr=(\S+)\s+at=(\S+)\s*-->/;

export function recordFlaky(c, { test, pr = null, note = '' }) {
  if (!test) throw new CliError('usage: rb flaky record <test id, e.g. e2e/atlas.spec.ts:1256> [--pr <n>] [--note <text>]', 2);
  const control = ensureControl(c).number;
  const iso = now().toISOString();
  const body = `<!-- rockbuilt:flaky test=${encodeURIComponent(test)} pr=${pr || 'none'} at=${iso} -->\nFlaky candidate: \`${test}\` failed and passed on a re-run with no code change${pr ? ` (PR #${pr})` : ''}.${note ? ` ${note}` : ''}`;
  const comment = ops.issueComment(c, control, body);
  return { control, comment: comment.id, test, pr, at: iso };
}

export function listFlaky(c) {
  const issues = ops.issueList(c, { labels: ['rb:control'], state: 'all' });
  const byTest = new Map();
  for (const i of issues) {
    for (const cm of ops.issueComments(c, i.number)) {
      const m = String(cm.body || '').match(FLAKY_RE);
      if (!m) continue;
      const test = decodeURIComponent(m[1]);
      const row = byTest.get(test) || { test, count: 0, prs: [], last: null };
      row.count += 1;
      if (m[2] !== 'none' && !row.prs.includes(Number(m[2]))) row.prs.push(Number(m[2]));
      if (!row.last || m[3] > row.last) row.last = m[3];
      byTest.set(test, row);
    }
  }
  return [...byTest.values()].sort((a, b) => b.count - a.count || String(b.last).localeCompare(String(a.last)));
}
