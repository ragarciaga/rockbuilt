// PLAN-1.0 phase 6 (1.5.0): the pre-launch attack cycle (DESIGN 34).
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { inScope, normalizeTargets, parseScope } from '../scripts/lib/attack.mjs';
import { prKind } from '../scripts/lib/merge.mjs';
import { REPO, cleanup, fakeGh, rb, rbJson, repoWith, sh, withEnv } from './rb-helpers.mjs';

after(cleanup);

const AGENTS = (extra = '') => `# App\n\nDocs language: es\nProject type: web\nDefault branch: main\nAutonomy: auto\n${extra}\n## Verification\n\`\`\`bash\nnode -e "0"\n\`\`\`\n`;
function project(extra = '', files = {}) {
  const root = repoWith({ 'AGENTS.md': AGENTS(extra), ...files });
  sh(root, 'git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
  return root;
}
const cm = (body, at = '2026-11-20T10:00:00Z', extra = {}) => ({ body, author_association: 'OWNER', author: 'owner', created_at: at, ...extra });

test('H6: targets are own systems; shared providers only as a named project; no schemes or paths', () => {
  assert.deepEqual(normalizeTargets('app.maysa.co, API.maysa.co ,supabase:abcd1234'), ['app.maysa.co', 'api.maysa.co', 'supabase:abcd1234']);
  for (const bad of ['https://app.maysa.co', 'app.maysa.co/admin', 'supabase.co', '*.supabase.co', '*.com', 'vercel.app', 'openai.com', 'a b', '']) {
    assert.throws(() => normalizeTargets(bad), /target|needs at least one/, bad);
  }
  assert.deepEqual(normalizeTargets('maysa-chart.vercel.app,*.maysa.co,localhost:3000'), ['maysa-chart.vercel.app', '*.maysa.co', 'localhost:3000']);
});

test('H6: the scope comes only from a trusted author with write access, anchored, capped, revocable', () => {
  const marker = '<!-- rockbuilt:attack-scope targets=app.maysa.co,*.maysa.co until=2026-12-20 -->\nApruebo atacar app.maysa.co con las cuentas de prueba';
  const s = parseScope([cm(marker)], '2026-11-25T00:00:00Z');
  assert.deepEqual(s.targets, ['app.maysa.co', '*.maysa.co']);
  assert.match(s.words, /Apruebo atacar/);
  assert.equal(parseScope([cm(marker, undefined, { author_association: 'NONE' })], '2026-11-25T00:00:00Z'), null, 'untrusted');
  assert.equal(parseScope([cm(marker)], '2026-11-25T00:00:00Z', { canApprove: () => false }), null, 'no write access');
  assert.equal(parseScope([cm(`Digest:\n${marker}`)], '2026-11-25T00:00:00Z'), null, 'a quoted marker is not a scope');
  assert.equal(parseScope([cm(marker)], '2026-12-21T00:00:00Z'), null, 'expired');
  assert.equal(parseScope([cm(marker), cm('<!-- rockbuilt:attack-scope-revoke -->', '2026-11-21T00:00:00Z')], '2026-11-25T00:00:00Z'), null, 'revoked');
  const far = parseScope([cm('<!-- rockbuilt:attack-scope targets=app.maysa.co until=2027-12-31 -->\nok')], '2026-11-25T00:00:00Z');
  assert.equal(far.until, '2027-02-18', 'capped at 90 days');
  assert.equal(parseScope([cm('<!-- rockbuilt:attack-scope targets=supabase.co until=2026-12-20 -->\nok')], '2026-11-25T00:00:00Z'), null, 'a shared provider never parses');
});

test('H6: rb attack check matches exact hosts, ports and owned wildcards only', () => {
  const scope = { targets: ['app.maysa.co', '*.maysa.co', 'localhost:3000', 'supabase:abcd'] };
  for (const ok of ['app.maysa.co', 'https://app.maysa.co/login', 'app.maysa.co:443', 'api.maysa.co', 'localhost:3000', 'supabase:abcd']) assert.equal(inScope(scope, ok), true, ok);
  for (const no of ['maysa.co.evil.com', 'evilmaysa.co', 'localhost:5432', 'supabase:other', 'stripe.com', '']) assert.equal(inScope(scope, no), false, no);
  assert.equal(inScope(null, 'app.maysa.co'), false);
});

test('H6: rb attack scope records the owner words on the control issue; check exits 3 outside it', async () => {
  const root = project();
  const gh = fakeGh();
  const io = { ghRunner: gh.runner };
  await withEnv({ RB_NOW: '2026-11-25T10:00:00Z' }, async () => {
    assert.equal((await rbJson(root, ['attack', 'scope', 'show'], io)).code, 3, 'no scope yet');
    assert.equal((await rbJson(root, ['attack', 'check', 'app.maysa.co'], io)).code, 3);
    const r = await rbJson(root, ['attack', 'scope', '--words', 'Apruebo atacar app.maysa.co hasta el 20', '--targets', 'app.maysa.co', '--until', '2026-12-20'], io);
    assert.equal(r.code, 0, r.err);
    const ctl = Object.values(gh.state.issues).find((i) => i.labels.includes('rb:control'));
    assert.match(gh.state.comments[ctl.number].at(-1).body, /^<!-- rockbuilt:attack-scope targets=app\.maysa\.co until=2026-12-20 -->\nApruebo atacar/);
    assert.equal((await rbJson(root, ['attack', 'check', 'https://app.maysa.co/admin'], io)).code, 0);
    assert.equal((await rbJson(root, ['attack', 'check', 'api.stripe.com'], io)).code, 3);
    assert.equal((await rbJson(root, ['attack', 'scope', '--words', 'Apruebo atacar todo', '--targets', 'supabase.co'], io)).code, 2);
    assert.equal((await rbJson(root, ['attack', 'scope', '--words', 'ok'], io)).code, 2, 'targets required');
    assert.equal((await rbJson(root, ['attack', 'scope', 'revoke'], io)).code, 0);
    assert.equal((await rbJson(root, ['attack', 'check', 'app.maysa.co'], io)).code, 3);
  });
});

test('H5: rb state lists launch blockers first and reminds the launch without an attack report', async () => {
  const gh = fakeGh();
  gh.state.issues[4] = { number: 4, title: 'critical: any user can become Plus', body: '', state: 'open', labels: ['rb:bug', 'rb:attack', 'rb:launch-blocker'] };
  gh.state.issues[5] = { number: 5, title: 'T1', body: '', state: 'open', labels: ['rb:task'] };
  const root = project('Launch: 2026-12-10\n');
  await withEnv({ RB_NOW: '2026-11-25T10:00:00Z' }, async () => {
    const r = await rbJson(root, ['state'], { ghRunner: gh.runner });
    assert.deepEqual(r.json.launchBlockers.map((x) => x.number), [4]);
    assert.equal(r.json.launch.date, '2026-12-10');
    assert.equal(r.json.launch.attackReport, null);
    assert.equal(r.json.launch.daysLeft, 15);
    const text = await rb(root, ['state'], { ghRunner: gh.runner });
    assert.match(text.out.split('\n')[0], /LAUNCH BLOCKERS \(1\): #4/);
    assert.match(text.out, /no attack report yet: run \/rb-attack/);
  });
  const done = project('Launch: 2026-12-10\n', { 'docs/security/attack-2026-11-24.md': '# r\n' });
  const d = await rbJson(done, ['state'], { ghRunner: gh.runner });
  assert.equal(d.json.launch.attackReport, 'docs/security/attack-2026-11-24.md');
});

test('H: rb/attack-* PRs are human-only and touch only docs/security and AGENTS.md', async () => {
  assert.equal(prKind('rb/attack-2026-11-25'), 'human-only');
  const root = project();
  const seed = (files) => {
    const gh = fakeGh();
    const HEAD = 'a'.repeat(40);
    gh.state.issues[10] = { number: 10, title: 'docs: attack report', body: 'report', state: 'open', labels: [], isPr: true };
    gh.state.pulls[10] = { number: 10, head: 'rb/attack-2026-11-25', base: 'main', headSha: HEAD };
    gh.state.files[10] = files.map((f) => ({ filename: f, status: 'added', additions: 1, deletions: 0, patch: '@@\n+x' }));
    gh.state.checkRuns[HEAD] = [{ name: 'rockbuilt-ci', status: 'completed', conclusion: 'success', started_at: '2026-10-09T00:00:00Z' }];
    return gh;
  };
  const ok = seed(['docs/security/attack-2026-11-25.md', 'docs/security/probes/rls.sql', 'AGENTS.md']);
  const auto = await rbJson(root, ['merge-gate', '10', '--run', 'r1', '--dry-run'], { ghRunner: ok.runner });
  assert.ok(auto.json.reasons.some((r) => r.rule === 'human-only'), 'never unattended');
  const human = await rbJson(root, ['merge-gate', '10', '--human-approved', '--dry-run'], { ghRunner: ok.runner });
  assert.equal(human.code, 0, JSON.stringify(human.json.reasons));
  const code = seed(['docs/security/attack-2026-11-25.md', 'src/fix.js']);
  const r = await rbJson(root, ['merge-gate', '10', '--human-approved', '--dry-run'], { ghRunner: code.runner });
  assert.ok(r.json.reasons.some((x) => x.rule === 'kind-files'), JSON.stringify(r.json.reasons));
});
