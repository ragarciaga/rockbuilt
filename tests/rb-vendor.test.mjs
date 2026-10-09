import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { agentToToml, mergeJson, parseFrontmatter } from '../scripts/lib/vendor.mjs';
import { ROOT, cleanup, read, rbJson, repoWith, tmp, write } from './rb-helpers.mjs';

after(cleanup);

const SETTINGS_TPL = {
  permissions: { allow: ['Bash(node tools/rockbuilt/rb.mjs *)', 'Edit'], deny: ['Bash(git push --force*)', 'Read(./.env*)'] },
  hooks: { PreToolUse: [{ matcher: 'Bash|Edit|Write', hooks: [{ type: 'command', command: 'node tools/rockbuilt/guard.mjs', timeout: 10 }] }] },
};

const AGENT = `---
name: rb-verifier
description: >
  Checks one implementation
  against its plan.
tools: Read, Grep
model: opus
---

# Verifier

Read \`.claude/skills/rb-build/SKILL.md\`. Quote: """triple""" and a backslash \\ here.
`;

function harness(version = '0.3.0') {
  const h = tmp('rb-harness-');
  write(h, '.claude-plugin/plugin.json', JSON.stringify({ name: 'rockbuilt', version }));
  write(h, 'scripts/rb.mjs', `// rb ${version}\n`);
  write(h, 'scripts/lib/util.mjs', `// util ${version}\n`);
  write(h, 'hooks/guard.mjs', `// guard ${version}\n`);
  write(h, 'harness/skills/rb-build/SKILL.md', `# rb-build ${version}\nSee \`.claude/skills/rb-build/references/kickback.md\`.\n`);
  write(h, 'harness/skills/rb-build/references/kickback.md', 'kickback\n');
  write(h, 'harness/agents/rb-verifier.md', AGENT);
  write(h, 'harness/project/AGENTS.md', '# <Project name>\n\nDocs language: <es|en>\nProject type: <web, ai, automation>\nAutonomy: auto\n\n## Goal\nx\n');
  write(h, 'harness/project/CLAUDE.md', '@AGENTS.md\n');
  write(h, 'harness/project/.claude/LESSONS.md', '# Lessons\n');
  write(h, 'harness/project/.claude/settings.json', JSON.stringify(SETTINGS_TPL, null, 2));
  write(h, 'harness/project/.github/workflows/rockbuilt-ci.yml', `name: rockbuilt-ci ${version}\n`);
  write(h, 'harness/project/.github/pull_request_template.md', 'template\n');
  write(h, 'harness/project/docs/progress.md', '# Progress\n');
  write(h, 'harness/project/gitignore-additions.txt', '.rockbuilt/\n.env\n');
  write(h, 'harness/adapters/cursor/.cursor/hooks.json', JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command: 'node tools/rockbuilt/guard.mjs' }] } }));
  write(h, 'harness/adapters/cursor/.cursor/cli.json', JSON.stringify({ permissions: { deny: ['Shell(git push --force)'] } }));
  write(h, 'harness/adapters/codex/.codex/hooks.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'shell', hooks: [{ type: 'command', command: 'node tools/rockbuilt/guard.mjs' }] }] } }));
  write(h, 'harness/adapters/codex/.codex/config.toml', '[features]\nhooks = true\n');
  write(h, 'harness/adapters/cursor/README.md', '# Cursor adapter\n');
  write(h, 'harness/adapters/codex/README.md', '# Codex adapter\n');
  return h;
}

test('vendor fresh: harness files, templates, VERSION, header fields, gitignore', async () => {
  const root = repoWith();
  const h = harness();
  const r = await rbJson(root, ['vendor', '--from', h, '--type', 'web,ai', '--lang', 'es']);
  assert.equal(r.code, 0, r.err);
  for (const f of ['tools/rockbuilt/rb.mjs', 'tools/rockbuilt/lib/util.mjs', 'tools/rockbuilt/guard.mjs', 'tools/rockbuilt/VERSION',
    '.claude/skills/rb-build/SKILL.md', '.claude/skills/rb-build/references/kickback.md', '.claude/agents/rb-verifier.md',
    'AGENTS.md', 'CLAUDE.md', '.claude/LESSONS.md', '.claude/settings.json', '.github/workflows/rockbuilt-ci.yml', 'docs/progress.md']) {
    assert.ok(r.json.created.includes(f), `created ${f}`);
  }
  assert.equal(read(root, 'tools/rockbuilt/VERSION'), '0.3.0\n');
  const agents = read(root, 'AGENTS.md');
  assert.match(agents, /^Project type: web, ai$/m);
  assert.match(agents, /^Docs language: es$/m);
  assert.deepEqual(r.json.customized, ['Project type', 'Docs language']);
  assert.match(read(root, '.gitignore'), /\.rockbuilt\/\n\.env\n$/);
  assert.ok(r.json.missing.includes('harness/web'), 'missing web overlay is reported, not fatal');
  assert.ok(!existsSync(path.join(root, '.cursor')), 'no cursor adapter without --tools cursor');
});

