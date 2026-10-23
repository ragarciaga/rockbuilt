// 0.10.0: mechanical bookkeeping and the fixes for issues #22 to #38 (DESIGN 24).
import assert from 'node:assert/strict';
import { chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { findBrowser } from '../scripts/lib/browser.mjs';
import { normalizePatch } from '../scripts/lib/delta.mjs';
import { statusLineFrom } from '../scripts/lib/gh.mjs';
import { classify } from '../scripts/lib/risk.mjs';
import { REPO, cleanup, commitAll, fakeGh, rb, rbJson, repoWith, sh, tmp, withEnv, write } from './rb-helpers.mjs';

after(cleanup);

const AGENTS = (extra = '') => `# App\n\nDocs language: es\nProject type: web\nDefault branch: main\nAutonomy: auto\n\n## Verification\n\`\`\`bash\nnpm test\n\`\`\`\n${extra}`;
const io = (gh) => ({ ghRunner: gh.runner });
const repo = ['--repo', REPO];

test('rb claim: label and claim comment, refused while another run is active, kept alive, released', async () => {
  const root = repoWith({ 'AGENTS.md': AGENTS() });
  const gh = fakeGh();
  const s = gh.state;
  s.issues[5] = { number: 5, title: 'T1', body: '', state: 'open', labels: ['rb:task'] };
  await withEnv({ RB_NOW: '2026-10-22T10:00:00Z' }, async () => {
    const a = await rbJson(root, ['claim', '5', '--run', 'session-a', ...repo], io(gh));
    assert.equal(a.code, 0, a.err);
    assert.ok(s.issues[5].labels.includes('rb:in-progress'));
    assert.match(s.comments[5][0].body, /^<!-- rockbuilt:claim run=session-a at=2026-10-22T10:00:00\.000Z -->/);
    const b = await rbJson(root, ['claim', '5', '--run', 'cycle-b', ...repo], io(gh));
    assert.equal(b.code, 3, 'another run holds a fresh claim');
    assert.equal(b.json.holder, 'session-a');
    assert.equal((await rbJson(root, ['claim', '5', '--run', 'session-a', ...repo], io(gh))).code, 0);
    assert.equal(s.comments[5].length, 1, 'the same run within 30 min adds no comment');
  });
  await withEnv({ RB_NOW: '2026-10-22T10:40:00Z' }, async () => {
    await rbJson(root, ['claim', '5', '--run', 'session-a', ...repo], io(gh));
    assert.equal(s.comments[5].length, 2, 'after 30 min the claim is renewed');
  });
  await withEnv({ RB_NOW: '2026-10-22T14:00:00Z' }, async () => {
    const c = await rbJson(root, ['claim', '5', '--run', 'cycle-b', ...repo], io(gh));
    assert.equal(c.code, 0, 'a claim idle for 3 h can be taken');
    const back = await rbJson(root, ['claim', '5', '--run', 'session-a', ...repo], io(gh));
    assert.equal(back.code, 3, 'the newer claim wins over an older one by the same issue');
  });
  // An outsider's claim comment means nothing.
  s.issues[6] = { number: 6, title: 'T2', body: '', state: 'open', labels: ['rb:in-progress'] };
  s.comments[6] = [{ id: 900, body: '<!-- rockbuilt:claim run=evil at=2026-10-22T13:59:00Z -->', user: { login: 'x' }, author_association: 'NONE' }];
  await withEnv({ RB_NOW: '2026-10-22T14:00:00Z' }, async () => {
    assert.equal((await rbJson(root, ['claim', '6', '--run', 'cycle-b', ...repo], io(gh))).code, 0);
  });
  const rel = await rbJson(root, ['claim', '5', '--run', 'cycle-b', '--release', ...repo], io(gh));
  assert.equal(rel.json.released, true);
  assert.ok(!s.issues[5].labels.includes('rb:in-progress'));
  assert.equal((await rb(root, ['claim', '5', ...repo], io(gh))).code, 2, '--run is required');
});

test('rb sync with the lock keeps a claim active in the last 3 hours, clears an idle one (#35)', async () => {
  const root = repoWith({ 'AGENTS.md': AGENTS() });
  const gh = fakeGh();
  const s = gh.state;
  s.issues[1] = { number: 1, title: 'Rockbuilt control', body: '', state: 'open', labels: ['rb:control'] };
  s.issues[7] = { number: 7, title: 'T7', body: '', state: 'open', labels: ['rb:in-progress'] };
  s.issues[8] = { number: 8, title: 'T8', body: '', state: 'open', labels: ['rb:in-progress'] };
  const claim = (n, at) => ({ id: 800 + n, body: `<!-- rockbuilt:claim run=session-x at=${at} -->`, user: { login: 'me' }, author_association: 'OWNER', created_at: at });
  s.comments[7] = [claim(7, '2026-10-22T09:00:00Z')];
  s.comments[8] = [claim(8, '2026-10-22T05:00:00Z')];
  s.events = { 7: [{ event: 'labeled', label: { name: 'rb:in-progress' }, created_at: '2026-10-22T09:00:00Z' }], 8: [{ event: 'labeled', label: { name: 'rb:in-progress' }, created_at: '2026-10-22T05:00:00Z' }] };
  await withEnv({ RB_NOW: '2026-10-22T10:00:00Z' }, async () => {
    assert.equal((await rbJson(root, ['lock', 'acquire', '--run', 'cycle-n', ...repo], io(gh))).code, 0);
    const r = await rbJson(root, ['sync', '--run', 'cycle-n', ...repo], io(gh));
    assert.equal(r.code, 0, r.err);
    assert.ok(s.issues[7].labels.includes('rb:in-progress'), 'a session claim from an hour ago survives the nightly sweep');
    assert.ok(r.json.labels.some((l) => l.issue === 7 && /claimed elsewhere 60 min ago/.test(l.reason)));
    assert.ok(!s.issues[8].labels.includes('rb:in-progress'), 'a claim idle for 5 h is stale');
  });
});

test('rb gh pr-line builds and validates a status line (#38)', async () => {
  assert.equal(statusLineFrom({ stage: 'rb-verifier', task: 'T3', outcome: 'pass', head: 'abc1234' }), '<!-- rockbuilt:status stage=rb-verifier task=T3 outcome=pass head=abc1234 -->');
  assert.equal(statusLineFrom({ stage: 'rb-auditor', outcome: 'pass', head: 'abc1234', 'app-identical-to': 'def5678', mode: 're-audit' }), '<!-- rockbuilt:status stage=rb-auditor outcome=pass head=abc1234 app-identical-to=def5678 mode=re-audit -->');
  assert.throws(() => statusLineFrom({ stage: 'verifier', outcome: 'pass', head: 'abc1234' }), /rb agent/);
  assert.throws(() => statusLineFrom({ stage: 'rb-verifier', outcome: 'passed', head: 'abc1234' }), /pass, fail/);
  assert.throws(() => statusLineFrom({ stage: 'rb-verifier', outcome: 'pass' }), /--head/);
  assert.throws(() => statusLineFrom({ stage: 'rb-verifier', outcome: 'pass', head: 'HEAD' }), /commit sha/);
  assert.throws(() => statusLineFrom({ stage: 'rb-verifier', outcome: 'pass', head: 'abc1234', task: 'T1 x' }), /task id/);

  const root = repoWith({ 'AGENTS.md': AGENTS() });
  const gh = fakeGh();
  gh.state.issues[9] = { number: 9, title: 'PR', body: 'Closes #3\n<!-- rockbuilt:status stage=rb-verifier task=T1 outcome=fail head=aaaaaaa -->\n<!-- rockbuilt:tier B -->\n', state: 'open', labels: [], isPr: true };
  gh.state.pulls[9] = { number: 9, head: 'rb/T1-x', base: 'main', headSha: 'b'.repeat(40) };
  const r = await rbJson(root, ['gh', 'pr-line', '9', '--stage', 'rb-verifier', '--task', 'T1', '--outcome', 'pass', '--head', 'bbbbbbb', ...repo], io(gh));
  assert.equal(r.code, 0, r.err);
  assert.match(gh.state.issues[9].body, /stage=rb-verifier task=T1 outcome=pass head=bbbbbbb/);
  assert.doesNotMatch(gh.state.issues[9].body, /outcome=fail/);
});

test('rb gh label-create: project labels only, idempotent, updates color and description (#27)', async () => {
  const root = repoWith({ 'AGENTS.md': AGENTS() });
  const gh = fakeGh();
  const run = (...a) => rbJson(root, ['gh', 'label-create', ...a, ...repo], io(gh));
  assert.equal((await run('report:content', '--color', '#1D76DB', '--description', 'Content report')).json.action, 'created');
  assert.deepEqual(gh.state.labels['report:content'], { name: 'report:content', color: '1d76db', description: 'Content report' });
  assert.equal((await run('report:content', '--color', '1d76db', '--description', 'Content report')).json.action, 'ok');
  assert.equal((await run('report:content', '--color', '00ff00', '--description', 'Content report')).json.action, 'updated');
  assert.equal(gh.state.labels['report:content'].color, '00ff00');
  assert.equal((await rb(root, ['gh', 'label-create', 'rb:task', ...repo], io(gh))).code, 2, 'harness labels come from labels-ensure');
  assert.equal((await rb(root, ['gh', 'label-create', 'x', '--color', 'red', ...repo], io(gh))).code, 2);
});

test('rb ci wait and rb ci logs (#26)', async () => {
  const root = repoWith({ 'AGENTS.md': AGENTS() });
  const gh = fakeGh();
  const sha = 'a'.repeat(40);
  const run = (name, over = {}) => ({ id: name === 'rockbuilt-ci' ? 11 : 12, name, status: 'completed', conclusion: 'success', started_at: '2026-10-22T10:00:00Z', completed_at: '2026-10-22T10:12:30Z', ...over });
  gh.state.checkRuns[sha] = [run('rockbuilt-ci'), run('e2e (1)')];
  let r = await rbJson(root, ['ci', 'wait', sha, ...repo], io(gh));
  assert.equal(r.code, 0);
  assert.equal(r.json.green, true);
  assert.equal(r.json.checks[0].minutes, 12.5, 'checks carry their duration');

  gh.state.checkRuns[sha] = [run('rockbuilt-ci'), run('e2e (1)', { conclusion: 'failure' })];
  r = await rb(root, ['ci', 'wait', sha, ...repo], io(gh));
  assert.equal(r.code, 1);
  assert.match(r.out, /^RED/);

  gh.state.checkRuns[sha] = [run('rockbuilt-ci', { status: 'in_progress', conclusion: null, completed_at: undefined })];
  await withEnv({ RB_CI_POLL_S: '0' }, async () => {
    r = await rbJson(root, ['ci', 'wait', sha, '--timeout', '0', ...repo], io(gh));
  });
  assert.equal(r.code, 3, 'still running at the timeout');
  assert.equal(r.json.timedOut, true);

  gh.state.checkRuns[sha] = [run('rockbuilt-ci'), run('e2e (1)', { conclusion: 'failure' })];
  gh.state.jobLogs = { 12: 'setup\nrunning 40 tests\n  1) home.spec.ts:12 expected "Hola"\nexit 1\n' };
  r = await rbJson(root, ['ci', 'logs', sha, '--tail', '2', ...repo], io(gh));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.jobs.map((j) => [j.name, j.source]), [['e2e (1)', 'log']]);
  assert.deepEqual(r.json.jobs[0].lines, ['exit 1', '']);

  // The log download is refused (cloud sessions): the annotations are the evidence.
  gh.state.jobLogs = {};
  gh.state.annotations = { 12: [{ annotation_level: 'failure', path: 'e2e/home.spec.ts', start_line: 12, title: 'home', message: 'expected "Hola"' }] };
  r = await rbJson(root, ['ci', 'logs', sha, ...repo], io(gh));
  assert.equal(r.json.jobs[0].source, 'annotations');
  assert.deepEqual(r.json.jobs[0].lines, ['failure: e2e/home.spec.ts:12 home: expected "Hola"']);
  assert.equal((await rb(root, ['ci', 'logs', sha, '--job', 'nope', ...repo], io(gh))).code, 3);
  assert.equal((await rb(root, ['ci', 'wait', 'main', ...repo], io(gh))).code, 2, 'a sha, not a ref');
});

