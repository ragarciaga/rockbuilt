// rb doctor: environment and contract checks. Exits 1 only on FAIL. Works offline (GitHub checks WARN).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readBaseline } from './baseline.mjs';
import { COMMAND_SECTIONS, HEADER_FIELDS, REQUIRED_SECTIONS, headerField, isTemplate, projectTypesFrom, readContract, sectionCommands, sectionHeadings } from './contract.mjs';
import { CONTROL_TITLE } from './control.mjs';
import { ghStatus, makeGh, ops } from './gh.mjs';
import { defaultBranch, originSlug } from './repo.mjs';
import { missingPlaywrightDeps } from './vendor.mjs';
import { exists, pluginRoot, readText, repoRoot, run } from './util.mjs';

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

function checkContract(root) {
  const { file, text } = readContract(root);
  if (text === null) return [warn('AGENTS.md', 'missing; run `rb vendor`')];
  const out = [];
  if (isTemplate(text)) return [warn('AGENTS.md', `${file} is still the template; fill it (/rb-kickoff or /rb-adopt) before any run`)];
  if (file === 'AGENTS.md') {
    out.push(pass('AGENTS.md', 'project contract present'));
    const claude = readText(path.join(root, 'CLAUDE.md'));
    if (claude === null) out.push(warn('CLAUDE.md', 'missing; Claude Code needs a CLAUDE.md containing "@AGENTS.md"'));
    else if (!/@AGENTS\.md/.test(claude)) out.push(warn('CLAUDE.md', 'does not import @AGENTS.md'));
  } else {
    out.push(warn('AGENTS.md', 'missing: CLAUDE.md holds the v0.2 contract; move it to AGENTS.md (rb-adopt)'));
  }
  const headings = sectionHeadings(text).map((h) => h.toLowerCase());
  const missing = REQUIRED_SECTIONS.filter((s) => !headings.includes(s.toLowerCase()));
  out.push(missing.length ? fail('contract sections', `missing: ${missing.map((s) => `## ${s}`).join(', ')}`) : pass('contract sections', 'required sections present'));
  const fields = HEADER_FIELDS.map((f) => [f, headerField(text, f)]);
  const absent = fields.filter(([, v]) => !v).map(([f]) => f);
  const placeholders = fields.filter(([, v]) => v && v.includes('<')).map(([f]) => f);
  if (absent.length) out.push(warn('contract header', `missing: ${absent.join(', ')}`));
  else if (placeholders.length) out.push(warn('contract header', `still a placeholder: ${placeholders.join(', ')}`));
  else out.push(pass('contract header', fields.map(([f, v]) => `${f}=${v}`).join('; ')));
  const verify = sectionCommands(text, 'Verification');
  if (!verify || verify.length === 0) out.push(fail('verification commands', 'no commands in the ## Verification fenced block'));
  else out.push(pass('verification commands', `${verify.length} command(s)`));
  for (const s of COMMAND_SECTIONS.slice(1)) {
    const cmds = sectionCommands(text, s);
    if (cmds && cmds.length === 0) out.push(warn(`${s} commands`, `## ${s} has no fenced commands`));
  }
  const lines = text.split(/\r?\n/).length;
  if (lines > 200) out.push(warn('contract length', `${lines} lines, keep under 200`));
  return out;
}

function checkSettings(root, types) {
  const text = readText(path.join(root, '.claude', 'settings.json'));
  if (text === null) return [warn('settings.json', '.claude/settings.json missing; run `rb vendor`')];
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return [fail('settings.json', `invalid JSON: ${e.message}`)];
  }
  const perms = json.permissions || {};
  const allow = perms.allow || [];
  const deny = perms.deny || [];
  const problems = [];
  if (!deny.some((r) => /push.*(--force|-f)/.test(r))) problems.push('no deny rule for force push');
  if (!deny.some((r) => /reset --hard/.test(r))) problems.push('no deny rule for git reset --hard');
  if (!deny.some((r) => /\.env/.test(r))) problems.push('no deny rule for reading .env files');
  const hooks = JSON.stringify(json.hooks || {});
  if (!/guard\.mjs/.test(hooks)) problems.push('no PreToolUse hook running tools/rockbuilt/guard.mjs');
  if (types.includes('web') && !allow.some((r) => /^mcp__playwright(__\*)?$/.test(r))) problems.push('no allow rule for mcp__playwright');
  return [problems.length ? warn('settings.json', problems.join('; ')) : pass('settings.json', 'permissions and guard hook present')];
}

function checkVendored(root) {
  const vendored = readText(path.join(root, 'tools', 'rockbuilt', 'VERSION'));
  if (vendored === null) return [warn('vendored harness', 'tools/rockbuilt/ missing; run `rb vendor`')];
  const v = vendored.trim();
  const plugin = pluginRoot();
  if (!plugin) return [pass('vendored harness', `tools/rockbuilt ${v}`)];
  let pv = null;
  try { pv = JSON.parse(readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).version; } catch { /* unreadable */ }
  if (!pv) return [pass('vendored harness', `tools/rockbuilt ${v}`)];
  return [v === pv ? pass('vendored harness', `tools/rockbuilt ${v} matches the plugin`) : warn('vendored harness', `tools/rockbuilt ${v}, plugin ${pv}; run \`rb vendor\` to update`)];
}

function checkCi(root) {
  if (!exists(path.join(root, '.github', 'workflows', 'rockbuilt-ci.yml'))) {
    return warn('CI workflow', '.github/workflows/rockbuilt-ci.yml missing: no CI means no automatic merge; run `rb vendor`');
  }
  const setup = sectionCommands(readContract(root).text, 'Setup') || [];
  if (setup.some((c) => /^npm ci\b/.test(c)) && !exists(path.join(root, 'package-lock.json'))) {
    return warn('CI workflow', 'Setup runs `npm ci` but there is no package-lock.json: CI will fail; commit the lockfile or change ## Setup');
  }
  return pass('CI workflow', '.github/workflows/rockbuilt-ci.yml present');
}

const DEPLOY_FILES = ['vercel.json', 'netlify.toml', 'fly.toml', 'render.yaml', 'wrangler.toml', 'app.yaml', 'Procfile'];

// Automatic merges reach production when the host deploys the default branch on push.
function checkDeploy(root, autonomy) {
  const found = DEPLOY_FILES.filter((f) => exists(path.join(root, f)));
  if (!found.length) return [];
  if (/supervised/i.test(autonomy || '')) return [pass('deploy', `${found.join(', ')}; Autonomy: supervised, every merge is human`)];
  return [warn('deploy', `${found.join(', ')} found: if the host deploys the default branch on push, tier A/B merges reach production unattended. Use preview deploys for main or set Autonomy: supervised`)];
}

function checkPlaywright(root, types) {
  if (!types.includes('web')) return [];
  const out = [];
  const missing = missingPlaywrightDeps(root);
  out.push(missing.length
    ? warn('playwright deps', `missing ${missing.join(', ')}; run npm install -D -E ${missing.join(' ')}`)
    : pass('playwright deps', '@playwright/test and @playwright/mcp declared'));
  const hasConfig = readdirSync(root).some((f) => /^playwright\.config\./.test(f));
  out.push(hasConfig ? pass('playwright config', 'present') : warn('playwright config', 'no playwright.config.*; run `rb vendor --type web`'));
  const e2e = sectionCommands(readContract(root).text, 'E2E');
  out.push(e2e && e2e.length ? pass('E2E commands', e2e.join(' && ')) : warn('E2E commands', 'web project without commands under ## E2E'));
  let mcpOk = false;
  try {
    mcpOk = Boolean(JSON.parse(readText(path.join(root, '.mcp.json')) ?? '{}').mcpServers?.playwright);
  } catch { /* invalid JSON reported as missing */ }
  out.push(mcpOk ? pass('playwright MCP', 'configured in .mcp.json') : warn('playwright MCP', 'no playwright server in .mcp.json; run `rb vendor --type web`'));
  if (mcpOk && !exists(path.join(root, 'node_modules', '@playwright', 'mcp', 'cli.js'))) {
    out.push(warn('playwright MCP install', '@playwright/mcp not installed in node_modules; run npm install'));
  }
  return out;
}

function checkGitignore(root) {
  const text = readText(path.join(root, '.gitignore')) ?? '';
  const ok = text.split(/\r?\n/).some((l) => /^\/?\.rockbuilt\/?$/.test(l.trim()));
  return ok ? pass('.gitignore', '.rockbuilt/ ignored') : warn('.gitignore', '.rockbuilt/ not ignored; run `rb vendor`');
}

// GitHub checks never FAIL the doctor on network problems: they WARN (offline works).
function checkGithub(root, status, client) {
  const out = [];
  if (!status.installed) return [fail('gh', status.detail)];
  if (!status.authenticated) {
    if (/connect|network|timeout|timed out|dial|resolve|offline|no such host/i.test(status.detail)) return [warn('gh auth', `could not reach GitHub (${status.detail}); offline?`)];
    return [fail('gh auth', status.detail)];
  }
  out.push(pass('gh auth', status.detail));
  if (!root) return out;
  const slug = client ? null : originSlug(root);
  if (!client && !slug) return [...out, warn('github remote', 'no GitHub origin remote; protection, labels and control issue not checked')];
  const c = client || makeGh({ cwd: root, repo: slug });
  const branch = defaultBranch(root);
  try {
    const p = ops.protection(c, branch);
    if (p.mode === 'github') out.push(pass('protection', `github: ${p.detail}`));
    else if (p.available) out.push(warn('protection', `rb-only: ${p.detail}`));
    else out.push(warn('protection', 'rb-only: branch protection needs GitHub Pro (USD 4/month) or a public repo; it is a cost, the user decides. rb merge-gate enforces the gate meanwhile'));
  } catch (e) {
    out.push(warn('protection', `could not check (${e.message}); offline?`));
    return out;
  }
  try {
    const missing = ops.missingLabels(c);
    out.push(missing.length ? warn('labels', `missing: ${missing.join(', ')}; run \`rb labels\``) : pass('labels', 'all rb:* labels present'));
  } catch (e) {
    out.push(warn('labels', `could not list labels (${e.message})`));
  }
  try {
    const ctl = ops.issueList(c, { labels: ['rb:control'], state: 'open' });
    out.push(ctl.length ? pass('control issue', `#${ctl[0].number} ${CONTROL_TITLE}`) : warn('control issue', 'none yet; `rb control ensure` creates it'));
  } catch (e) {
    out.push(warn('control issue', `could not check (${e.message})`));
  }
  return out;
}

export function runDoctor(cwd, { ghStatusFn = ghStatus, gh = null } = {}) {
  const checks = [checkNode(), checkGit()];
  const root = repoRoot(cwd);
  checks.push(root ? pass('repository', root) : warn('repository', 'not inside a git repository'));
  checks.push(...checkGithub(root, ghStatusFn(cwd), gh));
  if (root) {
    const types = projectTypesFrom(readContract(root).text);
    checks.push(...checkContract(root), ...checkVendored(root), checkCi(root), ...checkDeploy(root, headerField(readContract(root).text || '', 'Autonomy')), ...checkSettings(root, types), checkGitignore(root), ...checkPlaywright(root, types));
    const b = readBaseline(root);
    if (!b) checks.push(warn('baseline', 'no .rockbuilt/baseline.json; run `rb baseline`'));
    else checks.push(b.green ? pass('baseline', `green at ${String(b.sha).slice(0, 7)} (${b.date})`) : warn('baseline', `red at ${String(b.sha).slice(0, 7)}`));
  }
  return { checks, ok: !checks.some((c) => c.status === 'FAIL') };
}
