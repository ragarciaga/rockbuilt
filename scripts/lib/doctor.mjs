// rb doctor: environment and contract checks. Exits 1 only on FAIL. Works offline (GitHub checks WARN).
import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readBaseline } from './baseline.mjs';
import { COMMAND_SECTIONS, HEADER_FIELDS, REQUIRED_SECTIONS, contractInfo, headerField, isTemplate, parseAutonomy, projectTypesFrom, readContract, sectionCommands, sectionHeadings } from './contract.mjs';
import { isTestPath } from './delta.mjs';
import { matchAny } from './glob.mjs';
import { CONTROL_TITLE } from './control.mjs';
import { ghStatus, makeGh, ops } from './gh.mjs';
import { defaultBranch, originSlug } from './repo.mjs';
import { missingPlaywrightDeps } from './vendor.mjs';
import { exists, git, now, pluginRoot, readText, repoRoot, run } from './util.mjs';

// The routing line of harness/project/CLAUDE.md (rockbuilt #55); doctor prints it for projects
// whose CLAUDE.md predates it. A test keeps both copies equal.
export const ROUTING_RULE = '- Route every request that changes a file through a skill, also in a chat: small change `/rb-quick`, bug `/rb-fix`, task issue `/rb-build`, new feature `/rb-spec`. A question or an explanation changes nothing and needs none. Never report a change as done before its review passed.';

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

// PLAN-1.0 A10: what "update rockbuilt" owes a project from before 1.0. The contract text that
// agents read must describe levels, not tiers; Kickback budget is explicit; and Sensitive paths is
// reviewed once by the owner, because a glob over most of the code makes nearly every PR level 3
// (Doorcas: 44 of 82 PRs, evals/results/2026-11-24-replay-levels.md).
export const SENSITIVE_SHARE = 0.4;
function levelsChecks(root, text) {
  const out = [];
  if (/highest tier wins|Tier C pull requests are merged by the human/.test(text)) out.push(warn('contract 1.0', 'AGENTS.md ## Autonomy still describes tiers A, B and C: replace the "How the harness decides" paragraphs with the level text from the template (tools/rockbuilt/AGENTS.template.md)'));
  if (headerField(text, 'Kickback budget') === null) out.push(warn('contract 1.0', 'no `Kickback budget:` header line (0 to 3, default 2): add `Kickback budget: 2` under `Max tasks per run`'));
  // PLAN-1.0 G4: the review profile. No line means full.
  const profile = headerField(text, 'Profile');
  if (profile !== null && !['full', 'minimal', 'none'].includes(profile.toLowerCase())) out.push(warn('profile', `Profile: ${profile} is not full, minimal or none; the gate applies full`));
  if (profile !== null && profile.toLowerCase() === 'none') out.push(warn('profile', 'Profile: none means the project runs without the harness, yet it is vendored here; the gate applies full. Set `Profile: minimal` or `full`'));
  if (headerField(text, 'Sensitive paths reviewed') === null) {
    const globs = parseAutonomy(text).sensitivePaths;
    const tracked = run('git', ['-C', root, 'ls-files']).stdout.split(/\r?\n/).filter((p) => /\.(c|m)?[jt]sx?$|\.(py|go|rb|rs|java|kt|php|cs|swift|vue|svelte|astro)$/.test(p) && !isTestPath(p) && !p.startsWith('tools/rockbuilt/'));
    const hit = tracked.filter((p) => matchAny(p, globs)).length;
    if (tracked.length >= 10 && hit / tracked.length > SENSITIVE_SHARE) out.push(warn('sensitive paths', `Sensitive paths covers ${hit} of ${tracked.length} source files (${Math.round((hit / tracked.length) * 100)}%): nearly every PR gets the full review. Review it once with the owner (narrow it to what is truly sensitive), then add \`Sensitive paths reviewed: <date>\` to the header`));
  }
  return out;
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
    // rockbuilt #55: rb vendor never rewrites an existing CLAUDE.md, so older projects lack the
    // routing rule and chat requests skip every review.
    if (claude !== null && !/\/rb-quick\b/.test(claude)) out.push(warn('CLAUDE.md', `no routing rule, so chat requests that change files skip every review; add this line under "## Claude Code notes": ${ROUTING_RULE}`));
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
  out.push(...levelsChecks(root, text));
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

function installedPluginVersion(home = os.homedir()) {
  const versions = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let ents = [];
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const sub = path.join(dir, e.name);
      if (e.name === '.claude-plugin') {
        try { const j = JSON.parse(readFileSync(path.join(sub, 'plugin.json'), 'utf8')); if (j.name === 'rockbuilt' && j.version) versions.push(j.version); } catch { /* not a plugin */ }
      } else if (e.name !== 'node_modules' && !e.name.startsWith('.git')) walk(sub, depth + 1);
    }
  };
  walk(path.join(home, '.claude', 'plugins'), 0);
  const key = (v) => v.split('.').map((n) => String(Number(n) || 0).padStart(6, '0')).join('.');
  return versions.sort((a, b) => (key(a) < key(b) ? 1 : -1))[0] || null;
}

