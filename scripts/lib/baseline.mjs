// rb baseline: run the Verification commands, parse runner counts, ratchet against known failures
// (DESIGN.md section 17). In a linked worktree the baseline and the known-failures list are the
// main checkout's (git rev-parse --git-common-dir).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isTemplate, readContract, sectionCommands } from './contract.mjs';
import { currentBranch, defaultBranch, headSha, isLinkedWorktree, mainCheckoutRoot } from './repo.mjs';
import { CliError, readJson, readText } from './util.mjs';

export const KNOWN_FAILURES = path.join('docs', 'rockbuilt', 'known-failures.json');

export function baselineFile(root) {
  return path.join(mainCheckoutRoot(root), '.rockbuilt', 'baseline.json');
}

export function knownFailuresFile(root) {
  return path.join(mainCheckoutRoot(root), KNOWN_FAILURES);
}

export function readBaseline(root) {
  return readJson(baselineFile(root));
}

export function readKnownFailures(root) {
  const j = readJson(knownFailuresFile(root));
  return j && typeof j.commands === 'object' && j.commands ? j : { commands: {} };
}

export function lastLines(output, n = 3) {
  return output.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-n);
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

// Counts and failing test names from node --test (TAP and spec), vitest, jest, pytest, playwright.
export function parseRunnerOutput(raw) {
  const out = raw.replace(ANSI, '');
  const counts = {};
  const failing = new Set();
  let runner = null;
  const set = (k, v) => { counts[k] = (counts[k] || 0) + Number(v); };

  // node --test, TAP reporter
  const tapPass = out.match(/^# pass (\d+)/m);
  const tapFail = out.match(/^# fail (\d+)/m);
  if (tapPass || tapFail) {
    runner = 'node-test';
    if (tapPass) set('passed', tapPass[1]);
    if (tapFail) set('failed', tapFail[1]);
    const sk = out.match(/^# skipped (\d+)/m);
    if (sk) set('skipped', sk[1]);
    for (const m of out.matchAll(/^\s*not ok \d+ - (.+?)\s*(?:#\s*(SKIP|TODO).*)?$/gm)) if (!m[2]) failing.add(m[1].trim());
  }
  // node --test, spec reporter
  const specPass = out.match(/^ℹ pass (\d+)/m);
  const specFail = out.match(/^ℹ fail (\d+)/m);
  if (!runner && (specPass || specFail)) {
    runner = 'node-test';
    if (specPass) set('passed', specPass[1]);
    if (specFail) set('failed', specFail[1]);
    const failSection = out.split(/^✖ failing tests:/m)[1];
    if (failSection) for (const m of failSection.matchAll(/^\s*✖ (.+?)(?: \([\d.]+m?s\))?$/gm)) failing.add(m[1].trim());
  }
  // vitest: "Tests  1 failed | 3 passed (4)"
  const vt = out.match(/^\s*Tests\s+(.+)\(\d+\)\s*$/m);
  if (!runner && vt && /passed|failed/.test(vt[1])) {
    runner = 'vitest';
    for (const m of vt[1].matchAll(/(\d+)\s+(passed|failed|skipped|todo)/g)) set(m[2] === 'todo' ? 'skipped' : m[2], m[1]);
    for (const m of out.matchAll(/^\s*FAIL\s+(.+?)\s*$/gm)) if (m[1].includes('>')) failing.add(m[1].trim());
  }
  // jest: "Tests:       1 failed, 3 passed, 4 total"
  const jt = out.match(/^Tests:\s+(.+)$/m);
  if (!runner && jt) {
    runner = 'jest';
    for (const m of jt[1].matchAll(/(\d+)\s+(passed|failed|skipped|todo)/g)) set(m[2] === 'todo' ? 'skipped' : m[2], m[1]);
    for (const m of out.matchAll(/^\s*● (.+?)\s*$/gm)) if (!/Test suite failed to run/.test(m[1])) failing.add(m[1].trim());
  }
  // pytest: "==== 1 failed, 3 passed in 0.12s ===="
  const pt = out.match(/^=+ (.*\b(?:passed|failed|error)\b.*) in [\d.]+s.* =+$/m);
  if (!runner && pt) {
    runner = 'pytest';
    for (const m of pt[1].matchAll(/(\d+) (passed|failed|skipped|errors?|xfailed|xpassed)/g)) set(m[2].startsWith('error') ? 'failed' : m[2], m[1]);
    for (const m of out.matchAll(/^(?:FAILED|ERROR) (\S+)/gm)) failing.add(m[1]);
  }
  // playwright: "  1 failed" / "  3 passed (5.2s)"
  if (!runner && /^\s+\d+ (passed|failed)( \(|$)/m.test(out) && /playwright|\[chromium\]|\[firefox\]|\[webkit\]|›/.test(out)) {
    runner = 'playwright';
    for (const m of out.matchAll(/^\s+(\d+) (passed|failed|skipped|flaky)\b/gm)) set(m[2] === 'flaky' ? 'passed' : m[2], m[1]);
    const failBlock = out.split(/^\s+\d+ failed\s*$/m)[1];
    if (failBlock) {
      for (const line of failBlock.split(/\r?\n/)) {
        const m = line.match(/^\s+(\[[^\]]+\] › .+?)\s*$/);
        if (m) failing.add(m[1]);
        else if (/^\s+\d+ (passed|skipped|flaky)/.test(line)) break;
      }
    }
  }
  return { runner, counts, failingTests: [...failing] };
}

// Commands are user-authored shell lines, so they run through the shell.
export function runCommand(cmd, cwd, onStart = () => {}) {
  onStart(cmd);
  const started = Date.now();
  // A parent node --test sets NODE_TEST_CONTEXT, which would turn a nested node --test silent and green.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(cmd, { cwd, env, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  const output = `${r.stdout || ''}\n${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}`;
  const parsed = parseRunnerOutput(output);
  return {
    cmd,
    exitCode: typeof r.status === 'number' ? r.status : 1,
    durationMs: Date.now() - started,
    summary: lastLines(output),
    runner: parsed.runner,
    counts: parsed.counts,
    failingTests: parsed.failingTests,
  };
}

// Ratchet: a command is acceptable when it passed, is allowed to fail, or fails only on known tests.
export function evaluateRatchet(results, known) {
  const verdicts = results.map((r) => {
    const k = known.commands[r.cmd] || {};
    const list = Array.isArray(k.knownFailingTests) ? k.knownFailingTests : [];
    if (r.exitCode === 0) return { cmd: r.cmd, ok: true, newFailures: [], fixed: list };
    if (k.allowFailure) return { cmd: r.cmd, ok: true, newFailures: [], fixed: [], allowed: true };
    if (!r.failingTests.length) return { cmd: r.cmd, ok: false, newFailures: [`exit ${r.exitCode} (no parseable test names)`], fixed: [] };
    const fresh = r.failingTests.filter((t) => !list.includes(t));
    return { cmd: r.cmd, ok: fresh.length === 0, newFailures: fresh, fixed: list.filter((t) => !r.failingTests.includes(t)) };
  });
  return { green: verdicts.every((v) => v.ok), verdicts, shrinkable: verdicts.filter((v) => v.fixed.length).map((v) => ({ cmd: v.cmd, tests: v.fixed })) };
}

function verificationCommands(root) {
  const { file, text } = readContract(root);
  if (isTemplate(text)) {
    throw new CliError(`${file} is still the rb vendor template; write the real project values and Verification commands first`);
  }
  const commands = sectionCommands(text, 'Verification');
  if (!commands || commands.length === 0) throw new CliError(`no commands found under "## Verification" in ${file || 'AGENTS.md'}`);
  return commands;
}

// Runs in `root`. Writes the baseline record only for the main checkout.
export function runBaseline(root, { log = () => {} } = {}) {
  const commands = verificationCommands(root);
  const results = commands.map((cmd) => runCommand(cmd, root, (c) => log(`running: ${c}`)));
  const ratchet = evaluateRatchet(results, readKnownFailures(root));
  const worktree = isLinkedWorktree(root);
  const record = {
    sha: headSha(root),
    branch: currentBranch(root),
    date: new Date().toISOString(),
    commands: results,
    exitGreen: results.every((r) => r.exitCode === 0),
    green: ratchet.green,
    ratchet,
    worktree,
  };
  if (!worktree) {
    mkdirSync(path.dirname(baselineFile(root)), { recursive: true });
    writeFileSync(baselineFile(root), `${JSON.stringify(record, null, 2)}\n`);
  }
  return record;
}

// --check: reuse a green main-checkout baseline when the default branch has not moved, else re-run there.
export function checkBaseline(root, opts = {}) {
  const main = mainCheckoutRoot(root);
  const previous = readBaseline(main);
  const branch = defaultBranch(main);
  const tip = headSha(main, branch) || headSha(main);
  if (previous && previous.green && previous.sha && previous.sha === tip) {
    return { reran: false, moved: false, defaultBranch: branch, root: main, record: previous };
  }
  const record = runBaseline(main, opts);
  return { reran: true, moved: Boolean(previous && previous.sha !== tip), defaultBranch: branch, root: main, record };
}

// --accept: write the current failures into known-failures.json (tier C: the human decides).
export function acceptBaseline(root, record) {
  const file = knownFailuresFile(root);
  const known = readKnownFailures(root);
  const added = [];
  for (const r of record.commands) {
    if (r.exitCode === 0) continue;
    const entry = known.commands[r.cmd] || { allowFailure: false, knownFailingTests: [] };
    if (r.failingTests.length) {
      const fresh = r.failingTests.filter((t) => !entry.knownFailingTests.includes(t));
      entry.knownFailingTests = [...entry.knownFailingTests, ...fresh];
      added.push(...fresh.map((t) => ({ cmd: r.cmd, test: t })));
    } else if (!entry.allowFailure) {
      entry.allowFailure = true;
      added.push({ cmd: r.cmd, allowFailure: true });
    }
    known.commands[r.cmd] = entry;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(known, null, 2)}\n`);
  return { file, added, known };
}

export function hasKnownFailuresFile(root) {
  return readText(knownFailuresFile(root)) !== null;
}
