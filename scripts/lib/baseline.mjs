// rb baseline: run the Verification commands and record the result.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readClaudeMd, sectionCommands } from './claudemd.mjs';
import { currentBranch, defaultBranch, headSha } from './repo.mjs';
import { CliError, readText } from './util.mjs';

export function baselineFile(root) {
  return path.join(root, '.rockbuilt', 'baseline.json');
}

export function readBaseline(root) {
  const text = readText(baselineFile(root));
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function lastLines(output, n = 3) {
  return output.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-n);
}

// Commands are user-authored shell lines, so they run through the shell.
export function runCommand(cmd, cwd, onStart = () => {}) {
  onStart(cmd);
  const started = Date.now();
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  const output = `${r.stdout || ''}\n${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}`;
  return {
    cmd,
    exitCode: typeof r.status === 'number' ? r.status : 1,
    durationMs: Date.now() - started,
    summary: lastLines(output),
  };
}

export function runBaseline(root, { log = () => {} } = {}) {
  const text = readClaudeMd(root);
  // A CLAUDE.md still holding the rb init template would run placeholder commands and record a
  // misleading red baseline. Refuse until the real commands are written.
  if (text !== null && (/^#\s*<Project name>/m.test(text) || /^Project type:\s*</m.test(text))) {
    throw new CliError('CLAUDE.md is still the rb init template; write the real project values and Verification commands first');
  }
  const commands = sectionCommands(text, 'Verification');
  if (!commands || commands.length === 0) {
    throw new CliError('no commands found under "## Verification" in CLAUDE.md');
  }
  const results = commands.map((cmd) => runCommand(cmd, root, (c) => log(`running: ${c}`)));
  const record = {
    sha: headSha(root),
    branch: currentBranch(root),
    date: new Date().toISOString(),
    commands: results,
    green: results.every((r) => r.exitCode === 0),
  };
  mkdirSync(path.dirname(baselineFile(root)), { recursive: true });
  writeFileSync(baselineFile(root), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

// --check: reuse a green baseline when the default branch has not moved, otherwise re-run.
export function checkBaseline(root, opts = {}) {
  const previous = readBaseline(root);
  const branch = defaultBranch(root);
  const tip = headSha(root, branch) || headSha(root);
  if (previous && previous.green && previous.sha && previous.sha === tip) {
    return { reran: false, moved: false, defaultBranch: branch, record: previous };
  }
  const record = runBaseline(root, opts);
  return { reran: true, moved: Boolean(previous && previous.sha !== tip), defaultBranch: branch, record };
}
