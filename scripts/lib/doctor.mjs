// rb doctor: environment and project contract checks. Exits 1 only on FAIL.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { COMMAND_SECTIONS, HEADER_FIELDS, REQUIRED_SECTIONS, headerField, readClaudeMd, sectionCommands, sectionHeadings } from './claudemd.mjs';
import { ghStatus, missingLabels } from './gh.mjs';
import { readBaseline } from './baseline.mjs';
import { defaultBranch, originSlug } from './repo.mjs';
import { missingPlaywrightDeps, projectTypesFromClaudeMd } from './init.mjs';
import { exists, gh, readText, repoRoot, run } from './util.mjs';

const pass = (name, detail) => ({ status: 'PASS', name, detail });
const warn = (name, detail) => ({ status: 'WARN', name, detail });
const fail = (name, detail) => ({ status: 'FAIL', name, detail });

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  return major >= 20 ? pass('node', `v${process.versions.node}`) : fail('node', `v${process.versions.node}, need >= 20`);
}

function checkGit() {
  const r = run('git', ['--version']);
  return r.ok ? pass('git', r.stdout.replace(/^git version\s*/, '')) : fail('git', 'git not found on PATH');
}

function checkClaudeMd(root) {
  const text = readClaudeMd(root);
  if (text === null) return [warn('CLAUDE.md', 'missing; run `rb init`')];
  const out = [];
  const headings = sectionHeadings(text).map((h) => h.toLowerCase());
  const missing = REQUIRED_SECTIONS.filter((s) => !headings.includes(s.toLowerCase()));
  out.push(missing.length ? fail('CLAUDE.md sections', `missing: ${missing.map((s) => `## ${s}`).join(', ')}`) : pass('CLAUDE.md sections', 'required sections present'));
  const fields = HEADER_FIELDS.map((f) => [f, headerField(text, f)]);
  const absent = fields.filter(([, v]) => !v).map(([f]) => f);
  const placeholders = fields.filter(([, v]) => v && v.includes('<')).map(([f]) => f);
  if (absent.length) out.push(warn('CLAUDE.md header', `missing: ${absent.join(', ')}`));
  else if (placeholders.length) out.push(warn('CLAUDE.md header', `still a placeholder: ${placeholders.join(', ')}`));
  else out.push(pass('CLAUDE.md header', fields.map(([f, v]) => `${f}=${v}`).join('; ')));
  const verify = sectionCommands(text, 'Verification');
  if (!verify || verify.length === 0) out.push(fail('verification commands', 'no commands in the ## Verification fenced block'));
  else out.push(pass('verification commands', `${verify.length} command(s)`));
  for (const s of COMMAND_SECTIONS.slice(1)) {
    const cmds = sectionCommands(text, s);
    if (cmds && cmds.length === 0) out.push(warn(`${s} commands`, `## ${s} has no fenced commands`));
  }
  const lines = text.split(/\r?\n/).length;
  if (lines > 200) out.push(warn('CLAUDE.md length', `${lines} lines, keep under 200`));
  return out;
}

function checkSettings(root) {
  const text = readText(path.join(root, '.claude', 'settings.json'));
  if (text === null) return [warn('settings.json', '.claude/settings.json missing; run `rb init`')];
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return [fail('settings.json', `invalid JSON: ${e.message}`)];
  }
  const perms = json.permissions || {};
  const allow = perms.allow || [];
  const ask = perms.ask || [];
  const deny = perms.deny || [];
  const problems = [];
  if (!ask.some((r) => /gh pr merge/.test(r))) problems.push('no ask rule for gh pr merge');
  if (!deny.some((r) => /push.*(--force|-f)/.test(r))) problems.push('no deny rule for force push');
  if (!deny.some((r) => /reset --hard/.test(r))) problems.push('no deny rule for git reset --hard');
  if (!allow.some((r) => /^Bash\(rb[ :]/.test(r))) problems.push('no allow rule for rb');
  if (projectTypesFromClaudeMd(root).includes('web') && !allow.some((r) => /^mcp__playwright(__\*)?$/.test(r))) problems.push('no allow rule for mcp__playwright');
  return [problems.length ? warn('settings.json', problems.join('; ')) : pass('settings.json', 'permission rules present')];
}

// Web projects must have Playwright wired from the walking skeleton on.
function checkPlaywright(root) {
  const types = projectTypesFromClaudeMd(root);
  if (!types.includes('web')) return [];
  const out = [];
  const missing = missingPlaywrightDeps(root);
  out.push(missing.length
    ? warn('playwright deps', `missing ${missing.join(', ')}; run npm install -D -E ${missing.join(' ')}`)
    : pass('playwright deps', '@playwright/test and @playwright/mcp declared'));
  const hasConfig = readdirSync(root).some((f) => /^playwright\.config\./.test(f));
  out.push(hasConfig ? pass('playwright config', 'present') : warn('playwright config', 'no playwright.config.*; run `rb init --type web`'));
  const text = readClaudeMd(root);
  const e2e = text === null ? null : sectionCommands(text, 'E2E');
  out.push(e2e && e2e.length ? pass('E2E commands', e2e.join(' && ')) : warn('E2E commands', 'web project without commands under ## E2E'));
  let mcpOk = false;
  try {
    mcpOk = Boolean(JSON.parse(readText(path.join(root, '.mcp.json')) ?? '{}').mcpServers?.playwright);
  } catch { /* invalid JSON reported as missing */ }
  out.push(mcpOk ? pass('playwright MCP', 'configured in .mcp.json') : warn('playwright MCP', 'no playwright server in .mcp.json; run `rb init --type web`'));
  if (mcpOk && !exists(path.join(root, 'node_modules', '@playwright', 'mcp', 'cli.js'))) {
    out.push(warn('playwright MCP install', '@playwright/mcp not installed in node_modules; run npm install'));
  }
  return out;
}

function checkGitignore(root) {
  const text = readText(path.join(root, '.gitignore')) ?? '';
  const ok = text.split(/\r?\n/).some((l) => /^\/?\.rockbuilt\/?$/.test(l.trim()));
  return ok ? pass('.gitignore', '.rockbuilt/ ignored') : warn('.gitignore', '.rockbuilt/ not ignored; run `rb init`');
}

function checkGithub(root, status) {
  const out = [];
  if (!status.installed) return [fail('gh', status.detail)];
  if (!status.authenticated) return [fail('gh auth', status.detail)];
  out.push(pass('gh auth', status.detail));
  if (!root) return out;
  const slug = originSlug(root);
  if (!slug) return [...out, warn('github remote', 'no GitHub origin remote; labels and branch protection not checked')];
  const missing = missingLabels(root);
  if (missing === null) out.push(warn('labels', 'could not list labels'));
  else if (missing.length) out.push(warn('labels', `missing: ${missing.join(', ')}; run \`rb labels\``));
  else out.push(pass('labels', 'all rb:* labels present'));
  const branch = defaultBranch(root);
  const prot = gh(root, ['api', `repos/${slug}/branches/${branch}/protection`, '--silent']);
  out.push(prot.ok
    ? pass('branch protection', `${branch} is protected`)
    : warn('branch protection', `${branch} has no protection (or not visible); require PR review on ${branch} as the real backstop`));
  return out;
}

export function runDoctor(cwd, { ghStatusFn = ghStatus } = {}) {
  const checks = [checkNode(), checkGit()];
  const root = repoRoot(cwd);
  checks.push(root ? pass('repository', root) : warn('repository', 'not inside a git repository'));
  checks.push(...checkGithub(root, ghStatusFn(cwd)));
  if (root) {
    checks.push(...checkClaudeMd(root), ...checkSettings(root), checkGitignore(root), ...checkPlaywright(root));
    const b = readBaseline(root);
    if (!b) checks.push(warn('baseline', 'no .rockbuilt/baseline.json; run `rb baseline`'));
    else checks.push(b.green ? pass('baseline', `green at ${String(b.sha).slice(0, 7)} (${b.date})`) : warn('baseline', `red at ${String(b.sha).slice(0, 7)}`));
  }
  return { checks, ok: !checks.some((c) => c.status === 'FAIL') };
}
