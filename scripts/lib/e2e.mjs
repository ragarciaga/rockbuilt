// E2E sharding for CI (DESIGN 21, rb e2e-plan and rb verify-cmds E2E --shard i/n).
import { CliError } from './util.mjs';
import { headerField, sectionCommands } from './contract.mjs';

export const MAX_SHARDS = 8;

// AGENTS.md header `E2E shards: <1-8>`; 1 when unset.
export function e2eShards(text) {
  const raw = headerField(text || '', 'E2E shards');
  if (raw === null || raw === '') return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SHARDS) throw new CliError(`E2E shards must be a whole number from 1 to ${MAX_SHARDS} (AGENTS.md says "${raw}")`);
  return n;
}

// The suite command: Playwright run directly (optional VAR=x prefixes), or the conventional script
// names for it. Everything else (install, build:e2e, e2e:seed, docker compose) runs unchanged on
// every shard.
const ENV_PREFIX = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*`;
const DIRECT = new RegExp(String.raw`^${ENV_PREFIX}(?:npx|bunx|pnpm\s+exec|pnpm|yarn)\s+playwright\s+test(?:\s|$)`);
const SCRIPT = new RegExp(String.raw`^${ENV_PREFIX}(npm\s+run(?:-script)?|pnpm(?:\s+run)?|yarn(?:\s+run)?|bun\s+run)\s+(test:e2e|e2e|test:playwright|playwright)(?:\s|$)`);
const COMPOUND = /&&|\|\||[;|&]/;

// Appends arguments to the Playwright suite command(s) (`--` for npm scripts). Throws when no line
// is a suite command, or a suite command is part of a compound line (the arguments would land on
// the wrong command).
export function appendSuiteArgs(commands, args, why = 'E2E') {
  let hits = 0;
  const extra = args.join(' ');
  const out = commands.map((cmd) => {
    const direct = DIRECT.test(cmd);
    const script = cmd.match(SCRIPT);
    if (!direct && !script) return cmd;
    if (COMPOUND.test(cmd)) throw new CliError(`cannot pass ${why} arguments to "${cmd}": put the Playwright command on its own line under ## E2E`);
    hits++;
    if (script && script[1].startsWith('npm')) return /\s--(\s|$)/.test(cmd) ? `${cmd} ${extra}` : `${cmd} -- ${extra}`;
    return `${cmd} ${extra}`;
  });
  if (!hits) throw new CliError(`${why}: no line under ## E2E runs the suite (npx playwright test, or an npm/pnpm/yarn script named test:e2e, e2e, test:playwright or playwright)`);
  return out;
}

// Shard i of n of the suite. One shard: the commands unchanged.
export function shardCommands(commands, index, total) {
  if (total === 1) return [...commands];
  try {
    return appendSuiteArgs(commands, [`--shard=${index}/${total}`], 'E2E shards');
  } catch (e) {
    throw new CliError(`${e.message}; set E2E shards: 1`);
  }
}

// Only some spec files (and optionally the tests matching a title pattern): the local runs of the
// implementer, the verifier and the mechanical check. The full suite is CI's job (DESIGN 12).
const quote = (s) => (/^[\w./@:=-]+$/.test(s) ? s : `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`);
export function onlyCommands(commands, files, grep) {
  for (const v of [...files, grep || '']) {
    if (/[\x00-\x1f]/.test(v)) throw new CliError('--only and --grep take a single line each', 2);
  }
  for (const f of files) if (f.startsWith('-')) throw new CliError(`--only takes spec files, not options: ${f}`, 2);
  // A suite line that already names files or directories would still run them all.
  const suite = commands.find((cmd) => DIRECT.test(cmd) || SCRIPT.test(cmd));
  if (suite && /\s(\S+\/|\S+\.(spec|test)\.[cm]?[jt]sx?)(\s|$)/.test(suite)) throw new CliError(`the suite command "${suite}" already selects files; --only would not narrow it. Run npx playwright test <files> instead`, 2);
  const args = files.map(quote);
  if (grep) args.push('-g', quote(grep));
  if (!args.length) throw new CliError('--only needs at least one spec file (or use --grep)', 2);
  return appendSuiteArgs(commands, args, 'E2E --only');
}

export function parseShard(value) {
  const m = String(value || '').match(/^(\d+)\/(\d+)$/);
  if (!m) throw new CliError('--shard must look like 2/3', 2);
  const i = Number(m[1]);
  const n = Number(m[2]);
  if (n < 1 || n > MAX_SHARDS || i < 1 || i > n) throw new CliError(`--shard ${value} is out of range (1 <= i <= n <= ${MAX_SHARDS})`, 2);
  return { index: i, total: n };
}

// { has, total, shards } for the CI plan job. `has` mirrors the old check: an `## E2E` heading.
export function e2ePlan(text) {
  const has = /^##\s+E2E\s*$/m.test(text || '');
  if (!has) return { has: false, total: 1, shards: [1] };
  const total = e2eShards(text);
  shardCommands(sectionCommands(text, 'E2E') || [], 1, total); // fail early on an unshardable section
  return { has: true, total, shards: Array.from({ length: total }, (_, k) => k + 1) };
}
