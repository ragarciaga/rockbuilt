// Owner approval and delegated approval (DESIGN 29.5 and 29.6, PLAN-1.0 A5 and A6).
//
// Approval: the closed list in rb risk (schema, architecture, cost, irreversible, auth-model) asks
// the owner to approve the plan, never the merge. The proof is a comment on the task issue from a
// trusted author, without a harness marker (every harness comment carries one), newer than the
// newest plan comment, whose first word approves. Never a flag the agent passes.
//
// Delegation: the owner hands the approvals of a scope to the harness for a while. The skill that
// hears it records the owner's words on the control issue under
//   <!-- rockbuilt:delegation scope=<all|milestone:NAME|issues:12,15> until=YYYY-MM-DD [include=cost,irreversible] [run=<id>] -->
// A scope with run= is "full auto" for that run only (an unattended routine starts a new run id, so
// it never inherits it). Cost and irreversible stay out unless include= names them. A newer
// `<!-- rockbuilt:delegation-revoke -->` ends every delegation before it.

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const MARKER = /<!--\s*rockbuilt:/;
// A comment approves only when its whole first line is approval words (adversarial review of 1.0:
// "ok, pero no", "Si cambias el esquema...", "listo? no veo el plan" must not approve).
const APPROVE_WORDS = new Set(['aprobado', 'aprobada', 'apruebo', 'approved', 'approve', 'ok', 'okay', 'dale', 'sí', 'yes', 'lgtm', 'adelante']);
export function isApproval(body) {
  const first = String(body || '').trim().split('\n')[0].trim().toLowerCase();
  if (!first || first.includes('?')) return false;
  const words = first.replace(/[.!]+$/, '').split(/[\s,;]+/).filter(Boolean);
  return words.length > 0 && words.length <= 4 && words.every((w) => APPROVE_WORDS.has(w));
}
export const DELEGATION_DAYS = 14;
export const DELEGATION_MAX_DAYS = 90;
const ALWAYS_OUT = ['cost', 'irreversible'];

const trusted = (cm) => TRUSTED.has(cm.author_association);
const time = (iso) => Date.parse(iso || '');

// The approvals a plan declares on its marker line (`approvals=schema,cost` or `none`).
export function planDeclared(body) {
  const m = String(body || '').match(/^<!--\s*rockbuilt:plan\b[^>]*\bapprovals=([\w,-]+)/m);
  return m ? m[1].split(',').filter((x) => x && x !== 'none') : [];
}

// The owner's approval of the newest plan, or null. `canApprove(login)` says whether the author
// may approve (write access or more); the plan's last edit counts as its time.
export function planApproval(comments, { canApprove = () => true } = {}) {
  const plans = comments.filter((cm) => trusted(cm) && /^<!--\s*rockbuilt:plan\b/m.test(cm.body || ''));
  if (!plans.length) return null;
  const plan = plans[plans.length - 1];
  const planAt = Math.max(time(plan.created_at), time(plan.updated_at) || 0);
  const ok = comments.filter((cm) => trusted(cm) && !MARKER.test(cm.body || '') && time(cm.created_at) > planAt && isApproval(cm.body) && canApprove(cm.author));
  if (!ok.length) return null;
  const a = ok[ok.length - 1];
  return { by: a.author || null, at: a.created_at, words: String(a.body).trim().split('\n')[0].slice(0, 200), planAt: plan.created_at, declared: planDeclared(plan.body) };
}

function addDays(iso, days) {
  return new Date(time(iso) + days * 86400000).toISOString().slice(0, 10);
}

// Delegations in force at `at`, newest first.
export function parseDelegations(comments, at = new Date().toISOString(), { canApprove = () => true } = {}) {
  const out = [];
  let revokedAt = -Infinity;
  for (const cm of comments) {
    if (!trusted(cm)) continue;
    if (/^\s*<!--\s*rockbuilt:delegation-revoke\s*-->/.test(cm.body || '')) revokedAt = Math.max(revokedAt, time(cm.created_at));
  }
  for (const cm of comments) {
    if (!trusted(cm) || !canApprove(cm.author)) continue;
    // Anchored: a digest or report that quotes a marker mid-comment is not a delegation.
    const m = String(cm.body || '').match(/^\s*<!--\s*rockbuilt:delegation\s+([^>]*?)\s*-->/);
    if (!m || time(cm.created_at) <= revokedAt) continue;
    const kv = Object.fromEntries([...m[1].matchAll(/([\w-]+)=(\S+)/g)].map((x) => [x[1], x[2]]));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(kv.until || '')) continue;
    const cap = addDays(cm.created_at, DELEGATION_MAX_DAYS);
    const until = kv.until > cap ? cap : kv.until;
    if (`${until}T23:59:59Z` < at) continue;
    const scope = kv.scope || 'all';
    const words = String(cm.body).replace(m[0], '').trim().split('\n').find((l) => l.trim()) || '';
    out.push({ scope, until, include: (kv.include || '').split(',').filter((x) => ALWAYS_OUT.includes(x)), run: kv.run || null, at: cm.created_at, by: cm.author || null, words: words.slice(0, 200) });
  }
  return out.sort((a, b) => time(b.at) - time(a.at));
}

