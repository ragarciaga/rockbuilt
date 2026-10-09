import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { parseBody } from '../scripts/lib/merge.mjs';
import { REPO, cleanup, emptyState, fakeGh, fakeGhScript, rb, rbJson, repoWith, sh, tmp, withEnv, write } from './rb-helpers.mjs';

after(cleanup);

const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const AGENTS = '# App\n\nDocs language: es\nProject type: web\nDefault branch: main\nAutonomy: auto\n\n## Verification\n```bash\nnode -e "0"\n```\n';

function project() {
  const root = repoWith({ 'AGENTS.md': AGENTS, 'src/app.js': 'export const a = 1;\n' });
  sh(root, 'git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
  return root;
}

const statusLine = (stage, head = HEAD, outcome = 'pass') => `<!-- rockbuilt:status stage=${stage} task=T1 outcome=${outcome} head=${head} -->`;

// PR #pr with one file per tier, green rockbuilt-ci, verifier (+auditor for B) lines.
function seed(gh, { tier = 'A', files, labels, body, checks, number = 10, mergeable = true, draft = false, base = 'main' } = {}) {
  const s = gh.state;
  const fileList = files || (tier === 'A'
    ? [{ filename: 'src/app.test.js', status: 'added', additions: 3, deletions: 0, patch: '@@\n+test' }]
    : [{ filename: 'src/feature.js', status: 'added', additions: 3, deletions: 0, patch: '@@\n+export const f = 1;' }]);
  const lines = [statusLine('rb-verifier')];
  if (tier !== 'A') lines.push(statusLine('rb-auditor'));
  s.issues[3] = { number: 3, title: 'T1: feature', body: '<!-- rockbuilt:task T1 spec=docs/specs/01-x -->', state: 'open', labels: ['rb:task', 'rb:in-progress', 'rb:pr-open'] };
  s.issues[number] = { number, title: 'feat: T1', body: body ?? `Closes #3\n\n${lines.join('\n')}\n<!-- rockbuilt:tier ${tier} -->\n`, state: 'open', labels: labels || [`rb:tier-${tier.toLowerCase()}`, 'rb:pr-open'], isPr: true };
  s.pulls[number] = { number, head: 'rb/T1-feature', base, headSha: HEAD, mergeable, draft };
  s.files[number] = fileList;
  s.checkRuns[HEAD] = checks || [{ name: 'rockbuilt-ci', status: 'completed', conclusion: 'success', started_at: '2026-10-09T00:00:00Z' }];
  s.nextNumber = 20;
}

async function locked(root, gh, run = 'run-1') {
  const r = await rbJson(root, ['lock', 'acquire', '--run', run], { ghRunner: gh.runner });
  assert.equal(r.code, 0, r.err);
}

async function gate(root, gh, extra = []) {
  return rbJson(root, ['merge-gate', '10', ...extra], { ghRunner: gh.runner });
}

const reasonRules = (r) => r.json.reasons.map((x) => x.rule);

test('merge-gate: eligible tier A merges with squash at the head sha, then comments, labels and records', async () => {
  const root = project();
  const gh = fakeGh();
  seed(gh);
  await locked(root, gh);
  const dry = await gate(root, gh, ['--run', 'run-1', '--dry-run']);
  assert.equal(dry.code, 0, JSON.stringify(dry.json.reasons));
  assert.equal(dry.json.merged, false);
  assert.equal(gh.state.merges.length, 0);

  const r = await gate(root, gh, ['--run', 'run-1']);
  assert.equal(r.code, 0, JSON.stringify(r.json.reasons));
  assert.equal(r.json.merged, true);
  assert.deepEqual(gh.state.merges[0], { pr: 10, merge_method: 'squash', sha: HEAD, commit_title: 'feat: T1 (#10)' });
  assert.match(gh.state.comments[10].at(-1).body, /rb\.mjs revert 10/);
  assert.equal(gh.state.issues[3].state, 'closed');
  assert.deepEqual(gh.state.issues[3].labels, ['rb:task']);
  const rec = JSON.parse(readFileSync(path.join(root, '.rockbuilt', 'merges.jsonl'), 'utf8').trim());
  assert.equal(rec.pr, 10);
  assert.deepEqual(rec.issues, [3]);
  assert.ok(gh.calls.every((c) => !/graphql/.test(c.path)));
});

test('merge-gate: tier B needs the auditor line; stale verifier head is refused', async () => {
  const root = project();
  let gh = fakeGh();
  seed(gh, { tier: 'B', body: `${statusLine('rb-verifier')}\n` });
  await locked(root, gh);
  let r = await gate(root, gh, ['--run', 'run-1']);
  assert.equal(r.code, 3);
  assert.ok(r.json.reasons.some((x) => x.rule === 'status-line' && /rb-auditor/.test(x.detail)));
  assert.equal(gh.state.merges.length, 0);

  gh = fakeGh();
  seed(gh, { body: `${statusLine('rb-verifier', '0000000aaaa')}\n` });
  await locked(root, gh);
  r = await gate(root, gh, ['--run', 'run-1']);
  assert.equal(r.code, 3);
  assert.deepEqual(reasonRules(r), ['stale-head']);

  gh = fakeGh();
  seed(gh, { body: `${statusLine('rb-verifier')}\n<!-- rockbuilt:security required -->\n` });
  await locked(root, gh);
  r = await gate(root, gh, ['--run', 'run-1']);
  assert.ok(r.json.reasons.some((x) => /rb-security-reviewer/.test(x.detail)));
});

test('merge-gate: failing check, pending check and missing CI', async () => {
  const root = project();
  let gh = fakeGh();
  seed(gh, { checks: [{ name: 'rockbuilt-ci', status: 'completed', conclusion: 'failure' }] });
  await locked(root, gh);
  let r = await gate(root, gh, ['--run', 'run-1']);
  assert.equal(r.code, 3);
  assert.ok(r.json.reasons.some((x) => x.rule === 'checks' && /failure/.test(x.detail)));

  gh = fakeGh();
  seed(gh, { checks: [{ name: 'rockbuilt-ci', status: 'completed', conclusion: 'success' }] });
  gh.state.statuses[HEAD] = [{ context: 'vercel', state: 'pending' }];
  await locked(root, gh);
  r = await gate(root, gh, ['--run', 'run-1']);
  assert.ok(r.json.reasons.some((x) => x.rule === 'checks' && /vercel is in_progress/.test(x.detail)));

  gh = fakeGh();
  seed(gh, { checks: [{ name: 'lint', status: 'completed', conclusion: 'success' }] });
  await locked(root, gh);
  r = await gate(root, gh, ['--run', 'run-1']);
  assert.deepEqual(reasonRules(r), ['ci']);
});

test('merge-gate: label tier lower than the live risk, and declared tier above the label', async () => {
  const root = project();
  let gh = fakeGh();
  seed(gh, { tier: 'A', files: [{ filename: 'src/feature.js', status: 'added', additions: 1, deletions: 0, patch: '@@\n+x' }] });
  await locked(root, gh);
  let r = await gate(root, gh, ['--run', 'run-1']);
  assert.equal(r.code, 3);
  assert.ok(r.json.reasons.some((x) => x.rule === 'risk' && /tier B but the label is tier A/.test(x.detail)));

  gh = fakeGh();
  seed(gh, { tier: 'B', files: [{ filename: 'supabase/migrations/1.sql', status: 'added', additions: 1, deletions: 0, patch: '@@\n+x' }] });
  await locked(root, gh);
  r = await gate(root, gh, ['--run', 'run-1']);
  assert.ok(r.json.reasons.some((x) => x.rule === 'risk' && /tier C/.test(x.detail)));
  assert.ok(r.json.reasons.some((x) => x.rule === 'tier-c'));

  gh = fakeGh();
  seed(gh, { body: `${statusLine('rb-verifier')}\n<!-- rockbuilt:tier B -->\n` });
  await locked(root, gh);
  r = await gate(root, gh, ['--run', 'run-1']);
  assert.ok(r.json.reasons.some((x) => x.rule === 'declared-tier'));
});

test('merge-gate: blocking labels, draft, wrong base, not mergeable, no tier label', async () => {
  const root = project();
  const cases = [
    [{ labels: ['rb:tier-a', 'rb:hold'] }, 'blocking-label'],
    [{ labels: ['rb:tier-a', 'rb:needs-human'] }, 'blocking-label'],
    [{ labels: ['rb:pr-open'] }, 'tier-label'],
    [{ draft: true }, 'draft'],
    [{ base: 'develop' }, 'base'],
    [{ mergeable: false }, 'mergeable'],
  ];
  for (const [opts, rule] of cases) {
    const gh = fakeGh();
    seed(gh, opts);
    await locked(root, gh);
    const r = await gate(root, gh, ['--run', 'run-1']);
    assert.equal(r.code, 3, rule);
    assert.ok(reasonRules(r).includes(rule), `${rule}: ${JSON.stringify(r.json.reasons)}`);
  }
});

test('merge-gate: stop switch on, and lock not held by this run', async () => {
  const root = project();
  let gh = fakeGh();
  seed(gh);
  await locked(root, gh);
  gh.state.issues[15] = { number: 15, title: 'para', body: '', state: 'open', labels: ['rb:stop'] };
  let r = await gate(root, gh, ['--run', 'run-1']);
  assert.deepEqual(reasonRules(r), ['stop']);

  gh = fakeGh();
  seed(gh);
  await locked(root, gh, 'other-run');
  r = await gate(root, gh, ['--run', 'run-1']);
  assert.deepEqual(reasonRules(r), ['lock']);
  assert.match(r.json.reasons[0].detail, /held by run other-run/);

  gh = fakeGh();
  seed(gh);
  r = await gate(root, gh, []);
  assert.deepEqual(reasonRules(r), ['lock']);
});

test('merge-gate --human-approved: tier C allowed without the lock; still needs CI and the verifier', async () => {
  const root = project();
  const gh = fakeGh();
  seed(gh, {
    tier: 'C',
    labels: ['rb:tier-c', 'rb:needs-human'],
    files: [{ filename: 'src/auth/login.js', status: 'added', additions: 1, deletions: 0, patch: '@@\n+x' }],
    body: `Closes #3\n${statusLine('rb-verifier')}\n${statusLine('rb-auditor')}\n`,
  });
  let r = await gate(root, gh, ['--run', 'run-1']);
  assert.equal(r.code, 3);
  assert.ok(reasonRules(r).includes('tier-c'));
  r = await gate(root, gh, ['--human-approved']);
  assert.equal(r.code, 0, JSON.stringify(r.json.reasons));
  assert.equal(r.json.merged, true);
  assert.equal(r.json.tier, 'C');
  gh.state.issues[10].state = 'open';
  gh.state.pulls[10].merged_at = null;
  gh.state.checkRuns[HEAD] = [];
  r = await gate(root, gh, ['--human-approved']);
  assert.ok(reasonRules(r).includes('ci'));
});

test('lock: acquire, refuse while held, take over after 3 hours, release', async () => {
  const root = project();
  const gh = fakeGh();
  const io = { ghRunner: gh.runner };
  await withEnv({ RB_NOW: '2026-10-09T01:00:00.000Z' }, async () => {
    const a = await rbJson(root, ['lock', 'acquire', '--run', 'n1'], io);
    assert.equal(a.code, 0);
    assert.equal(a.json.control, 1);
    assert.deepEqual(gh.state.issues[1].labels.sort(), ['rb:control', 'rb:running']);
    assert.equal(Object.keys(gh.state.labels).length, 16, 'labels ensured with the control issue');
  });
  await withEnv({ RB_NOW: '2026-10-09T03:59:00.000Z' }, async () => {
    const b = await rbJson(root, ['lock', 'acquire', '--run', 'n2'], io);
    assert.equal(b.code, 3);
    assert.equal(b.json.holder, 'n1');
    const st = await rbJson(root, ['lock', 'status'], io);
    assert.equal(st.json.held, true);
    assert.equal((await rbJson(root, ['lock', 'release', '--run', 'n2'], io)).code, 3);
  });
  await withEnv({ RB_NOW: '2026-10-09T04:01:00.000Z' }, async () => {
    const st = await rbJson(root, ['lock', 'status'], io);
    assert.equal(st.json.held, false);
    assert.equal(st.json.stale, true);
    const c = await rbJson(root, ['lock', 'acquire', '--run', 'n2'], io);
    assert.equal(c.code, 0);
    assert.equal(c.json.tookOverStale, true);
    const rel = await rbJson(root, ['lock', 'release', '--run', 'n2'], io);
    assert.equal(rel.code, 0);
    assert.ok(!gh.state.issues[1].labels.includes('rb:running'));
    assert.equal((await rbJson(root, ['lock', 'status'], io)).json.held, false);
  });
  assert.equal((await rb(root, ['lock', 'acquire'], io)).code, 2);
});

test('control ensure is idempotent; stop status; escalate; digest', async () => {
  const root = project();
  const gh = fakeGh();
  const io = { ghRunner: gh.runner };
  const first = await rbJson(root, ['control', 'ensure'], io);
  const second = await rbJson(root, ['control', 'ensure'], io);
  assert.equal(first.json.created, true);
  assert.equal(second.json.created, false);
  assert.equal(second.json.number, first.json.number);
  assert.equal((await rb(root, ['control', 'ensure'], io)).out, String(first.json.number));

  assert.equal((await rb(root, ['stop', 'status'], io)).code, 0);
  gh.state.issues[first.json.number].labels.push('rb:stop');
  const stop = await rbJson(root, ['stop', 'status'], io);
  assert.equal(stop.code, 3);
  assert.equal(stop.json.issues[0].number, first.json.number);

  const dir = tmp();
  const bodyFile = path.join(dir, 'q.md');
  writeFileSync(bodyFile, 'Opciones: A o B. Recomiendo A. Costo: USD 5/mes.\n');
  gh.state.issues[7] = { number: 7, title: 'T7', body: '', state: 'open', labels: ['rb:task'] };
  const e = await rbJson(root, ['escalate', '7', '--kind', 'human', '--title', 'Elegir proveedor', '--body-file', bodyFile], io);
  assert.equal(e.code, 0, e.err);
  assert.ok(gh.state.issues[7].labels.includes('rb:needs-human'));
  assert.match(gh.state.comments[7][0].body, /### Elegir proveedor\n\nOpciones/);
  const n = await rbJson(root, ['escalate', 'new', '--kind', 'local', '--title', 'Correr E2E local', '--body-file', bodyFile], io);
  assert.equal(n.json.created, true);
  assert.deepEqual(gh.state.issues[n.json.issue].labels, ['rb:needs-local']);
  assert.equal((await rb(root, ['escalate', '7', '--kind', 'robot', '--title', 't', '--body-file', bodyFile], io)).code, 2);

  writeFileSync(bodyFile, '## Resumen de la corrida\n- #10 fusionado\n');
  const d = await rbJson(root, ['digest', 'post', '--file', bodyFile], io);
  assert.equal(d.code, 0);
  assert.match(gh.state.comments[first.json.number].at(-1).body, /^<!-- rockbuilt:digest at=.* -->\n## Resumen de la corrida/);
});

test('rb gh ops: issue-view with comments and association, checks merge, labels-ensure, pr-create', async () => {
  const root = project();
  const gh = fakeGh();
  const io = { ghRunner: gh.runner };
  const dir = tmp();
  writeFileSync(path.join(dir, 'b.md'), 'body text');
  const created = await rbJson(root, ['gh', 'issue-create', '--title', 'X', '--body-file', path.join(dir, 'b.md'), '--label', 'rb:task,rb:bug'], io);
  assert.deepEqual(created.json.labels, ['rb:task', 'rb:bug']);
  await rbJson(root, ['gh', 'issue-comment', String(created.json.number), '--body-file', path.join(dir, 'b.md')], io);
  const view = await rbJson(root, ['gh', 'issue-view', String(created.json.number)], io);
  assert.equal(view.json.body, 'body text');
  assert.equal(view.json.author_association, 'OWNER');
  assert.equal(view.json.comments[0].author_association, 'OWNER');
  assert.equal((await rbJson(root, ['gh', 'issue-list', '--label', 'rb:bug'], io)).json.length, 1);
  await rbJson(root, ['gh', 'label-remove', String(created.json.number), 'rb:bug'], io);
  const again = await rbJson(root, ['gh', 'label-remove', String(created.json.number), 'rb:bug'], io);
  assert.equal(again.code, 0, 'removing an absent label is not an error');

  gh.state.checkRuns.abc = [
    { name: 'rockbuilt-ci', status: 'completed', conclusion: 'failure', started_at: '2026-01-01T00:00:00Z' },
    { name: 'rockbuilt-ci', status: 'completed', conclusion: 'success', started_at: '2026-01-02T00:00:00Z' },
  ];
  gh.state.statuses.abc = [{ context: 'ci/legacy', state: 'error' }];
  const checks = await rbJson(root, ['gh', 'checks', 'abc'], io);
  assert.deepEqual(checks.json.map((c) => [c.name, c.status, c.conclusion]), [['rockbuilt-ci', 'completed', 'success'], ['ci/legacy', 'completed', 'failure']]);

  const labels = await rbJson(root, ['labels'], io);
  assert.equal(labels.json.labels.filter((l) => l.action === 'created').length, 16);
  assert.ok((await rbJson(root, ['gh', 'labels-ensure'], io)).json.every((l) => l.action === 'ok'));

  const pr = await rbJson(root, ['gh', 'pr-create', '--head', 'rb/T1-x', '--title', 'T1', '--body-file', path.join(dir, 'b.md'), '--label', 'rb:tier-a'], io);
  assert.equal(pr.code, 0, pr.err);
  assert.deepEqual(pr.json.labels, ['rb:tier-a']);
  const prCall = gh.calls.find((c) => c.method === 'POST' && /pulls$/.test(c.path));
  assert.equal(prCall.body.base, 'main', 'base defaults to the contract default branch');
  assert.equal((await rbJson(root, ['gh', 'pr-list', '--head-prefix', 'rb/'], io)).json.length, 1);
  assert.equal((await rbJson(root, ['gh', 'whoami'], io)).json.login, 'rb-bot');
  const missing = await rbJson(root, ['gh', 'issue-view', '999'], io);
  assert.equal(missing.code, 1);
  assert.match(missing.json.error, /HTTP 404/);
  assert.equal((await rb(root, ['gh', 'frob'], io)).code, 2);
});

test('rb gh through RB_GH_BIN: gh api with the JSON body on stdin, repo from an ssh remote', async () => {
  const root = repoWith({ 'AGENTS.md': AGENTS });
  sh(root, 'git', ['remote', 'add', 'origin', `git@github.com:${REPO}.git`]);
  const dir = tmp();
  const state = path.join(dir, 'state.json');
  const log = path.join(dir, 'log.jsonl');
  writeFileSync(state, JSON.stringify(emptyState()));
  write(dir, 'b.md', 'hola');
  await withEnv({ RB_GH_BIN: fakeGhScript(dir), RB_GH_STATE: state, RB_GH_LOG: log }, async () => {
    const r = await rbJson(root, ['gh', 'issue-create', '--title', 'Hola', '--body-file', path.join(dir, 'b.md')]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.number, 1);
    const p = await rbJson(root, ['protect']);
    assert.equal(p.code, 0, p.err);
  });
  const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(calls[0].args, ['api', `repos/${REPO}/issues`, '--method', 'POST', '--input', '-']);
  assert.deepEqual(JSON.parse(calls[0].input), { title: 'Hola', body: 'hola', labels: [] });
  assert.ok(calls.every((c) => c.args[0] === 'api'));
  assert.deepEqual(JSON.parse(readFileSync(state, 'utf8')).protection, { mode: 'on', contexts: ['rockbuilt-ci'] });
});

test('protect on a free private repo exits 3 with the cost explanation; doctor reports rb-only', async () => {
  const root = project();
  const gh = fakeGh();
  gh.state.protection = { mode: 'paywall' };
  const r = await rb(root, ['protect'], { ghRunner: gh.runner });
  assert.equal(r.code, 3);
  assert.match(r.out, /GitHub Pro \(USD 4\/month\) or a public repo/);
  const d = await rbJson(root, ['doctor'], { ghRunner: gh.runner });
  const byName = Object.fromEntries(d.json.checks.map((c) => [c.name, c]));
  assert.equal(byName.protection.status, 'WARN');
  assert.match(byName.protection.detail, /^rb-only: .*USD 4\/month.*the user decides/);
  assert.equal(byName.labels.status, 'WARN');
  assert.equal(byName['control issue'].status, 'WARN');
  assert.equal(byName['AGENTS.md'].status, 'PASS');
  assert.equal(byName['CI workflow'].status, 'WARN');
  gh.state.protection = { mode: 'on', contexts: ['rockbuilt-ci'] };
  await rbJson(root, ['labels'], { ghRunner: gh.runner });
  await rbJson(root, ['control', 'ensure'], { ghRunner: gh.runner });
  const d2 = await rbJson(root, ['doctor'], { ghRunner: gh.runner });
  const by2 = Object.fromEntries(d2.json.checks.map((c) => [c.name, c.status]));
  assert.equal(by2.protection, 'PASS');
  assert.equal(by2.labels, 'PASS');
  assert.equal(by2['control issue'], 'PASS');
});

test('doctor works offline: GitHub failures are WARN, local checks still run', async () => {
  const root = project();
  write(root, 'tools/rockbuilt/VERSION', '0.0.1\n');
  const offline = () => ({ ok: false, status: 1, stdout: '', stderr: 'error connecting to api.github.com' });
  const d = await rbJson(root, ['doctor'], { ghRunner: offline });
  const byName = Object.fromEntries(d.json.checks.map((c) => [c.name, c]));
  assert.equal(byName.protection.status, 'WARN');
  assert.match(byName.protection.detail, /could not check/);
  assert.equal(byName['vendored harness'].status, 'WARN', 'version differs from the plugin');
  assert.match(byName['vendored harness'].detail, /0\.0\.1, plugin/);
});

test('parseBody: status lines (last one wins), tier, security and closing keywords', () => {
  const b = parseBody(`Fixes #4, closes #5\n${statusLine('rb-verifier', HEAD, 'fail')}\n${statusLine('rb-verifier')}\nsecurity: required\n<!-- rockbuilt:tier b -->`);
  assert.equal(b.status['rb-verifier'].outcome, 'pass');
  assert.equal(b.tier, 'B');
  assert.equal(b.security, true);
  assert.deepEqual(b.closes, [4, 5]);
});

test('rb revert: reverts the squash commit on rb/revert-<pr> in a temporary worktree and opens a human-merge PR', async () => {
  const bare = tmp('rb-origin-');
  sh(bare, 'git', ['init', '-q', '--bare', '-b', 'main']);
  const root = repoWith({ 'AGENTS.md': AGENTS, 'src/app.js': 'export const a = 1;\n' });
  sh(root, 'git', ['remote', 'add', 'origin', bare]);
  write(root, 'src/feature.js', 'export const f = 1;\n');
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-q', '-m', 'feat: T1 (#10)']);
  const merged = sh(root, 'git', ['rev-parse', 'HEAD']);
  sh(root, 'git', ['push', '-q', 'origin', 'main']);
  const gh = fakeGh();
  gh.state.issues[10] = { number: 10, title: 'feat: T1', body: '', state: 'closed', labels: [], isPr: true };
  gh.state.pulls[10] = { number: 10, head: 'rb/T1-feature', base: 'main', headSha: HEAD, merged_at: '2026-10-09T00:00:00Z', merge_commit_sha: merged };
  gh.state.nextNumber = 11;
  const r = await rbJson(root, ['revert', '10', '--repo', REPO], { ghRunner: gh.runner });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.branch, 'rb/revert-10');
  assert.equal(r.json.pr, 11);
  assert.deepEqual(gh.state.issues[11].labels, ['rb:tier-c', 'rb:needs-human']);
  assert.equal(gh.state.pulls[11].head, 'rb/revert-10');
  assert.match(gh.state.issues[11].title, /^Revert "feat: T1"$/);
  const files = sh(bare, 'git', ['ls-tree', '-r', '--name-only', 'rb/revert-10']);
  assert.ok(!files.split('\n').includes('src/feature.js'), 'the revert removes the merged change');
  assert.equal(sh(root, 'git', ['rev-parse', '--abbrev-ref', 'HEAD']), 'main', 'the user checkout is untouched');
  assert.equal(sh(root, 'git', ['status', '--porcelain']), '');
  assert.equal(sh(root, 'git', ['worktree', 'list']).split('\n').length, 1, 'temporary worktree removed');
  gh.state.pulls[10].merged_at = null;
  assert.equal((await rb(root, ['revert', '10', '--repo', REPO], { ghRunner: gh.runner })).code, 3);
});

test('merge-gate: bookkeeping PR merges unattended only when LESSONS.md just grows', async () => {
  const root = project();
  let gh = fakeGh();
  seed(gh, { body: 'Bookkeeping\n', labels: [], files: [
    { filename: 'docs/specs/01-x/tasks.md', status: 'modified', patch: '@@\n-Status: todo\n+Status: done' },
    { filename: '.claude/LESSONS.md', status: 'modified', patch: '@@\n+- 2026-10-09: new lesson' },
  ] });
  gh.state.pulls[10].head = 'rb/bookkeeping-cycle-abc';
  await locked(root, gh);
  let r = await gate(root, gh, ['--run', 'run-1']);
  assert.equal(r.code, 0, JSON.stringify(r.json.reasons));
  assert.equal(r.json.kind, 'bookkeeping');

  gh = fakeGh();
  seed(gh, { body: 'Bookkeeping\n', labels: [], files: [
    { filename: '.claude/LESSONS.md', status: 'modified', patch: '@@\n-- old lesson\n+- rewritten' },
  ] });
  gh.state.pulls[10].head = 'rb/bookkeeping-cycle-abc';
  await locked(root, gh);
  r = await gate(root, gh, ['--run', 'run-1']);
  assert.equal(r.code, 3);
  assert.ok(reasonRules(r).includes('bookkeeping'));

  gh = fakeGh();
  seed(gh, { body: 'Bookkeeping\n', labels: [], files: [
    { filename: 'src/app.js', status: 'modified', patch: '@@\n+x' },
  ] });
  gh.state.pulls[10].head = 'rb/bookkeeping-cycle-abc';
  await locked(root, gh);
  r = await gate(root, gh, ['--run', 'run-1']);
  assert.equal(r.code, 3);
  assert.ok(reasonRules(r).includes('bookkeeping'));
});

test('merge-gate: revert and spec PRs never merge unattended, but do with --human-approved', async () => {
  for (const ref of ['rb/revert-7', 'rb/spec-01-x', 'chore/rockbuilt-0.3.0']) {
    const root = project();
    const gh = fakeGh();
    seed(gh, { body: 'No reviewer lines\n', labels: [] });
    gh.state.pulls[10].head = ref;
    await locked(root, gh);
    const auto = await gate(root, gh, ['--run', 'run-1']);
    assert.equal(auto.code, 3, ref);
    assert.ok(reasonRules(auto).includes('human-only'), ref);
    const human = await gate(root, gh, ['--human-approved']);
    assert.equal(human.code, 0, `${ref}: ${JSON.stringify(human.json.reasons)}`);
  }
});

test('merge-gate: review-less kinds still need green CI and respect the stop switch', async () => {
  const root = project();
  const gh = fakeGh();
  seed(gh, { body: 'x\n', labels: [], checks: [{ name: 'rockbuilt-ci', status: 'completed', conclusion: 'failure', started_at: '2026-10-09T00:00:00Z' }] });
  gh.state.pulls[10].head = 'rb/revert-7';
  const r = await gate(root, gh, ['--human-approved']);
  assert.equal(r.code, 3);
  assert.ok(reasonRules(r).includes('checks'));
});
