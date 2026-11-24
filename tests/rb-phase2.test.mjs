// PLAN-1.0 phase 2 (1.1.0): permission prompts log and report (C3).
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { permissionReport } from '../scripts/lib/permissions.mjs';
import { cleanup, rb, rbJson, repoWith, write } from './rb-helpers.mjs';

after(cleanup);

test('C3: permission prompts are logged by the hook and grouped into safe allow rules', async () => {
  const root = repoWith({ 'tools/rockbuilt/rb.mjs': '// vendored\n' });
  const hook = (input) => rb(root, ['permissions', 'log', '--hook'], { stdin: () => JSON.stringify({ cwd: root, ...input }) });
  for (let i = 0; i < 3; i++) await hook({ tool_name: 'Bash', tool_input: { command: 'npm run lint -- --fix' } });
  await hook({ tool_name: 'Bash', tool_input: { command: 'rm -rf dist' } });
  await hook({ tool_name: 'Bash', tool_input: { command: 'node scripts/x.mjs | tee out' } });
  await hook({ tool_name: 'Write', tool_input: { file_path: 'src/a.ts', content: 'secret' } });
  const r = permissionReport(root);
  assert.equal(r.total, 6);
  assert.deepEqual(r.rows[0], { tool: 'Bash', prefix: 'npm run', count: 3, last: r.rows[0].last, example: 'npm run lint --', rule: 'Bash(npm run *)' });
  assert.equal(r.rows.find((x) => x.prefix === 'rm').rule, null, 'never proposes a destructive command');
  assert.equal(r.rows.find((x) => x.prefix === 'node scripts/x.mjs' || x.prefix.startsWith('node')).rule, null, 'a pipe is never proposed');
  assert.doesNotMatch(JSON.stringify(r), /secret/, 'file contents are never logged');
  const out = await rbJson(root, ['permissions', 'report']);
  assert.equal(out.code, 0);
  assert.equal((await rb(root, ['permissions', 'log'])).code, 2, 'log only runs as a hook');
  write(root, 'x', 'x');
});

test('independent review of 1.1.0: the permissions log keeps no values and never proposes risky rules', async () => {
  const root = repoWith({ 'tools/rockbuilt/rb.mjs': '// vendored\n' });
  const hook = (command) => rb(root, ['permissions', 'log', '--hook'], { stdin: () => JSON.stringify({ cwd: root, tool_name: 'Bash', tool_input: { command } }) });
  await hook('API_KEY=sk-live-abc123 node x.js');
  await hook('cat > notes.txt <<EOF\nsecret body\nEOF');
  await hook('git checkout main');
  await hook('git checkout -- .');
  await hook('git -C ../x push');
  await hook('node -e "1"');
  const r = permissionReport(root);
  const text = JSON.stringify(r);
  assert.doesNotMatch(text, /sk-live|secret body/);
  for (const x of r.rows) if (/^(git checkout|git -C|node -e|cat|API_KEY)/.test(x.prefix)) assert.equal(x.rule, null, x.prefix);
});