test('findBrowser: PW_CHROMIUM_PATH, then the chromium link, then the newest chromium-<n>', () => {
  const exe = (dir, rel) => { write(dir, rel, '#!/bin/sh\n'); chmodSync(path.join(dir, rel), 0o755); return path.join(dir, rel); };
  const browsers = tmp();
  exe(browsers, 'chromium-1100/chrome-linux/chrome');
  const newest = exe(browsers, 'chromium-1187/chrome-linux64/chrome');
  write(browsers, 'chromium-1200/README', 'not a build\n');
  let r = findBrowser({ PLAYWRIGHT_BROWSERS_PATH: browsers });
  assert.equal(r.path, newest, 'newest version with an executable');
  const own = exe(tmp(), 'my-chrome');
  assert.equal(findBrowser({ PW_CHROMIUM_PATH: own, PLAYWRIGHT_BROWSERS_PATH: browsers }).path, own);
  r = findBrowser({ PW_CHROMIUM_PATH: path.join(browsers, 'missing'), PLAYWRIGHT_BROWSERS_PATH: browsers });
  assert.equal(r.path, newest, 'a PW_CHROMIUM_PATH that is not a file is skipped');
  const linked = exe(browsers, 'chromium');
  assert.equal(findBrowser({ PLAYWRIGHT_BROWSERS_PATH: browsers }).path, linked);
});

