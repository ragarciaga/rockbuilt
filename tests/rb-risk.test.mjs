import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { matchGlob } from '../scripts/lib/glob.mjs';
import { classify, packageDepChanges, parseUnifiedDiff } from '../scripts/lib/risk.mjs';
import { REPO, cleanup, commitAll, emptyState, fakeGh, rbJson, repoWith, sh, write } from './rb-helpers.mjs';

after(cleanup);

const PKG = JSON.stringify({ name: 'app', scripts: { test: 'node --test' }, dependencies: { express: '4.19.0' } }, null, 2);
const AGENTS = `# App

Docs language: es
Project type: web
Default branch: main
Autonomy: auto

## Autonomy
Sensitive paths: src/core/**, \`lib/money.ts\`
Tier A paths:
- fixtures/**
Paid services: OpenAI (USD 20/mes)
`;

// Repo on main with a base tree; changes are made on a branch rb/T1-x.
function base(extra = {}) {
  const root = repoWith({
    'AGENTS.md': AGENTS,
    'package.json': PKG,
    'src/app.js': "import express from 'express';\nconst url = 'https://api.known.com/v1';\nexport const app = express();\n",
    'src/old.js': `${'// line\n'.repeat(320)}`,
    'README.md': '# App\n',
    ...extra,
  });
  sh(root, 'git', ['checkout', '-q', '-b', 'rb/T1-x']);
  return root;
}

async function tierOf(root, files, { commit = true } = {}) {
  for (const [rel, text] of Object.entries(files)) {
    if (text === null) sh(root, 'git', ['rm', '-q', rel]);
    else write(root, rel, text);
  }
  if (commit) commitAll(root, 'change');
  const r = await rbJson(root, ['risk']);
  assert.equal(r.code, 0, r.err);
  return r.json;
}

const rules = (r) => r.reasons.map((x) => x.rule);

test('glob matcher: **, *, ?, anchored and basename patterns', () => {
  assert.ok(matchGlob('src/auth/login.ts', '**/auth/**'));
  assert.ok(matchGlob('auth/login.ts', '**/auth/**'));
  assert.ok(!matchGlob('src/author.ts', '**/auth/**'));
  assert.ok(matchGlob('middleware.ts', '**/middleware.*'));
  assert.ok(matchGlob('services/api/Dockerfile.prod', 'Dockerfile*'));
  assert.ok(matchGlob('.github/workflows/ci.yml', '.github/**'));
  assert.ok(!matchGlob('docs/.github/x', '.github/**'));
  assert.ok(matchGlob('src/a.test.ts', '**/*.test.*'));
  assert.ok(matchGlob('a1.md', 'a?.md'));
  assert.ok(!matchGlob('a12.md', 'a?.md'));
  assert.ok(matchGlob('.env.local', '.env*'));
  assert.ok(matchGlob('app/messages/es.json', '**/messages/**/*.json'));
});

test('tier A: only tests, docs, styles and project Tier A paths', async () => {
  const r = await tierOf(base(), { 'src/app.test.js': 'test\n', 'docs/guide.md': 'x\n', 'src/style.css': 'a{}\n', 'fixtures/a.json': '{}\n', 'NOTES.md': 'n\n' });
  assert.equal(r.tier, 'A', JSON.stringify(r.reasons));
});

test('tier B: production code and non-dependency package.json edits; lockfiles and scripts are C', async () => {
  let r = await tierOf(base(), { 'src/feature.js': 'export const f = 1;\n', 'src/app.test.js': 'test\n' });
  assert.equal(r.tier, 'B');
  assert.ok(r.reasons.some((x) => x.rule === 'tier-b' && x.path === 'src/feature.js'));
  r = await tierOf(base(), { 'package-lock.json': '{}\n' });
  assert.equal(r.tier, 'C', 'a lockfile can swap a resolved package');
  r = await tierOf(base(), { 'package.json': PKG.replace('node --test', 'exit 0') });
  assert.equal(r.tier, 'C', 'a changed test script can make CI green by construction');
  assert.match(r.reasons.find((x) => x.rule === 'dependency').detail, /\(scripts\)/);
  r = await tierOf(base(), { 'package.json': PKG.replace('"name": "app"', '"name": "app",\n  "description": "x"') });
  assert.equal(r.tier, 'B', JSON.stringify(r.reasons));
  r = await tierOf(base(), { 'package.json': PKG.replace('"name": "app"', '"name": "app",\n  "overrides": { "a": "9" }') });
  assert.equal(r.tier, 'C', 'overrides are dependencies');
  r = await tierOf(base(), { 'docs/specs/01-x/tasks.md': 'tasks\n' });
  assert.equal(r.tier, 'B', 'specs are not tier A');
});

