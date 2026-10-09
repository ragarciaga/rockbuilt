import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { parseTasks } from '../scripts/lib/spec.mjs';
import { setTaskStatus, taskRefFromPr } from '../scripts/lib/sync.mjs';
import { REPO, cleanup, commitAll, fakeGh, rb, rbJson, read, repoWith, sh, write } from './rb-helpers.mjs';

after(cleanup);

const TASKS_EN = `# Tasks: Budgets
Spec: docs/specs/01-budgets/  |  Status: approved

## T1: Store budgets
- Purpose: Persist.
- Covers: R1.1
- Size: S
- Depends on: none
- Files: src/a.js
- Verify: \`npm test\`
- Issue: #3
- Status:   in-review   (PR #10)

### Decision log
- Status: todo is prose here and must not change.

## T2: Compare
- Purpose: Compare.
- Covers: R1.2
- Size: S
- Depends on: T1
- Files: src/b.js
- Verify: \`npm test\`
- Status: todo
`;

const TASKS_ES = `# Tareas: Topes
Spec: docs/specs/02-topes/  |  Estado: approved

## T1: Guardar topes
- Propósito: Persistir.
- Cubre: R1.1
- Tamaño: S
- Depende de: ninguno
- Archivos: src/c.js, src/c.test.js
- Verificar: \`npm test -- c\`
- Incidencia: #5
- Estado: en revisión

## T2: Alertas
- Proposito: Avisar.
- Cubre: R1.2
- Tamano: M
- Depende de: T1
- Archivos: src/d.js
- Verificar: \`npm test -- d\`
- Estado: en progreso
`;

test('tasks: Spanish keys and statuses map to canonical English', () => {
  const p = parseTasks(TASKS_ES);
  assert.deepEqual(p.errors, []);
  assert.equal(p.feature, 'Topes');
  assert.deepEqual(p.tasks[0], {
    id: 'T1', title: 'Guardar topes', purpose: 'Persistir.', covers: ['R1.1'], size: 'S', depends: [],
    files: ['src/c.js', 'src/c.test.js'], verify: ['npm test -- c'], issue: 5, status: 'in-review',
  });
  assert.equal(p.tasks[1].status, 'in-progress');
  assert.equal(p.tasks[1].size, 'M');
  assert.deepEqual(p.tasks[1].depends, ['T1']);
  assert.equal(p.spanishStatus, true);
  for (const [v, s] of [['hecho', 'done'], ['pendiente', 'todo'], ['bloqueado', 'blocked'], ['en revision', 'in-review'], ['done (merged #4)', 'done']]) {
    assert.equal(parseTasks(`## T1: x\n- Status: ${v}\n`).tasks[0].status, s, v);
  }
});

test('rb tasks: unknown keys and statuses are errors', async () => {
  const root = repoWith({
    'docs/specs/01-x/tasks.md': '# Tasks: X\n\n## T1: a\n- Purpose: p\n- Owner: me\n- Verify: `npm test`\n- Status: finished\n',
  });
  const r = await rbJson(root, ['tasks', 'docs/specs/01-x']);
  assert.equal(r.code, 1);
  assert.ok(r.json.problems.some((p) => /unknown key "Owner"/.test(p)));
  assert.ok(r.json.problems.some((p) => /unknown status "finished"/.test(p)));
  const ok = repoWith({ 'docs/specs/02-y/tasks.md': TASKS_ES });
  assert.equal((await rb(ok, ['tasks', 'docs/specs/02-y'])).code, 0);
});