test('rb risk: a host in a test file counts only on a network call (#23, #31)', async () => {
  const root = repoWith({ 'AGENTS.md': AGENTS(), 'src/a.js': 'export const a = 1;\n' });
  sh(root, 'git', ['checkout', '-q', '-b', 'rb/T1-x']);
  write(root, 'e2e/links.spec.ts', "test('link', async ({ page }) => {\n  await expect(page.getByRole('link')).toHaveAttribute('href', 'https://docs.acme-guide.io/start');\n});\n");
  commitAll(root, 'test with a literal url');
  let r = await rbJson(root, ['risk', '--base', 'main']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.tier, 'A', JSON.stringify(r.json.reasons));
  write(root, 'e2e/live.spec.ts', "test('live', async () => {\n  const res = await fetch('https://api.acme-weather.io/v1');\n});\n");
  commitAll(root, 'test calling a host');
  r = await rbJson(root, ['risk', '--base', 'main']);
  assert.ok(r.json.reasons.some((x) => /api\.acme-weather\.io/.test(`${x.detail} ${x.path}`)), JSON.stringify(r.json.reasons));
});

test('classify: test-file hosts, expected values exempt, reachable calls count', () => {
  const tier = (p, lines, head = null) => classify({ files: [{ path: p, status: 'modified', additions: lines.length, deletions: 0, added: lines }], headText: () => head }).tier;
  // Expected values: never a call.
  assert.equal(tier('e2e/citas.ts', ['export const doiHref = (doi) => `https://doi.org/${doi}`;']), 'A');
  assert.equal(tier('tests/readme.test.ts', ["  expect(readme).toContain('https://www.linkedin.com/in/me/');"]), 'A');
  assert.equal(tier('e2e/links.spec.ts', ["await expect(link).toHaveAttribute('href', 'https://docs.acme-guide.io/a');", "await page.goto('/');"]), 'A');
  assert.equal(tier('tests/t.test.ts', ["test('got https://acme-weather.io back', () => {});"]), 'A', 'a word, not a call');
  // Reachable calls.
  assert.equal(tier('tests/pay.test.ts', ["const API = 'https://api.stripe-like.io/v1';", 'await fetch(API);']), 'C');
  assert.equal(tier('tests/pay.test.ts', ["const API = 'https://api.stripe-like.io/v1';"], "const API = 'https://api.stripe-like.io/v1';\nawait fetch(\n  API);\n"), 'C', 'the call is elsewhere in the file');
  assert.equal(tier('e2e/prod.spec.ts', ["test.use({ baseURL: 'https://prod.acme-shop.io' });"]), 'C');
  assert.equal(tier('tests/helpers/env.ts', ["export const BASE_URL = 'https://prod.acme-shop.io';"]), 'C');
  assert.equal(tier('src/client.ts', ["const u = 'https://api.acme-weather.io';"]), 'C', 'production code is unchanged');
});