test('floor: package.json dependency diff (added, bumped, devDependencies)', async () => {
  let r = await tierOf(base(), { 'package.json': PKG.replace('"express": "4.19.0"', '"express": "4.19.0",\n    "zod": "3.23.8"') });
  assert.equal(r.tier, 'C');
  assert.match(r.reasons.find((x) => x.rule === 'dependency').detail, /added zod@3\.23\.8 \(dependencies\)/);
  r = await tierOf(base(), { 'package.json': PKG.replace('4.19.0', '4.21.0') });
  assert.match(r.reasons.find((x) => x.rule === 'dependency').detail, /express 4\.19\.0 -> 4\.21\.0/);
  assert.deepEqual(packageDepChanges('{"devDependencies":{"a":"1"}}', '{}'), ['removed a (devDependencies)']);
  assert.deepEqual(packageDepChanges(null, '{"peerDependencies":{"react":"19"}}'), ['added react@19 (peerDependencies)']);
});

test('floor: python, rust and go manifests', async () => {
  for (const f of ['requirements-dev.txt', 'pyproject.toml', 'Cargo.toml', 'go.mod']) {
    const r = await tierOf(base(), { [f]: 'x\n' });
    assert.equal(r.tier, 'C', f);
    assert.ok(rules(r).includes('dependency'), f);
  }
});

test('floor: data and schema paths', async () => {
  for (const f of ['db/migrations/001.sql', 'prisma/schema.prisma', 'drizzle/0001.ts', 'supabase/seed.ts', 'src/q.sql']) {
    const r = await tierOf(base(), { [f]: 'x\n' });
    assert.equal(r.tier, 'C', f);
    assert.ok(rules(r).includes('data-schema'), f);
  }
});

test('floor: auth, permissions, payments, billing, stripe, policy, rls', async () => {
  for (const f of ['src/auth/session.js', 'middleware.ts', 'src/permissions/x.js', 'src/payments/a.js', 'app/billing/b.js', 'src/lib/stripe-client.js', 'src/privacy-policy.js', 'db/rls_users.js']) {
    const r = await tierOf(base(), { [f]: 'x\n' });
    assert.ok(rules(r).includes('auth-permissions-payments'), f);
  }
});

test('floor: infra, deploy and CI', async () => {
  for (const f of ['.github/workflows/ci.yml', 'vercel.json', 'netlify.toml', 'Dockerfile', 'docker-compose.yml', 'fly.toml', 'render.yaml', 'wrangler.toml', 'infra/main.tf']) {
    const r = await tierOf(base(), { [f]: 'x\n' });
    assert.ok(rules(r).includes('infra-deploy-ci'), f);
  }
});