test('vendor update: never overwrites AGENTS.md, overwrites rb skills, merges settings', async () => {
  const root = repoWith();
  await rbJson(root, ['vendor', '--from', harness('0.3.0')]);
  write(root, 'AGENTS.md', '# My app\n\nDocs language: es\n');
  write(root, 'CLAUDE.md', '@AGENTS.md\nmy notes\n');
  write(root, 'docs/progress.md', 'mine\n');
  write(root, '.claude/skills/rb-build/SKILL.md', 'edited by hand\n');
  write(root, '.claude/skills/rb-build/references/old.md', 'dropped upstream\n');
  write(root, '.claude/skills/my-skill/SKILL.md', 'user skill\n');
  write(root, '.claude/settings.json', JSON.stringify({
    model: 'opus',
    permissions: { allow: ['Bash(make *)', 'Edit'], deny: ['Bash(rm -rf*)'] },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node my-hook.mjs' }] }] },
  }));

  const r = await rbJson(root, ['vendor', '--from', harness('0.3.1')]);
  assert.equal(r.code, 0, r.err);
  assert.equal(read(root, 'AGENTS.md'), '# My app\n\nDocs language: es\n');
  assert.equal(read(root, 'CLAUDE.md'), '@AGENTS.md\nmy notes\n');
  assert.equal(read(root, 'docs/progress.md'), 'mine\n');
  assert.ok(r.json.skipped.includes('AGENTS.md'));
  assert.equal(read(root, '.claude/skills/rb-build/SKILL.md'), '# rb-build 0.3.1\nSee `.claude/skills/rb-build/references/kickback.md`.\n');
  assert.ok(!existsSync(path.join(root, '.claude/skills/rb-build/references/old.md')), 'files dropped upstream are removed');
  assert.equal(read(root, '.claude/skills/my-skill/SKILL.md'), 'user skill\n');
  assert.equal(read(root, 'tools/rockbuilt/VERSION'), '0.3.1\n');
  assert.ok(r.json.updated.includes('tools/rockbuilt/rb.mjs'));
  assert.ok(r.json.updated.includes('.github/workflows/rockbuilt-ci.yml'));
  assert.ok(r.json.merged.includes('.claude/settings.json'));
  assert.deepEqual(r.json.customized, [], 'header fields only on a new contract');

  const s = JSON.parse(read(root, '.claude/settings.json'));
  assert.equal(s.model, 'opus');
  assert.deepEqual(s.permissions.allow, ['Bash(make *)', 'Edit', 'Bash(node tools/rockbuilt/rb.mjs *)']);
  assert.deepEqual(s.permissions.deny, ['Bash(rm -rf*)', 'Bash(git push --force*)', 'Read(./.env*)']);
  const cmds = s.hooks.PreToolUse.flatMap((g) => g.hooks.map((x) => x.command));
  assert.deepEqual(cmds.sort(), ['node my-hook.mjs', 'node tools/rockbuilt/guard.mjs']);

  const again = await rbJson(root, ['vendor', '--from', harness('0.3.1')]);
  assert.deepEqual(again.json.merged, [], 'idempotent merge');
  assert.deepEqual(again.json.updated, []);
  const s2 = JSON.parse(read(root, '.claude/settings.json'));
  assert.equal(s2.hooks.PreToolUse.flatMap((g) => g.hooks).length, 2, 'guard hook not duplicated');
});