test('review-delta: a base change only in bookkeeping, or far from the task lines, keeps the review (#24)', async () => {
  const lines = (over) => Array.from({ length: 30 }, (_, i) => over[i] ?? `l${i}`).join('\n') + '\n';
  const root = repoWith({ 'src/a.js': lines({}), 'docs/progress.md': '# Progress\n' });
  sh(root, 'git', ['checkout', '-q', '-b', 'rb/T1-x']);
  write(root, 'src/a.js', lines({ 4: 'task' }));
  const reviewed = commitAll(root, 'task');
  const step = async (file, text) => {
    sh(root, 'git', ['checkout', '-q', 'main']);
    write(root, file, text);
    commitAll(root, `main edits ${file}`);
    sh(root, 'git', ['checkout', '-q', 'rb/T1-x']);
    sh(root, 'git', ['merge', '-q', '--no-edit', 'main']);
    return rbJson(root, ['review-delta', '--reviewed', reviewed, '--base', 'main']);
  };
  let r = await step('docs/progress.md', '# Progress\n- T0 done\n');
  assert.equal(r.json.identical, true, r.json.detail);
  r = await step('src/a.js', lines({ 25: 'main' }));
  assert.equal(r.json.identical, true, r.json.detail);
  assert.match(r.json.detail, /same task diff/);
  assert.equal(normalizePatch('index 1a2b3c4..5d6e7f8 100644\n@@ -10,3 +12,4 @@ ctx\n+x\n'), '@@ ctx\n+x');
});

