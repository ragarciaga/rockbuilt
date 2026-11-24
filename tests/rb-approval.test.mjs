// PLAN-1.0 A5 and A6: the owner approves the plan with their own comment; a delegation recorded on
// the control issue covers its scope until it expires. Never a flag.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvalStatus, parseDelegations, planApproval } from '../scripts/lib/approval.mjs';

const cm = (body, at, assoc = 'OWNER', author = 'owner') => ({ body, created_at: at, author_association: assoc, author });
const plan = cm('<!-- rockbuilt:plan base=abc tier=C -->\nPlan', '2026-11-20T10:00:00Z');

test('approval: an owner comment without marker, newer than the plan, that approves', () => {
  assert.equal(planApproval([plan, cm('aprobado, dale', '2026-11-20T11:00:00Z')]).words, 'aprobado, dale');
  assert.equal(planApproval([cm('aprobado', '2026-11-20T09:00:00Z'), plan]), null, 'older than the plan');
  assert.equal(planApproval([plan, cm('<!-- rockbuilt:note -->\napproved', '2026-11-20T11:00:00Z')]), null, 'the harness wrote it');
  assert.equal(planApproval([plan, cm('approved', '2026-11-20T11:00:00Z', 'NONE', 'stranger')]), null, 'untrusted author');
  assert.equal(planApproval([plan, cm('no, change the migration first', '2026-11-20T11:00:00Z')]), null, 'not an approval');
  const replan = cm('<!-- rockbuilt:plan base=def tier=C -->\nPlan v2', '2026-11-20T12:00:00Z');
  assert.equal(planApproval([plan, cm('ok', '2026-11-20T11:00:00Z'), replan]), null, 'a revised plan needs approval again');
});

test('delegation: scope, expiry, revoke, run binding, cost and irreversible out by default', () => {
  const now = '2026-11-25T12:00:00Z';
  const del = (attrs, at = '2026-11-24T10:00:00Z') => cm(`<!-- rockbuilt:delegation ${attrs} -->\n> "delego todo hasta el viernes"`, at);
  const ok = (comments, q) => approvalStatus({ reasons: ['schema'], issue: 12, controlComments: comments, at: now, ...q });
  assert.equal(ok([del('scope=all until=2026-11-28')]).how, 'delegation');
  assert.equal(ok([del('scope=all until=2026-11-24')]).ok, false, 'expired');
  assert.equal(ok([del('scope=all')]).ok, true, 'default 14 days');
  assert.equal(ok([del('scope=all', '2026-11-01T10:00:00Z')]).ok, false, 'default 14 days, expired');
  assert.equal(ok([del('scope=issues:12,15')]).ok, true);
  assert.equal(ok([del('scope=issues:13')]).ok, false);
  assert.equal(ok([del('scope=milestone:MVP')], { milestone: 'MVP' }).ok, true);
  assert.equal(ok([del('scope=milestone:MVP')], { milestone: 'Later' }).ok, false);
  assert.equal(ok([del('scope=all'), cm('<!-- rockbuilt:delegation-revoke -->\nrevoked', '2026-11-25T09:00:00Z')]).ok, false, 'revoked');
  assert.equal(ok([del('scope=all run=cycle-1')], { run: 'cycle-1' }).ok, true, 'full auto for its run');
  assert.equal(ok([del('scope=all run=cycle-1')], { run: 'cycle-2' }).ok, false, 'never another run');
  assert.equal(approvalStatus({ reasons: ['cost'], issue: 12, controlComments: [del('scope=all')], at: now }).ok, false, 'cost stays out');
  assert.equal(approvalStatus({ reasons: ['cost'], issue: 12, controlComments: [del('scope=all include=cost')], at: now }).ok, true);
  assert.equal(ok([cm('<!-- rockbuilt:delegation scope=all -->', '2026-11-24T10:00:00Z', 'NONE')]).ok, false, 'untrusted');
  assert.equal(parseDelegations([del('scope=all until=2026-11-28')], now)[0].words, '> "delego todo hasta el viernes"');
});

test('no approval reasons: nothing to ask', () => {
  assert.deepEqual(approvalStatus({ reasons: [], issue: 1 }), { ok: true, how: null });
});
