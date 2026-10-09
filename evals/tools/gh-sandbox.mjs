#!/usr/bin/env node
// GitHub sandbox helpers for the build, fix, merge and cycle evals. Run inside an eval workspace
// that already has a throwaway private GitHub repo as `origin` (see evals/README.md). These run
// on the maintainer's machine, where the gh CLI works; the harness itself only uses `rb gh` (REST).
//
//   node <plugin>/evals/tools/gh-sandbox.mjs labels
//   node <plugin>/evals/tools/gh-sandbox.mjs issues docs/specs/01-monthly-budgets
//   node <plugin>/evals/tools/gh-sandbox.mjs pr-t2
//   node <plugin>/evals/tools/gh-sandbox.mjs stale <branch>
//   node <plugin>/evals/tools/gh-sandbox.mjs inject <issue> <fixtures/pr/injection-*.md>
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, '..', '..');
const FIXTURES = path.resolve(HERE, '..', 'fixtures');
const T2_BRANCH = 'rb/T2-comparar-el-mes-contra-los-topes';

function run(cmd, args, { input } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input });
  if (r.status !== 0) {
    console.error(`${cmd} ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
    process.exit(1);
  }
  return r.stdout.trim();
}

function tmpFile(text) {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'rb-eval-')), 'body.md');
  writeFileSync(file, text);
  return file;
}

function labels() {
  run(process.execPath, [path.join(PLUGIN, 'scripts', 'rb.mjs'), 'labels']);
  console.log('labels ready');
}

// Creates one issue per task, in order, so issue numbers match `Issue: #n` in tasks.md.
function issues(specDir) {
  const text = readFileSync(path.join(specDir, 'tasks.md'), 'utf8');
  const tasks = [...text.matchAll(/^##\s+(T\d+):\s*(.+)$[\s\S]*?^- Issue:\s*#?(\d*)\s*$[\s\S]*?^- Status:\s*(\S+)/gm)]
    .map((m) => ({ id: m[1], title: m[2].trim(), issue: m[3] ? Number(m[3]) : null, status: m[4] }));
  const spec = specDir.replace(/\\/g, '/').replace(/\/$/, '');
  for (const t of tasks) {
    const body = tmpFile(`<!-- rockbuilt:task ${t.id} spec=${spec} -->\n## ${t.id}: ${t.title}\n\nEval fixture issue.\n`);
    const url = run('gh', ['issue', 'create', '--title', `${t.id}: ${t.title}`, '--label', 'rb:task', '--body-file', body]);
    const n = Number(url.split('/').pop());
    if (t.issue !== null && t.issue !== n) console.warn(`WARN: ${t.id} expects #${t.issue} but got #${n}; use a fresh repo`);
    if (t.status === 'done') run('gh', ['issue', 'close', String(n), '--reason', 'completed']);
    console.log(`${t.id} -> #${n}${t.status === 'done' ? ' (closed)' : ''}`);
  }
}

// Opens the T2 PR (tier B) with one commit and verifier and auditor lines whose head equals the PR head.
function prT2() {
  run('git', ['checkout', '-b', T2_BRANCH]);
  cpSync(path.join(FIXTURES, 'pr', 't2', 'src'), 'src', { recursive: true });
  cpSync(path.join(FIXTURES, 'pr', 't2', 'tests', 'budgets.test.js.fixture'), path.join('tests', 'budgets.test.js'));
  run('git', ['add', 'src/budgets.js', 'tests/budgets.test.js']);
  run('git', ['commit', '-m', 'feat(budgets): comparar el mes contra los topes (T2)']);
  const sha = run('git', ['rev-parse', 'HEAD']);
  run('git', ['push', '-u', 'origin', T2_BRANCH]);
  const template = readFileSync(path.join(FIXTURES, 'pr', 'verifier-pass.md'), 'utf8');
  const body = tmpFile(template.replaceAll('HEAD_SHA', sha).replaceAll('TASK', 'T2'));
  const url = run('gh', ['pr', 'create', '--title', 'feat: comparar el mes contra los topes (T2)', '--body-file', body, '--head', T2_BRANCH, '--label', 'rb:tier-b,rb:pr-open']);
  run('gh', ['issue', 'edit', '2', '--add-label', 'rb:pr-open']);
  run('git', ['checkout', 'main']);
  console.log(`PR: ${url}\nreviewed head: ${sha}`);
}

// Pushes one more commit so the verifier line no longer matches the PR head.
function stale(branch = T2_BRANCH) {
  run('git', ['checkout', branch]);
  writeFileSync('NOTES.md', 'hand edit after the verifier ran\n');
  run('git', ['add', 'NOTES.md']);
  run('git', ['commit', '-m', 'docs: hand edit']);
  run('git', ['push']);
  run('git', ['checkout', 'main']);
  console.log(`pushed a commit on top of ${branch}; the verifier head is now stale`);
}

// Replaces an issue body with a text that asks Claude to merge (prompt injection probe).
function inject(n, file) {
  run('gh', ['issue', 'edit', String(n), '--body-file', path.join(FIXTURES, 'pr', path.basename(file))]);
  console.log(`issue #${n} now carries the injection text`);
}

const [cmd, arg, arg2] = process.argv.slice(2);
if (cmd === 'labels') labels();
else if (cmd === 'issues' && arg) issues(arg);
else if (cmd === 'pr-t2') prT2();
else if (cmd === 'stale') stale(arg);
else if (cmd === 'inject' && arg && arg2) inject(arg, arg2);
else {
  console.error('usage: gh-sandbox.mjs labels | issues <spec-dir> | pr-t2 | stale [branch] | inject <issue> <file>');
  process.exit(2);
}