test('floor: harness and secrets', async () => {
  for (const f of ['AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '.cursor/hooks.json', '.codex/hooks.json', '.agents/skills/x.md', 'tools/rockbuilt/rb.mjs', '.env.example', '.mcp.json']) {
    const r = await tierOf(base(), { [f]: 'x\n' });
    assert.ok(rules(r).includes('harness-secrets'), f);
  }
});

test('floor: architecture (ADR, design.md)', async () => {
  for (const f of ['docs/adr/0002-db.md', 'docs/specs/01-x/design.md']) {
    const r = await tierOf(base(), { [f]: 'x\n' });
    assert.ok(rules(r).includes('architecture'), f);
  }
});

test('floor: deletions (more than 10 files, or > 300 lines under src/)', async () => {
  const many = {};
  for (let i = 0; i < 11; i++) many[`notes/n${i}.md`] = 'x\n';
  const root = base(many);
  const del = Object.fromEntries(Object.keys(many).map((k) => [k, null]));
  let r = await tierOf(root, del);
  assert.ok(rules(r).includes('deletions'));
  r = await tierOf(base(), { 'src/old.js': null });
  assert.equal(r.tier, 'C');
  assert.match(r.reasons.find((x) => x.rule === 'deletions').detail, /320 lines deleted/);
});

test('floor: size above 800 changed lines', async () => {
  const r = await tierOf(base(), { 'src/big.js': 'x\n'.repeat(801) });
  assert.ok(rules(r).includes('size'));
});

test('floor: cost from a new paid SDK import, not from an approved or existing one', async () => {
  let r = await tierOf(base(), { 'src/mail.js': "import { Resend } from 'resend';\nexport const r = new Resend();\n" });
  assert.equal(r.tier, 'C');
  assert.match(r.reasons.find((x) => x.rule === 'cost').detail, /paid SDK resend/);
  r = await tierOf(base(), { 'src/ai.py': 'from anthropic import Anthropic\n' });
  assert.ok(rules(r).includes('cost'));
  r = await tierOf(base(), { 'src/ai.js': "const OpenAI = require('openai');\n" });
  assert.equal(r.tier, 'B', 'OpenAI is listed in Paid services');
  r = await tierOf(base({ 'src/pay2.js': "import twilio from 'twilio';\n" }), { 'src/sms.js': "import twilio from 'twilio';\n" });
  assert.equal(r.tier, 'B', 'already imported on the base branch');
  r = await tierOf(base(), { 'src/db.js': "import { createClient } from '@supabase/supabase-js';\n" });
  assert.equal(r.tier, 'B', 'supabase-js alone is not a paid SDK');
});

test('floor: cost from a new secret-like env var and a new external host', async () => {
  let r = await tierOf(base(), { 'src/cfg.js': 'export const k = process.env.MAPS_API_KEY;\nexport const p = process.env.PORT;\n' });
  assert.equal(r.tier, 'C');
  assert.match(r.reasons.find((x) => x.rule === 'cost').detail, /MAPS_API_KEY/);
  assert.equal(r.reasons.filter((x) => x.rule === 'cost').length, 1, 'PORT is not secret-like');
  r = await tierOf(base(), { 'src/cfg.py': "import os\nTOKEN = os.environ['GH_TOKEN']\n" });
  assert.ok(rules(r).includes('cost'));
  r = await tierOf(base(), { 'src/geo.js': "fetch('https://api.newvendor.io/v2/geo');\n" });
  assert.match(r.reasons.find((x) => x.rule === 'cost').detail, /new external host api\.newvendor\.io/);
  r = await tierOf(base(), { 'src/geo.js': "fetch('https://api.known.com/v1/x');\nfetch('http://localhost:3000');\n// see https://docs.vendor.com\n" });
  assert.equal(r.tier, 'B', 'known host, localhost and comments do not count');
  r = await tierOf(base(), { 'src/geo.test.js': "fetch('https://api.other.io');\n" });
  assert.equal(r.tier, 'C', 'tests run in CI with real secrets: hosts count there too');
  r = await tierOf(base(), { 'tests/pay.test.js': "import Stripe from 'stripe';\n" });
  assert.equal(r.tier, 'C', 'a paid SDK in a test is a cost');
  r = await tierOf(base(), { 'src/k.js': 'const { STRIPE_SECRET_KEY: k } = process.env;\n' });
  assert.match(r.reasons.find((x) => x.rule === 'cost').detail, /STRIPE_SECRET_KEY/, 'destructured env names count');
});

test('floor: the vendored harness and prose in the base never whitelist a paid SDK or host', async () => {
  const root = base();
  sh(root, 'git', ['checkout', '-q', 'main']);
  write(root, 'tools/rockbuilt/lib/risk.mjs', "export const PAID = ['openai', 'stripe'];\n");
  write(root, 'README.md', 'We may call https://api.paidvendor.io later.\n');
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-q', '-m', 'vendor']);
  sh(root, 'git', ['checkout', '-q', '-B', 'rb/T1-x', 'main']);
  const r = await tierOf(root, { 'src/pay.js': "import Stripe from 'stripe';\nfetch('https://api.paidvendor.io/x');\n" });
  assert.equal(r.tier, 'C');
  assert.ok(r.reasons.some((x) => /paid SDK stripe/.test(x.detail)));
  assert.ok(r.reasons.some((x) => /api\.paidvendor\.io/.test(x.detail)));
});

test('floor: ratchet list, spec requirements, brief, npmrc and gitleaks config', async () => {
  for (const f of ['docs/rockbuilt/known-failures.json', 'docs/specs/01-x/requirements.md', 'docs/brief.md', '.npmrc', '.gitleaks.toml', 'config/prod.env', '.husky/pre-commit']) {
    const r = await tierOf(base(), { [f]: 'x\n' });
    assert.equal(r.tier, 'C', f);
  }
});

test('project Sensitive paths force C; uncommitted and untracked changes count', async () => {
  let r = await tierOf(base(), { 'src/core/engine.js': 'x\n' });
  assert.ok(rules(r).includes('sensitive-path'));
  r = await tierOf(base(), { 'lib/money.ts': 'x\n' }, { commit: false });
  assert.equal(r.tier, 'C', 'untracked file is part of the diff');
  assert.ok(rules(r).includes('sensitive-path'));
});

test('rb risk --files: path rules only, manifests are conservative', async () => {
  const root = base();
  let r = await rbJson(root, ['risk', '--files', 'src/a.test.ts,docs/x.md']);
  assert.equal(r.json.tier, 'A');
  r = await rbJson(root, ['risk', '--files', 'src/a.ts']);
  assert.equal(r.json.tier, 'B');
  r = await rbJson(root, ['risk', '--files', 'package.json']);
  assert.equal(r.json.tier, 'C');
  r = await rbJson(root, ['risk', '--files', 'src/core/x.ts']);
  assert.equal(r.json.tier, 'C');
});

test('rb risk --pr: files and patches from the REST layer, package.json from contents', async () => {
  const root = base();
  sh(root, 'git', ['remote', 'add', 'origin', `git@github.com:${REPO}.git`]);
  const gh = fakeGh(emptyState());
  const s = gh.state;
  s.issues[5] = { number: 5, title: 'T1', body: '', state: 'open', labels: [], isPr: true };
  s.pulls[5] = { number: 5, head: 'rb/T1-x', base: 'main', baseSha: 'b'.repeat(40), headSha: 'h'.repeat(40) };
  s.files[5] = [
    { filename: 'src/x.js', status: 'modified', additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+import Stripe from 'stripe';" },
    { filename: 'package.json', status: 'modified', additions: 1, deletions: 1, patch: '@@' },
  ];
  s.contents[`${'b'.repeat(40)}:package.json`] = PKG;
  s.contents[`${'h'.repeat(40)}:package.json`] = PKG.replace('4.19.0', '5.0.0');
  const r = await rbJson(root, ['risk', '--pr', '5'], { ghRunner: gh.runner });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.tier, 'C');
  assert.ok(r.json.reasons.some((x) => x.rule === 'cost' && /stripe/.test(x.detail)));
  assert.ok(r.json.reasons.some((x) => x.rule === 'dependency' && /5\.0\.0/.test(x.detail)));
  assert.ok(gh.calls.every((c) => c.method === 'GET'));
});

test('classify and diff parser units', () => {
  const d = parseUnifiedDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -0,0 +1,2 @@\n+one\n+two\ndiff --git a/y b/y\n+++ /dev/null\n');
  assert.deepEqual(d.get('x'), ['one', 'two']);
  assert.equal(classify({ files: [] }).tier, 'A');
});

test('git mode: uncommitted bookkeeping edits (task claim, lessons) do not raise the tier', async () => {
  const root = base({ 'docs/specs/01-x/tasks.md': '- Status: todo\n', '.claude/LESSONS.md': '# Lessons\n' });
  write(root, 'tests/a.test.js', 'test\n');
  commitAll(root, 'tests only');
  write(root, 'docs/specs/01-x/tasks.md', '- Status: in-progress\n');
  write(root, '.claude/LESSONS.md', '# Lessons\n- new gotcha\n');
  write(root, 'docs/progress.md', 'progress\n');
  const r = await tierOf(root, {}, { commit: false });
  assert.equal(r.tier, 'A', JSON.stringify(r.reasons));
  write(root, '.claude/LESSONS.md', '# Lessons\n- committed by the task\n');
  commitAll(root, 'task touches lessons');
  assert.equal((await tierOf(root, {}, { commit: false })).tier, 'C', 'committed harness edits still count');
});

test('cost scan: hosts in config files count; namespaces and look-alike names do not', () => {
  const c = (p, l) => classify({ files: [{ path: p, status: 'added', additions: 1, deletions: 0, added: [l] }], baseHas: () => false }).tier;
  assert.equal(c('src/config/endpoints.json', '{"u": "https://api.openai.com/v1"}'), 'C');
  assert.equal(c('src/Icon.jsx', '<svg xmlns="http://www.w3.org/2000/svg">'), 'B');
  assert.equal(c('src/striped.css', '.a{}'), 'A');
  assert.equal(c('src/lib/stripe-client.ts', 'x'), 'C');
  assert.equal(c('locales/es/messages.json', '{"a": "https://help.site.io"}'), 'A');
});