// PLAN-1.0 F8: { vendored, plugin, behind } for rb state and the digest (plugin null when the
// plugin is not installed where this runs, as in a cloud routine).
export function versionStatus(root) {
  const vendored = (readText(path.join(root, 'tools', 'rockbuilt', 'VERSION')) || '').trim() || null;
  const plugin = pluginRoot();
  let pv = null;
  if (plugin) { try { pv = JSON.parse(readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).version; } catch { pv = null; } }
  // The vendored rb runs without CLAUDE_PLUGIN_ROOT: look for an installed rockbuilt plugin under
  // ~/.claude/plugins (marketplace cache or synced), newest version wins (review of 1.3.0).
  if (!pv) pv = installedPluginVersion();
  const older = (a, b) => {
    const x = String(a).split('.').map(Number);
    const y = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
    return false;
  };
  const behind = Boolean(vendored && pv && older(vendored, pv));
  return { vendored, plugin: pv, behind };
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
  // PLAN-1.0 F12 (from trail-blazer-flow's external audit): a third-party action pinned to a tag
  // can change under the same name; a commit SHA cannot.
  const unpinned = [];
  let names = [];
  try { names = readdirSync(path.join(root, '.github', 'workflows')).filter((n) => /\.ya?ml$/.test(n)); } catch { names = []; }
  for (const n of names) {
    const text = readText(path.join(root, '.github', 'workflows', n)) || '';
    for (const m of text.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
      const ref = m[1].replace(/^["']|["']$/g, '');
      if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
      if (!/@[0-9a-f]{40}$/.test(ref)) unpinned.push(`${n}: ${ref}`);
    }
  }
  if (unpinned.length) return warn('CI actions', `not pinned to a commit SHA: ${unpinned.slice(0, 4).join(', ')}${unpinned.length > 4 ? ` (+${unpinned.length - 4})` : ''}; \`rb vendor\` pins the harness workflow, pin the rest the same way (uses: owner/action@<sha> # vX.Y.Z)`);
  return pass('CI workflow', '.github/workflows/rockbuilt-ci.yml present, actions pinned');
}

const DEPLOY_FILES = ['vercel.json', 'netlify.toml', 'fly.toml', 'render.yaml', 'wrangler.toml', 'railway.json', 'railway.toml', 'app.yaml', 'Procfile'];

// Automatic merges reach production when the host deploys the default branch on push.
function checkDeploy(root, autonomy) {
  const found = DEPLOY_FILES.filter((f) => exists(path.join(root, f)));
  if (!found.length) return [];
  const out = [];
  if (/supervised/i.test(autonomy || '')) out.push(pass('deploy', `${found.join(', ')}; Autonomy: supervised, every merge is human`));
  else out.push(warn('deploy', `${found.join(', ')} found: if the host deploys the default branch on push, tier A/B merges reach production unattended. Use preview deploys for main or set Autonomy: supervised`));
  // rockbuilt #56: "merged" is not "live". Without a Deploy check nobody looks after the merge.
  const cmds = sectionCommands(readContract(root).text || '', 'Deploy check');
  if (!cmds || !cmds.length) out.push(warn('deploy check', 'no ## Deploy check in AGENTS.md: nothing confirms a merged change is live; add a command that proves the merged commit is deployed (a version or health route), see the template'));
  return out;
}

// rockbuilt #67 and #59: progress.md is the resume point. Merges it never recorded, or a file too
// long to read at every session start, make every resume start from a false or costly state.
export const PROGRESS_LIMITS = { staleHours: 48, lines: 300 };

export function checkProgress(root, nowMs = now().getTime()) {
  const file = path.join(root, 'docs', 'progress.md');
  const text = readText(file);
  if (text === null) return [];
  const out = [];
  const lines = text.split(/\r?\n/).length;
  if (lines > PROGRESS_LIMITS.lines) out.push(warn('progress size', `docs/progress.md has ${lines} lines (> ${PROGRESS_LIMITS.lines}): every session reads it; keep current state at the top and move dated sections older than a month to docs/progress/<yyyy-mm>.md`));
  const branch = defaultBranch(root);
  const ref = git(root, ['rev-parse', '--verify', '--quiet', `origin/${branch}^{commit}`]).ok ? `origin/${branch}` : branch;
  const last = git(root, ['log', '-1', '--format=%H%x09%cs', ref, '--', 'docs/progress.md']);
  if (!last.ok || !last.stdout) return out;
  const [sha, day] = last.stdout.split('\t');
  const log = git(root, ['log', '--format=%ct%x09%s', `${sha}..${ref}`]);
  const merges = (log.ok ? log.stdout.split('\n').filter(Boolean) : [])
    .map((l) => { const [t, ...s] = l.split('\t'); return { at: Number(t) * 1000, subject: s.join('\t') }; })
    .filter((m) => /\(#\d+\)\s*$/.test(m.subject) || /^Merge pull request #\d+/.test(m.subject));
  if (!merges.length) return out;
  const oldest = Math.min(...merges.map((m) => m.at));
  const ageH = (nowMs - oldest) / 3600000;
  if (ageH > PROGRESS_LIMITS.staleHours) out.push(warn('progress', `${merges.length} merged PR(s) on ${ref} since docs/progress.md last changed (${day}), the oldest ${Math.floor(ageH / 24)} day(s) ago: refresh it before trusting it (rb-status offers it)`));
  return out;
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
    else if (contractInfo(root).protectionDeclined) out.push(pass('protection', 'rb-only: declined by the owner (Branch protection line in AGENTS.md); a merge in the GitHub UI skips rb merge-gate'));
    else if (p.available) out.push(warn('protection', `rb-only: ${p.detail}`));
    else out.push(warn('protection', 'rb-only: branch protection needs GitHub Pro (USD 4/month) or a public repo; it is a cost, the user decides. rb merge-gate enforces the gate meanwhile'));
  } catch (e) {
    out.push(warn('protection', `could not check (${e.message}); offline?`));
    return out;
  }
  try {
    const info = ops.repoInfo(c);
    out.push(info.deleteBranchOnMerge
      ? pass('branch cleanup', 'GitHub deletes PR branches on merge')
      : warn('branch cleanup', 'merged rb/* branches pile up on GitHub: turn on Settings, General, "Automatically delete head branches" (cloud sessions cannot change repo settings or delete remote branches)'));
  } catch (e) {
    out.push(warn('branch cleanup', `could not read repo settings (${e.message})`));
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
    checks.push(...checkContract(root), ...checkVendored(root), checkCi(root), ...checkProgress(root), ...checkDeploy(root, headerField(readContract(root).text || '', 'Autonomy')), ...checkSettings(root, types), checkGitignore(root), ...checkPlaywright(root, types));
    const b = readBaseline(root);
    if (!b) checks.push(warn('baseline', 'no .rockbuilt/baseline.json; run `rb baseline`'));
    else checks.push(b.green ? pass('baseline', `green at ${String(b.sha).slice(0, 7)} (${b.date})`) : warn('baseline', `red at ${String(b.sha).slice(0, 7)}`));
  }
  return { checks, ok: !checks.some((c) => c.status === 'FAIL') };
}
