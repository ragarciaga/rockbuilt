// PLAN-1.0 item 0.2: the field baseline (evals/tools/field-baseline.mjs) counts tiers, reviewer
// kickbacks, reverts, escaped bugs and owner interventions from a dump of a project's GitHub data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baselineRepo, tierOf, toMarkdown } from '../evals/tools/field-baseline.mjs';

const status = (stage, outcome) => `<!-- rockbuilt:status stage=${stage} outcome=${outcome} head=abc -->`;

const dump = {
  prs: [
    { number: 10, title: 'Task 1', head: 'rb/task-1', labels: ['rb:tier-c'], merged_at: '2026-11-01T10:00:00Z', body: 'Closes #1\n<!-- rockbuilt:kickbacks task=1 mechanical=1 ci=0 verifier=9 -->' },
    { number: 11, title: 'Task 2', head: 'rb/task-2', labels: [], merged_at: '2026-11-03T10:00:00Z', body: 'Closes #2\n<!-- rockbuilt:tier B -->\n<!-- rockbuilt:quick -->' },
    { number: 12, title: 'Docs', head: 'claude/x', labels: [], merged_at: '2026-11-03T12:00:00Z', body: 'no markers' },
    { number: 13, title: 'Revert "Task 1"', head: 'rb/revert-10', labels: [], merged_at: null, body: '' },
  ],
  issues: [
    { number: 20, labels: ['rb:bug'], body: 'Introduced by #10', is_pr: false },
    { number: 21, labels: ['rb:bug'], body: 'Introduced by #99', is_pr: false },
    { number: 22, labels: ['rb:bug'], body: 'Introduced by #10', is_pr: true },
  ],
  comments: [
    { issue: 1, body: `${status('rb-planner', 'plan')}` },
    { issue: 1, body: `${status('rb-verifier', 'fail')}\n${status('rb-security-reviewer', 'fail')}` },
    { issue: 1, body: status('rb-verifier', 'pass') },
    { issue: 1, body: '<!-- rockbuilt:escalation kind=tier-c -->\nApprove?' },
    { issue: 2, body: status('rb-planner', 'plan') },
    { issue: 10, body: 'Merged by `rb merge-gate` (tier C, human approved). To undo: ...' },
    { issue: 11, body: 'Merged by `rb merge-gate` (tier B). To undo: ...' },
  ],
};

test('field baseline: tiers, reviewer kickbacks from issue verdicts, interventions per calendar day', () => {
  const r = baselineRepo(dump);
  assert.equal(r.merged, 3);
  assert.deepEqual(r.tiers, { A: 0, B: 1, C: 1, none: 1 });
  assert.equal(r.tierCShare, 50);
  assert.equal(r.quick, 1);
  // Verdicts on the issue win over the PR line for reviewers; mechanical still comes from the line.
  assert.deepEqual(r.review.C.kickbacks, { verifier: 1, auditor: 0, security: 1, mechanical: 1, ci: 0 });
  assert.equal(r.review.C.withKickback, 1);
  // A planner line alone is not review data.
  assert.equal(r.review.B.withReviewData, 0);
  assert.equal(r.review.all.withReviewData, 1);
  assert.deepEqual(r.reverts, [13]);
  assert.equal(r.bugs, 2);
  assert.deepEqual(r.escaped, [20]);
  // 1 escalation + 1 human-approved gate merge + 1 merge with no gate comment, over Nov 1 to 3.
  assert.deepEqual(r.interventions, { escalations: 1, humanApproved: 1, byHand: 1, total: 3, perDay: 1 });
  assert.match(toMarkdown({ 'o/r': r }), /\| o\/r \| 3 \| 3 \| 0\/1\/1\/1 \| 50 \|/);
});

test('field baseline: the tier label wins over the body line', () => {
  assert.equal(tierOf({ labels: ['rb:tier-a'], body: '<!-- rockbuilt:tier C -->' }), 'A');
  assert.equal(tierOf({ labels: [], body: '<!-- rockbuilt:tier B -->\n<!-- rockbuilt:tier C -->' }), 'C');
  assert.equal(tierOf({ labels: [], body: '' }), null);
});