test('rb protect: required checks without strict, rockbuilt-e2e when the project has E2E', async () => {
  const root = repoWith({ 'AGENTS.md': AGENTS('\n## E2E\n```bash\nnpx playwright test\n```\n') });
  const gh = fakeGh();
  const r = await rbJson(root, ['protect', ...repo], io(gh));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(gh.state.protection, { mode: 'on', contexts: ['rockbuilt-ci', 'rockbuilt-e2e'] }, 'strict would block the merge queue');
});

test('rb gh pr-create raises the tier marker and label to rb risk on the real diff (#29)', async () => {
  const root = repoWith({ 'AGENTS.md': AGENTS(), 'package.json': '{"name":"app","dependencies":{}}\n' });
  const bare = tmp();
  sh(bare, 'git', ['init', '-q', '--bare', '-b', 'main']);
  sh(root, 'git', ['remote', 'add', 'origin', bare]);
  sh(root, 'git', ['push', '-q', 'origin', 'main']);
  sh(root, 'git', ['fetch', '-q', 'origin']);
  sh(root, 'git', ['checkout', '-q', '-b', 'rb/T1-dep']);
  write(root, 'package.json', '{"name":"app","dependencies":{"left-pad":"1.3.0"}}\n');
  commitAll(root, 'add a dependency');
  const dir = tmp();
  write(dir, 'body.md', 'Closes #3\n<!-- rockbuilt:tier B -->\n');
  const gh = fakeGh();
  const r = await rbJson(root, ['gh', 'pr-create', '--head', 'rb/T1-dep', '--base', 'main', '--title', 'T1', '--body-file', path.join(dir, 'body.md'), '--label', 'rb:tier-b', ...repo], io(gh));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json.tierRaised.from, r.json.tierRaised.to], ['B', 'C']);
  const pr = gh.state.issues[r.json.number];
  assert.match(pr.body, /<!-- rockbuilt:tier C -->/);
  assert.deepEqual(pr.labels, ['rb:tier-c']);
});

test('rb vendor keeps the template smoke spec out of a project with its own E2E suite (#22)', async () => {
  const h = tmp('rb-harness-');
  write(h, '.claude-plugin/plugin.json', JSON.stringify({ name: 'rockbuilt', version: '0.10.0' }));
  write(h, 'scripts/rb.mjs', '// rb\n');
  write(h, 'hooks/guard.mjs', '// guard\n');
  write(h, 'harness/project/AGENTS.md', '# <Project name>\n\nDocs language: <es|en>\nProject type: <web, ai, automation>\n');
  write(h, 'harness/web/e2e/smoke.spec.ts', '// smoke\n');
  write(h, 'harness/project/gitignore-additions.txt', '.rockbuilt/\n');
  const fresh = repoWith();
  assert.equal((await rbJson(fresh, ['vendor', '--from', h, '--type', 'web', '--lang', 'es'])).code, 0);
  assert.ok(existsSync(path.join(fresh, 'e2e/smoke.spec.ts')), 'a new project gets the walking-skeleton smoke test');
  const existing = repoWith({ 'e2e/home.spec.ts': '// real suite\n' });
  const r = await rbJson(existing, ['vendor', '--from', h, '--type', 'web', '--lang', 'es']);
  assert.equal(r.code, 0, r.err);
  assert.ok(!existsSync(path.join(existing, 'e2e/smoke.spec.ts')));
});

test('markers and the control issue come only from trusted authors (#30)', async () => {
  const root = repoWith({ 'AGENTS.md': AGENTS() });
  const gh = fakeGh();
  gh.state.issues[2] = { number: 2, title: 'Rockbuilt control', body: 'spoof', state: 'open', labels: [], author: 'stranger', author_association: 'NONE' };
  const r = await rbJson(root, ['control', 'ensure', ...repo], io(gh));
  assert.equal(r.code, 0, r.err);
  assert.notEqual(r.json.number, 2, 'an outsider issue with the control title is not adopted');
});
