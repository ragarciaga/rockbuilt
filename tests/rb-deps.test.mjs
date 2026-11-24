// PLAN-1.0 A7: runtime dependencies outside the design are checked by code; dev dependencies are
// free; a failed check or an unreadable manifest asks the owner.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPackage, dependencyCheck } from '../scripts/lib/deps.mjs';
import { classify } from '../scripts/lib/risk.mjs';
import { cleanup, repoWith } from './rb-helpers.mjs';

const pj = (dependencies, devDependencies = {}) => JSON.stringify({ name: 'a', dependencies, devDependencies });
const riskFor = (oldDeps, newDeps, extra = []) => classify({
  files: [{ path: 'package.json', status: 'modified', additions: 1, deletions: 0, added: ['x'] }, ...extra],
  packageJson: () => ({ old: pj(oldDeps), new: pj(newDeps) }),
  baseHas: () => false,
});
const now = Date.parse('2026-11-24T00:00:00Z');
const meta = { zod: { license: 'MIT', modified: '2026-10-01T00:00:00Z' }, gpl: { license: 'GPL-3.0', modified: '2026-10-01T00:00:00Z' }, old: { license: 'MIT', modified: '2020-01-01T00:00:00Z' }, dep: { license: 'MIT', deprecated: 'use x', modified: '2026-10-01T00:00:00Z' } };
const view = (n) => meta[n] || null;

test('checkPackage: license, deprecation, maintenance, missing', () => {
  assert.deepEqual(checkPackage(meta.zod, now), []);
  assert.match(checkPackage(meta.gpl, now)[0], /license GPL-3.0/);
  assert.match(checkPackage(meta.old, now)[0], /no release since 2020-01-01/);
  assert.match(checkPackage(meta.dep, now)[0], /deprecated/);
  assert.match(checkPackage(null, now)[0], /not found/);
  assert.deepEqual(checkPackage({ license: '(MIT OR GPL-3.0)', modified: '2026-10-01' }, now), []);
});

test('dependencyCheck: only added runtime deps; the design pre-approves; other ecosystems ask', () => {
  const root = repoWith({ 'docs/specs/01-x/design.md': '# Design\nWe never use `left-pad`.\n\n## Dependencies\n- `gpl`: parsing\n' });
  try {
    assert.equal(dependencyCheck(root, riskFor({}, { zod: '^3.0.0' }), { view, now }).ok, true);
    assert.equal(dependencyCheck(root, riskFor({}, { gpl: '^1.0.0' }), { view, now }).ok, true, 'named in the approved design');
    const bad = dependencyCheck(root, riskFor({}, { old: '^1.0.0', dep: '^1.0.0' }), { view, now });
    assert.equal(bad.ok, false);
    assert.equal(bad.results.length, 2);
    const bump = dependencyCheck(root, riskFor({ zod: '^3.0.0' }, { zod: '^3.1.0' }), { view, now });
    assert.equal(bump.results.length, 1, 'a changed spec is checked too');
    assert.equal(bump.ok, true);
    assert.equal(dependencyCheck(root, riskFor({ lodash: '^4' }, { lodash: 'npm:evil-lodash@1.0.0' }), { view, now }).ok, false, 'not a registry range');
    assert.equal(dependencyCheck(root, riskFor({}, { x: '1.0.0 & echo PWNED' }), { view, now }).ok, false, 'never reaches npm');
    assert.equal(dependencyCheck(root, riskFor({}, { 'left-pad': '^1.0.0' }), { view: () => meta.old, now }).ok, false, 'a mention outside the dependencies section does not pre-approve');
    const py = classify({ files: [{ path: 'requirements.txt', status: 'modified', additions: 1, deletions: 0, added: ['requests'] }], baseHas: () => false });
    assert.equal(dependencyCheck(root, py, { view, now }).ok, false);
    const lock = classify({ files: [{ path: 'package-lock.json', status: 'modified', additions: 1, deletions: 0, added: ['x'] }], baseHas: () => false });
    assert.deepEqual(lock.checks, [], 'a lockfile alone adds nothing to check');
  } finally {
    cleanup();
  }
});
