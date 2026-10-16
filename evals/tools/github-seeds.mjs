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
    return n;
  };
  const a = issue('Documentar el formato de entrada', ['rb:task', 'rb:pr-open']);
  const b = issue('Prueba para montos en cero', ['rb:task', 'rb:pr-open']);
  pr(a, `rb/i${a}-documentar-el-formato`, 'docs/formato.md', '# Formato de entrada\n\nUna lista de gastos `{description, amount, category}`, montos en COP.\n', 'docs: formato de entrada');
  pr(b, `rb/i${b}-prueba-montos-cero`, 'tests/zero.test.js', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n\ntest('zero', () => { assert.equal(0 + 0, 0); });\n", 'test: montos en cero');
  return s;
}

export const SEEDS = { 'queue-two-prs': queueTwoPrs };
