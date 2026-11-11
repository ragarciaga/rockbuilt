// Seeds for evals that run against the GitHub simulator (fake-github.mjs). Each seed gets the
// workspace (vendored, committed, `origin` a local bare repo) and returns the simulator state.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function git(ws, args) {
  const r = spawnSync('git', args, { cwd: ws, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return (r.stdout || '').trim();
}

function write(ws, rel, text) {
  mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
  writeFileSync(path.join(ws, rel), text);
}

const now = () => new Date().toISOString();

function baseState() {
  return {
    user: 'rb-bot', nextNumber: 1, nextComment: 1, issues: {}, comments: {}, labels: {}, pulls: {}, files: {},
    checkRuns: {}, statuses: {}, contents: {}, protection: { mode: 'none' }, merges: [], autoCI: true,
  };
}

// Two reviewed, green tier A PRs on different files, both behind nothing yet. A serial train
// would merge the first, leave the second behind, update it and wait for another CI run; the
// queue tests both together once and merges both without an update.
export function queueTwoPrs(ws) {
  const s = baseState();
  const issue = (title, labels) => {
    const n = s.nextNumber++;
    s.issues[n] = { number: n, title, body: `<!-- rockbuilt:task i${n} spec=none -->\n${title}`, state: 'open', labels, author: 'rb-bot', author_association: 'OWNER', created_at: now() };
    return n;
  };
  const pr = (issueNo, branch, file, text, title) => {
    git(ws, ['checkout', '-q', '-b', branch, 'main']);
    write(ws, file, text);
    git(ws, ['add', '-A']);
    git(ws, ['commit', '-q', '-m', `${title} (i${issueNo})`]);
    const head = git(ws, ['rev-parse', 'HEAD']);
    git(ws, ['push', '-q', 'origin', branch]);
    git(ws, ['checkout', '-q', 'main']);
    const n = s.nextNumber++;
    const body = [
      `## Problem\n${title}`, '', `Closes #${issueNo}`, '',
      `<!-- rockbuilt:task i${issueNo} spec=none -->`,
      '<!-- rockbuilt:tier A -->',
      `<!-- rockbuilt:timing task=i${issueNo} plan=2 implement=4 est=0.5 -->`,
      `<!-- rockbuilt:kickbacks task=i${issueNo} mechanical=0 verifier=0 auditor=0 security=0 ci=0 -->`,
      `<!-- rockbuilt:status stage=rb-verifier task=i${issueNo} outcome=pass head=${head} -->`,
    ].join('\n');
    s.issues[n] = { number: n, title, body, state: 'open', labels: ['rb:tier-a', 'rb:pr-open'], isPr: true, author: 'rb-bot', author_association: 'OWNER', created_at: now() };
    s.pulls[n] = { number: n, head: branch, base: 'main', headSha: head };
    // 0.10.0: the gate needs every review verdict posted on the task issue (DESIGN 24.2).
    s.comments[issueNo] = [...(s.comments[issueNo] || []), { id: s.nextComment++, body: `## Verifier\n\nNo findings.\n\n<!-- rockbuilt:status stage=rb-verifier task=i${issueNo} outcome=pass head=${head} -->`, user: { login: 'rb-bot' }, author_association: 'OWNER', created_at: now() }];
    return n;
  };
  const a = issue('Documentar el formato de entrada', ['rb:task', 'rb:pr-open']);
  const b = issue('Prueba para montos en cero', ['rb:task', 'rb:pr-open']);
  pr(a, `rb/i${a}-documentar-el-formato`, 'docs/formato.md', '# Formato de entrada\n\nUna lista de gastos `{description, amount, category}`, montos en COP.\n', 'docs: formato de entrada');
  pr(b, `rb/i${b}-prueba-montos-cero`, 'tests/zero.test.js', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n\ntest('zero', () => { assert.equal(0 + 0, 0); });\n", 'test: montos en cero');
  return s;
}

// One bug issue (#1) reported by the owner, for an interactive /rb-fix: the session must claim it
// (`rb claim`) and post every reviewer verdict on it, which the gate then requires (0.10.0, #34
// and #35).
export function bugIssue() {
  const s = baseState();
  const n = s.nextNumber++;
  s.issues[n] = {
    number: n, title: 'Comida y comida salen como dos categorías', state: 'open', labels: ['rb:bug'], author: 'rb-bot', author_association: 'OWNER', created_at: now(),
    body: '## Esperado\nEn el reporte de octubre una sola fila `comida` con 205000.\n\n## Actual\n`Comida` y `comida` salen como dos filas.\n\n## Pasos\n`node src/cli.js sample-expenses.json 2026-10`\n',
  };
  return s;
}

// One reviewed tier B PR (#2, task issue #1) whose branch then merged main after main gained a
// docs change that touches none of the task's files: its verifier and auditor lines name the
// pre-merge head. 0.10.0 re-dispatched both reviewers here (rockbuilt #43); the gate now confirms
// the task's change is identical and merges with the old lines, no agent.
export function carriedReview(ws) {
  const s = baseState();
  const n = s.nextNumber++;
  s.issues[n] = { number: n, title: 'Redondear totales a miles', body: `<!-- rockbuilt:task i${n} spec=none -->\nRedondear totales a miles.`, state: 'open', labels: ['rb:task', 'rb:pr-open'], author: 'rb-bot', author_association: 'OWNER', created_at: now() };
  const branch = `rb/i${n}-redondear-totales`;
  git(ws, ['checkout', '-q', '-b', branch, 'main']);
  write(ws, 'src/round.js', 'export function roundThousands(amount) {\n  return Math.round(amount / 1000) * 1000;\n}\n');
  write(ws, 'tests/round.test.js', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { roundThousands } from '../src/round.js';\n\ntest('rounds', () => { assert.equal(roundThousands(12345), 12000); });\n");
  git(ws, ['add', '-A']);
  git(ws, ['commit', '-q', '-m', `feat: redondear totales (i${n})`]);
  const reviewed = git(ws, ['rev-parse', 'HEAD']);
  git(ws, ['checkout', '-q', 'main']);
  write(ws, 'docs/notas.md', '# Notas\n\nOtra tarea cambió solo esta nota.\n');
  git(ws, ['add', '-A']);
  git(ws, ['commit', '-q', '-m', 'docs: notas (otra tarea)']);
  git(ws, ['push', '-q', 'origin', 'main']);
  git(ws, ['checkout', '-q', branch]);
  git(ws, ['merge', '-q', '--no-edit', 'main']);
  const head = git(ws, ['rev-parse', 'HEAD']);
  git(ws, ['push', '-q', 'origin', branch]);
  git(ws, ['checkout', '-q', 'main']);
  const pr = s.nextNumber++;
  const line = (stage) => `<!-- rockbuilt:status stage=${stage} task=i${n} outcome=pass head=${reviewed} -->`;
  s.issues[pr] = {
    number: pr, title: 'feat: redondear totales (i1)', state: 'open', labels: ['rb:tier-b', 'rb:pr-open'], isPr: true, author: 'rb-bot', author_association: 'OWNER', created_at: now(),
    body: ['## Problem\nRedondear totales a miles.', '', `Closes #${n}`, '', `<!-- rockbuilt:task i${n} spec=none -->`, '<!-- rockbuilt:tier B -->', line('rb-verifier'), line('rb-auditor')].join('\n'),
  };
  s.pulls[pr] = { number: pr, head: branch, base: 'main', headSha: head };
  s.comments[n] = ['rb-verifier', 'rb-auditor'].map((stage) => ({ id: s.nextComment++, body: `## ${stage}\n\nNo findings.\n\n${line(stage)}`, user: { login: 'rb-bot' }, author_association: 'OWNER', created_at: now() }));
  return s;
}

// No issues and no PRs: an owner request typed in the chat (quick mode, 0.12.0). The session
// creates the task issue itself, so it is #1.
export function empty() {
  return baseState();
}

// Three PRs merged on main five days ago that docs/progress.md never recorded (rockbuilt #67): the
// session must say progress.md is behind before trusting its objective.
export function progressStale(ws) {
  const at = '2026-11-05T15:00:00Z';
  const env = { ...process.env, GIT_COMMITTER_DATE: at, GIT_AUTHOR_DATE: at };
  const files = [['src/round.js', 'export const r = (n) => Math.round(n);\n', 'feat: redondear totales (#5)'],
    ['docs/formato.md', '# Formato\n', 'docs: formato de entrada (#6)'],
    ['src/limit.js', 'export const LIMIT = 100;\n', 'feat: limite por categoria (#7)']];
  for (const [rel, text, msg] of files) {
    write(ws, rel, text);
    git(ws, ['add', '-A']);
    const r = spawnSync('git', ['commit', '-q', '-m', msg], { cwd: ws, encoding: 'utf8', env });
    if (r.status !== 0) throw new Error(`git commit: ${r.stderr}`);
  }
  git(ws, ['push', '-q', 'origin', 'main']);
  return baseState();
}

export const SEEDS = { 'queue-two-prs': queueTwoPrs, 'bug-issue': bugIssue, 'carried-review': carriedReview, empty, 'progress-stale': progressStale };