export function delegationCovers(d, { issue, milestone = null, reasons = [], run = null }) {
  if (d.run && d.run !== run) return false;
  const [kind, value = ''] = d.scope.split(':');
  if (kind === 'issues') {
    if (!value.split(',').map((x) => Number(x.replace('#', ''))).includes(Number(issue))) return false;
  } else if (kind === 'milestone') {
    if (!milestone || milestone.toLowerCase() !== value.toLowerCase().replace(/_/g, ' ')) return false;
  } else if (kind !== 'all') return false;
  return reasons.every((r) => !ALWAYS_OUT.includes(r) || d.include.includes(r));
}

// { ok, how: 'owner' | 'delegation' | null, detail }
export function approvalStatus({ reasons, issueComments = [], controlComments = [], issue, milestone = null, run = null, at = new Date().toISOString(), canApprove = () => true }) {
  if (!reasons.length) return { ok: true, how: null };
  const a = planApproval(issueComments, { canApprove });
  // The owner approved what the plan said needs approval; a reason the plan never named was not
  // approved (adversarial review: "ok" on an approvals=none plan approved a migration).
  const missing = a ? reasons.filter((r) => !a.declared.includes(r)) : reasons;
  if (a && !missing.length) return { ok: true, how: 'owner', approval: a };
  const d = parseDelegations(controlComments, at, { canApprove }).find((x) => delegationCovers(x, { issue, milestone, reasons, run }));
  if (d) return { ok: true, how: 'delegation', delegation: d };
  if (a) return { ok: false, how: null, detail: `the approved plan on #${issue} does not name ${missing.join(', ')}: re-plan with approvals=${reasons.join(',')} and ask again` };
  return { ok: false, how: null, detail: `needs the owner's approval of the plan on #${issue} (${reasons.join(', ')}): a comment from the owner that says only "aprobado" (or "approved"), newer than the plan, or a delegation that covers it` };
}

// rb delegate: the skill that hears the owner delegate records their words, verbatim, on the
// control issue. Scope: all | milestone:<name> | issues:12,15. The words are required: a
// delegation without the owner's words is a flag the agent passed.
export function recordDelegation(c, ops, ensureControl, { scope = 'all', until = null, include = [], run = null, words, at = new Date().toISOString() }) {
  if (!words || !String(words).trim()) throw new Error('--words "<the owner\'s words, verbatim>" is required');
  if (!/^(all|milestone:\S+|issues:#?\d+(,#?\d+)*)$/.test(scope)) throw new Error('--scope must be all, milestone:<name> (spaces as _) or issues:12,15');
  const end = until || addDays(at, DELEGATION_DAYS);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('--until must be YYYY-MM-DD');
  if (end < at.slice(0, 10)) throw new Error(`--until ${end} is in the past`);
  if (end > addDays(at, DELEGATION_MAX_DAYS)) throw new Error(`--until is more than ${DELEGATION_MAX_DAYS} days away; ask the owner for a closer date`);
  const bad = include.filter((x) => !ALWAYS_OUT.includes(x));
  if (bad.length) throw new Error(`--include takes cost and irreversible only (got ${bad.join(', ')})`);
  const attrs = [`scope=${scope.replace(/#/g, '')}`, `until=${end}`, include.length ? `include=${include.join(',')}` : null, run ? `run=${run}` : null].filter(Boolean).join(' ');
  const ctl = ensureControl(c);
  const quoted = String(words).trim().split('\n').map((l) => `> ${l}`).join('\n');
  ops.issueComment(c, ctl.number, `<!-- rockbuilt:delegation ${attrs} -->\n${quoted}\n\nDelegated approval: ${scope}${run ? ` for run ${run} only` : ''}, until ${end}${include.length ? `, including ${include.join(' and ')}` : ''}. Merges it covers say "merged by delegation". Revoke: rb delegate revoke.`);
  return { control: ctl.number, scope, until: end, include, run };
}

export function revokeDelegations(c, ops, ensureControl, { words = '' } = {}) {
  const ctl = ensureControl(c);
  ops.issueComment(c, ctl.number, `<!-- rockbuilt:delegation-revoke -->\nEvery delegation before this comment is revoked.${words ? `\n> ${words}` : ''}`);
  return { control: ctl.number, revoked: true };
}
