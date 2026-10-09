#!/usr/bin/env node
// Builds a reproducible eval workspace from overlays in evals/fixtures/.
// Usage: node evals/tools/setup-fixture.mjs <dest> <overlay...> [--then <overlay...>] [--no-git] [--remote]
// Overlays before --then are committed on main; overlays after --then stay uncommitted.
// Files stored as <name>.fixture are copied as <name> (keeps fixture tests out of the plugin's
// own `node --test` run). --remote creates a local bare repo <dest>.origin.git as `origin` and
// pushes main to it, so `git pull --ff-only` works without GitHub.
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const args = process.argv.slice(2);
const noGit = args.includes('--no-git');
const remote = args.includes('--remote');
const rest = args.filter((a) => a !== '--no-git' && a !== '--remote');
const dest = rest.shift();
if (!dest) {
  console.error('usage: setup-fixture.mjs <dest> <overlay...> [--then <overlay...>] [--no-git]');
  process.exit(2);
}
const split = rest.indexOf('--then');
const before = split === -1 ? rest : rest.slice(0, split);
const after = split === -1 ? [] : rest.slice(split + 1);

const target = path.resolve(dest);
if (existsSync(target) && readdirSync(target).length > 0) {
  console.error(`refusing: ${target} exists and is not empty`);
  process.exit(1);
}
mkdirSync(target, { recursive: true });

function copy(name) {
  const src = path.join(FIXTURES, name);
  if (!existsSync(src)) {
    console.error(`unknown overlay: ${name} (see evals/fixtures/)`);
    process.exit(1);
  }
  cpSync(src, target, { recursive: true, force: true });
  stripSuffix(target);
  console.log(`copied ${name}`);
}

function stripSuffix(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) stripSuffix(full);
    else if (e.name.endsWith('.fixture')) {
      const real = full.slice(0, -'.fixture'.length);
      if (existsSync(real)) rmSync(real);
      renameSync(full, real);
    }
  }
}

function git(...a) {
  const r = spawnSync('git', a, { cwd: target, encoding: 'utf8', shell: false });
  if (r.status !== 0) {
    console.error(`git ${a.join(' ')} failed: ${r.stderr}`);
    process.exit(1);
  }
}

before.forEach(copy);
if (!noGit) {
  git('init', '-b', 'main');
  git('config', 'user.name', 'Rockbuilt Eval');
  git('config', 'user.email', 'eval@example.com');
  git('add', '-A');
  git('commit', '-m', 'chore: eval fixture', '--allow-empty');
  console.log('committed on main');
  if (remote) {
    const bare = `${target}.origin.git`;
    const r = spawnSync('git', ['init', '--bare', '-b', 'main', bare], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(`git init --bare failed: ${r.stderr}`);
      process.exit(1);
    }
    git('remote', 'add', 'origin', bare);
    git('push', '-u', 'origin', 'main');
    console.log(`origin: ${bare}`);
  }
}
after.forEach(copy);
console.log(`ready: ${target}`);