test('setTaskStatus keeps key, bullet and spacing; only the task block, not the decision log', () => {
  const r = setTaskStatus(TASKS_EN, 'T1', false);
  assert.equal(r.changed, true);
  assert.match(r.text, /^- Status:   done$/m);
  assert.match(r.text, /^- Status: todo is prose here/m);
  assert.match(r.text, /## T2: Compare[\s\S]*- Status: todo$/m);
  const es = setTaskStatus(TASKS_ES, 'T2', true);
  assert.match(es.text, /^- Estado: hecho$/m);
  assert.equal(setTaskStatus(TASKS_EN, 'T9', false).changed, false);
});

test('taskRefFromPr: body marker first, branch name fallback', () => {
  assert.deepEqual(taskRefFromPr({ body: 'x <!-- rockbuilt:task T4 spec=docs/specs/01-a/ --> y', head: { ref: 'rb/T9-z' } }), { id: 'T4', spec: 'docs/specs/01-a', via: 'marker' });
  assert.deepEqual(taskRefFromPr({ body: '', head: { ref: 'rb/T2-login-form' } }), { id: 'T2', spec: null, slug: 'login-form', via: 'branch' });
  assert.equal(taskRefFromPr({ body: '', head: { ref: 'feature/x' } }), null);
});

test('rb sync: marks tasks done from merged PRs, deletes merged branches, repairs labels', async () => {
  const root = repoWith({ 'docs/specs/01-budgets/tasks.md': TASKS_EN, 'docs/specs/02-topes/tasks.md': TASKS_ES, 'src/a.js': 'a\n' });
  sh(root, 'git', ['remote', 'add', 'origin', `https://github.com/${REPO}`]);
  // rb/T2-alertas: squash merged (tip equals the PR head); rb/T3-wip: unmerged work kept.
  sh(root, 'git', ['checkout', '-q', '-b', 'rb/T2-alertas']);
  write(root, 'src/d.js', 'd\n');
  const tip = commitAll(root, 'T2');
  sh(root, 'git', ['checkout', '-q', 'main']);
  sh(root, 'git', ['checkout', '-q', '-b', 'rb/T3-wip']);
  write(root, 'src/e.js', 'e\n');
  commitAll(root, 'wip');
  sh(root, 'git', ['checkout', '-q', 'main']);
  sh(root, 'git', ['branch', 'rb/T5-merged']);

  const gh = fakeGh();
  const s = gh.state;
  const pr = (n, head, body, merged = true, headSha = 'f'.repeat(40)) => {
    s.issues[n] = { number: n, title: `PR ${n}`, body, state: 'closed', labels: [], isPr: true };
    s.pulls[n] = { number: n, head, base: 'main', headSha, merged_at: merged ? '2026-10-08T00:00:00Z' : null };
  };
  pr(10, 'rb/T1-store', '<!-- rockbuilt:task T1 spec=docs/specs/01-budgets -->');
  pr(11, 'rb/T2-alertas', 'no marker', true, tip);
  pr(12, 'rb/T2-compare', 'closed without merge', false);
  s.issues[3] = { number: 3, title: 'T1', body: '', state: 'closed', labels: ['rb:task', 'rb:in-progress', 'rb:pr-open'] };
  s.issues[4] = { number: 4, title: 'T9', body: '', state: 'open', labels: ['rb:in-progress'] };

  const r = await rbJson(root, ['sync'], { ghRunner: gh.runner });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.tasks.map((t) => `${t.spec} ${t.task} #${t.pr} ${t.via}`).sort(), ['docs/specs/01-budgets T1 #10 marker', 'docs/specs/02-topes T2 #11 branch']);
  assert.deepEqual(r.json.ambiguous, []);
  assert.match(read(root, 'docs/specs/01-budgets/tasks.md'), /^- Status:   done$/m);
  // T2 in 02-topes matched through the branch slug "alertas".
  assert.match(read(root, 'docs/specs/02-topes/tasks.md'), /## T2: Alertas[\s\S]*- Estado: hecho/);
  assert.match(read(root, 'docs/specs/01-budgets/tasks.md'), /## T2: Compare[\s\S]*- Status: todo$/m);
  const deleted = r.json.branches.deleted.map((b) => b.branch).sort();
  assert.deepEqual(deleted, ['rb/T2-alertas', 'rb/T5-merged']);
  assert.deepEqual(r.json.branches.kept.map((b) => b.branch), ['rb/T3-wip']);
  assert.deepEqual(s.issues[3].labels, ['rb:task']);
  assert.deepEqual(s.issues[4].labels, ['rb:in-progress'], 'open issues are left alone');

  const again = await rbJson(root, ['sync'], { ghRunner: gh.runner });
  assert.deepEqual(again.json.tasks, [], 'idempotent');

  // With the lock held, a stale claim on an open issue without an open PR is cleared.
  s.issues[5] = { number: 5, title: 'T8', body: '', state: 'open', labels: ['rb:in-progress', 'rb:pr-open'] };
  assert.equal((await rbJson(root, ['lock', 'acquire', '--run', 'r1'], { ghRunner: gh.runner })).code, 0);
  await rbJson(root, ['sync', '--run', 'r1'], { ghRunner: gh.runner });
  assert.deepEqual(s.issues[4].labels, [], 'stale claim cleared');
  assert.deepEqual(s.issues[5].labels, ['rb:in-progress', 'rb:pr-open'], 'claim with an open PR kept');
});

test('rb sync without GitHub degrades: local branches only, github skipped', async () => {
  const root = repoWith({ 'docs/specs/01-budgets/tasks.md': TASKS_EN });
  sh(root, 'git', ['branch', 'rb/T7-done']);
  const r = await rbJson(root, ['sync']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.json.github, /^skipped/);
  assert.deepEqual(r.json.branches.deleted.map((b) => b.branch), ['rb/T7-done']);
});