test('vendor: a v0.2 CLAUDE.md contract is not shadowed by a template AGENTS.md', async () => {
  const root = repoWith({ 'CLAUDE.md': '# Old\n\n## Verification\n```bash\nnpm test\n```\n' });
  const r = await rbJson(root, ['vendor', '--from', harness()]);
  assert.ok(!existsSync(path.join(root, 'AGENTS.md')));
  assert.ok(r.json.pending.some((p) => /AGENTS\.md not created/.test(p)));
  assert.match(read(root, 'CLAUDE.md'), /^# Old/);
});

test('vendor --tools cursor,codex: adapters merged, codex skills rewritten, agent toml generated', async () => {
  const root = repoWith({ '.cursor/cli.json': JSON.stringify({ permissions: { allow: ['Shell(ls)'] } }) });
  const r = await rbJson(root, ['vendor', '--from', harness(), '--tools', 'cursor,codex']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.tools, ['claude', 'cursor', 'codex']);
  const cli = JSON.parse(read(root, '.cursor/cli.json'));
  assert.deepEqual(cli.permissions, { allow: ['Shell(ls)'], deny: ['Shell(git push --force)'] });
  assert.equal(JSON.parse(read(root, '.cursor/hooks.json')).hooks.beforeShellExecution[0].command, 'node tools/rockbuilt/guard.mjs');
  assert.match(read(root, '.agents/skills/rb-build/SKILL.md'), /\.agents\/skills\/rb-build\/references\/kickback\.md/);
  assert.doesNotMatch(read(root, '.agents/skills/rb-build/SKILL.md'), /\.claude\/skills/);
  assert.ok(existsSync(path.join(root, '.codex/hooks.json')));
  const toml = read(root, '.codex/agents/rb-verifier.toml');
  assert.match(toml, /^name = "rb-verifier"$/m);
  assert.match(toml, /^description = "Checks one implementation against its plan\."$/m);
  assert.match(toml, /^developer_instructions = """\n# Verifier/m);
  assert.doesNotMatch(toml, /^model/m, 'model is omitted');
  assert.match(toml, /""\\"triple""\\"/);
  assert.match(toml, /backslash \\\\ here/);
  assert.equal((await rbJson(root, ['vendor', '--from', harness(), '--tools', 'vim'])).code, 1);
});

test('vendor adapters: never write the adapter README, never overwrite an existing codex config', async () => {
  const root = repoWith({ 'README.md': '# My project\n', '.codex/config.toml': 'model = "mine"\n' });
  const r = await rbJson(root, ['vendor', '--from', harness(), '--tools', 'cursor,codex']);
  assert.equal(r.code, 0, r.err);
  assert.equal(read(root, 'README.md'), '# My project\n');
  assert.equal(read(root, '.codex/config.toml'), 'model = "mine"\n');
  assert.ok(r.json.skipped.includes('.codex/config.toml'));
  assert.ok(r.json.pending.some((p) => /config\.toml/.test(p)));
  const fresh = repoWith();
  const f = await rbJson(fresh, ['vendor', '--from', harness(), '--tools', 'codex']);
  assert.equal(f.code, 0, f.err);
  assert.ok(!existsSync(path.join(fresh, 'README.md')), 'adapter README not copied');
  assert.equal(read(fresh, '.codex/config.toml'), '[features]\nhooks = true\n');
});

test('vendor from the real plugin root: the vendored rb runs on its own', async () => {
  const root = repoWith();
  const r = await rbJson(root, ['vendor', '--from', ROOT]);
  assert.equal(r.code, 0, r.err);
  const help = spawnSync(process.execPath, [path.join(root, 'tools', 'rockbuilt', 'rb.mjs'), 'help'], { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: '' } });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /merge-gate/);
  const version = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  assert.equal(read(root, 'tools/rockbuilt/VERSION').trim(), version);
  // Vendored copy cannot vendor itself without --from.
  const self = spawnSync(process.execPath, [path.join(root, 'tools', 'rockbuilt', 'rb.mjs'), 'vendor'], { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: '' } });
  assert.equal(self.status, 1);
  assert.match(self.stderr, /pass --from/);
});

test('mergeJson and frontmatter helpers', () => {
  assert.deepEqual(mergeJson({ a: 1, list: ['x'] }, { a: 2, b: 3, list: ['x', 'y'] }), { a: 1, b: 3, list: ['x', 'y'] });
  assert.deepEqual(mergeJson({ mcpServers: { db: {} } }, { mcpServers: { playwright: { command: 'node' } } }), { mcpServers: { db: {}, playwright: { command: 'node' } } });
  const fm = parseFrontmatter(AGENT);
  assert.equal(fm.data.name, 'rb-verifier');
  assert.equal(fm.data.description, 'Checks one implementation against its plan.');
  assert.match(agentToToml('no frontmatter', 'rb-x'), /^name = "rb-x"$/m);
});

test('rb and guard still run when invoked through a symlinked path (macOS /var, Windows case)', (t) => {
  const dir = tmp('rb-link-');
  const link = path.join(dir, 'plugin');
  try { symlinkSync(ROOT, link, 'junction'); } catch { t.skip('symlinks not available'); return; }
  const help = spawnSync(process.execPath, [path.join(link, 'scripts', 'rb.mjs'), 'help'], { encoding: 'utf8' });
  assert.match(help.stdout, /merge-gate/, 'rb printed nothing: entrypoint check failed');
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push --force origin main' }, cwd: dir });
  const g = spawnSync(process.execPath, [path.join(link, 'hooks', 'guard.mjs')], { input: payload, encoding: 'utf8' });
  assert.notEqual(`${g.stdout}${g.stderr}`.trim(), '', 'guard decided nothing: entrypoint check failed');
});
