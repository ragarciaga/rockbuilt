// Shared helpers for the rb CLI tests: temp git repos, an in-process rb runner, and a fake GitHub
// REST backend that answers `gh api` argument lists (in-process runner or RB_GH_BIN script).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main } from '../scripts/rb.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
const temps = [];

export function cleanup() {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
}

export function tmp(prefix = 'rb-test-') {
  const d = mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(d);
  return d;
}

export function track(dir) {
  temps.push(dir);
}

export function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

export function write(root, rel, text) {
  const f = path.join(root, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, text);
}

export function read(root, rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}

export function gitInit(root) {
  sh(root, 'git', ['init', '-q', '-b', 'main']);
  sh(root, 'git', ['config', 'user.email', 't@example.com']);
  sh(root, 'git', ['config', 'user.name', 'Test']);
  sh(root, 'git', ['config', 'commit.gpgsign', 'false']);
}

export function commitAll(root, msg = 'commit') {
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-q', '-m', msg]);
  return sh(root, 'git', ['rev-parse', 'HEAD']);
}

// A repo with the given files committed on main.
export function repoWith(files = {}) {
  const root = tmp();
  gitInit(root);
  for (const [rel, text] of Object.entries({ '.gitignore': 'node_modules/\n', ...files })) write(root, rel, text);
  commitAll(root, 'init');
  return root;
}

export async function rb(cwd, argv, io = {}) {
  const out = [];
  const err = [];
  const code = await main(argv, { cwd, out: (s) => out.push(s), err: (s) => err.push(s), ...io });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

export async function rbJson(cwd, argv, io = {}) {
  const r = await rb(cwd, [...argv, '--json'], io);
  return { ...r, json: JSON.parse(r.out) };
}

export async function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ---------- fake GitHub ----------

export const REPO = 'acme/app';

export function emptyState() {
  return {
    user: 'rb-bot', nextNumber: 1, nextComment: 1, issues: {}, comments: {}, labels: {}, pulls: {}, files: {},
    checkRuns: {}, statuses: {}, contents: {}, protection: { mode: 'none' }, merges: [],
  };
}

const ok = (body, status = 200) => ({ ok: true, status: 0, stdout: body === undefined ? '' : JSON.stringify(body), stderr: '', http: status });
const err = (status, message) => ({ ok: false, status: 1, stdout: JSON.stringify({ message, status: String(status) }), stderr: `gh: ${message} (HTTP ${status})` });

function issueOut(s, i) {
  return { comments: (s.comments[i.number] || []).length, ...i, labels: i.labels.map((name) => ({ name })), user: { login: i.author || s.user }, html_url: `https://github.com/${REPO}/issues/${i.number}` };
}

function pullOut(s, p) {
  const i = s.issues[p.number];
  return {
    number: p.number, title: i.title, body: i.body, state: i.state, draft: Boolean(p.draft), merged: Boolean(p.merged_at), merged_at: p.merged_at || null, created_at: i.created_at || null,
    merge_commit_sha: p.merge_commit_sha || null, mergeable: p.mergeable === undefined ? true : p.mergeable, mergeable_state: p.mergeable_state || 'clean',
    base: { ref: p.base, sha: p.baseSha || 'b'.repeat(40) }, head: { ref: p.head, sha: p.headSha }, labels: i.labels.map((name) => ({ name })),
    user: { login: i.author || s.user }, author_association: 'OWNER', html_url: `https://github.com/${REPO}/pull/${p.number}`,
  };
}

function page(list, q) {
  const per = Number(q.get('per_page') || 30);
  const n = Number(q.get('page') || 1);
  return list.slice((n - 1) * per, n * per);
}

// Pure request handler: (state, method, path, body) -> response. Mutates state.
export function handle(s, method, fullPath, body) {
  const [p, qs = ''] = fullPath.split('?');
  const q = new URLSearchParams(qs);
  const pre = `repos/${REPO}/`;
  if (p === 'user' && method === 'GET') return ok({ login: s.user, name: 'Bot' });
  if (p === `repos/${REPO}` && method === 'GET') return ok({ full_name: REPO, private: !s.public, default_branch: 'main', delete_branch_on_merge: Boolean(s.deleteBranchOnMerge) });
  if (!p.startsWith(pre)) return err(404, 'Not Found');
  const r = p.slice(pre.length);
  let m;
  if (r === 'issues' && method === 'GET') {
    const labels = q.get('labels') ? q.get('labels').split(',') : [];
    const state = q.get('state') || 'open';
    const list = Object.values(s.issues).filter((i) => (state === 'all' || i.state === state) && labels.every((l) => i.labels.includes(l))).sort((a, b) => b.number - a.number);
    return ok(page(list, q).map((i) => ({ ...issueOut(s, i), ...(i.isPr ? { pull_request: {} } : {}) })));
  }
  if (r === 'issues' && method === 'POST') {
    const n = s.nextNumber++;
    s.issues[n] = { number: n, title: body.title, body: body.body || '', state: 'open', labels: [...(body.labels || [])], author: s.user, author_association: 'OWNER', created_at: new Date().toISOString() };
    return ok(issueOut(s, s.issues[n]), 201);
  }
  if ((m = r.match(/^issues\/(\d+)$/))) {
    const i = s.issues[m[1]];
    if (!i) return err(404, 'Not Found');
    if (method === 'PATCH') Object.assign(i, body);
    return ok(issueOut(s, i));
  }
  if ((m = r.match(/^issues\/(\d+)\/comments$/))) {
    if (!s.issues[m[1]]) return err(404, 'Not Found');
    s.comments[m[1]] = s.comments[m[1]] || [];
    if (method === 'POST') {
      const c = { id: s.nextComment++, body: body.body, user: { login: s.user }, author_association: 'OWNER', created_at: new Date().toISOString() };
      s.comments[m[1]].push(c);
      return ok(c, 201);
    }
    return ok(page(s.comments[m[1]], q));
  }
  if (r === 'issues/comments' && method === 'GET') {
    const since = q.get('since');
    const list = Object.entries(s.comments).flatMap(([n, cs]) => cs.map((c) => ({ ...c, issue_url: `https://api.github.com/repos/${REPO}/issues/${n}` })))
      .filter((c) => !since || String(c.created_at) >= since).sort((a, b) => a.id - b.id);
    return ok(page(list, q));
  }
  if (r === 'pulls/comments' && method === 'GET') return ok(page(s.reviewComments || [], q));
  if ((m = r.match(/^issues\/comments\/(\d+)$/)) && method === 'PATCH') {
    const c = Object.values(s.comments).flat().find((x) => x.id === Number(m[1]));
    if (!c) return err(404, 'Not Found');
    c.body = body.body;
    s.edits = (s.edits || 0) + 1;
    return ok(c);
  }
  if ((m = r.match(/^issues\/(\d+)\/labels$/)) && method === 'POST') {
    const i = s.issues[m[1]];
    s.events = s.events || {};
    s.events[m[1]] = s.events[m[1]] || [];
    for (const l of body.labels) {
      if (!i.labels.includes(l)) i.labels.push(l);
      s.events[m[1]].push({ event: 'labeled', label: { name: l }, created_at: (process.env.RB_NOW ? new Date(process.env.RB_NOW) : new Date()).toISOString() });
    }
    return ok(i.labels.map((name) => ({ name })));
  }
  if ((m = r.match(/^issues\/(\d+)\/labels\/(.+)$/)) && method === 'DELETE') {
    const i = s.issues[m[1]];
    const name = decodeURIComponent(m[2]);
    if (!i.labels.includes(name)) return err(404, 'Label does not exist');
    i.labels = i.labels.filter((l) => l !== name);
    return ok(i.labels.map((n) => ({ name: n })));
  }
  if ((m = r.match(/^issues\/(\d+)\/events$/)) && method === 'GET') return ok(page((s.events || {})[m[1]] || [], q));
  if (r === 'labels' && method === 'GET') return ok(page(Object.values(s.labels), q));
  if (r === 'labels' && method === 'POST') { s.labels[body.name] = body; return ok(body, 201); }
  if ((m = r.match(/^labels\/(.+)$/)) && method === 'PATCH') { Object.assign(s.labels[decodeURIComponent(m[1])], body); return ok(s.labels[decodeURIComponent(m[1])]); }
  if (r === 'pulls' && method === 'GET') {
    const state = q.get('state') || 'open';
    const list = Object.values(s.pulls).filter((pp) => state === 'all' || s.issues[pp.number].state === state).sort((a, b) => b.number - a.number);
    return ok(page(list, q).map((pp) => pullOut(s, pp)));
  }
  if (r === 'pulls' && method === 'POST') {
    const n = s.nextNumber++;
    s.issues[n] = { number: n, title: body.title, body: body.body || '', state: 'open', labels: [], isPr: true, author: s.user };
    s.pulls[n] = { number: n, head: body.head, base: body.base, headSha: 'f'.repeat(40), draft: body.draft };
    return ok(pullOut(s, s.pulls[n]), 201);
  }
  if ((m = r.match(/^pulls\/(\d+)$/))) {
    const pp = s.pulls[m[1]];
    return pp ? ok(pullOut(s, pp)) : err(404, 'Not Found');
  }
  if ((m = r.match(/^pulls\/(\d+)\/files$/))) return ok(page(s.files[m[1]] || [], q));
  if ((m = r.match(/^pulls\/(\d+)\/merge$/)) && method === 'PUT') {
    const pp = s.pulls[m[1]];
    if (s.mergeError) return err(s.mergeError.status, s.mergeError.message);
    if (body.sha && body.sha !== pp.headSha) return err(409, 'Head branch was modified');
    pp.merged_at = new Date().toISOString();
    pp.merge_commit_sha = 'c'.repeat(40);
    s.issues[m[1]].state = 'closed';
    s.merges.push({ pr: Number(m[1]), ...body });
    return ok({ sha: pp.merge_commit_sha, merged: true, message: 'Pull Request successfully merged' });
  }
  if ((m = r.match(/^pulls\/(\d+)\/update-branch$/)) && method === 'PUT') return ok({ message: 'Updating pull request branch.' }, 202);
  if ((m = r.match(/^compare\/([^.]+)\.\.\.(.+)$/))) {
    const head = decodeURIComponent(m[2]);
    return ok({ status: 'ahead', files: (s.compareFiles || {})[head] || [], ...((s.compare || {})[head] || { behind_by: 0, ahead_by: 1 }) });
  }
  if (r === 'actions/runs' && method === 'GET') {
    const runs = (s.workflowRuns || []).filter((x) => x.head_sha === q.get('head_sha') && (!q.get('event') || x.event === q.get('event')));
    return ok({ total_count: runs.length, workflow_runs: runs });
  }
  if ((m = r.match(/^commits\/([^/]+)$/)) && method === 'GET') {
    const info = (s.commitInfo || {})[decodeURIComponent(m[1])];
    return info ? ok({ sha: info.sha, commit: { tree: { sha: info.tree } }, parents: (info.parents || []).map((sha) => ({ sha })) }) : err(404, 'No commit found');
  }
  if ((m = r.match(/^git\/refs\/heads\/(.+)$/)) && method === 'DELETE') { s.deletedRefs = [...(s.deletedRefs || []), decodeURIComponent(m[1])]; return ok(undefined, 204); }
  if ((m = r.match(/^commits\/([^/]+)\/check-runs$/))) {
    const runs = (s.checkRuns[m[1]] || []).map((x) => ({ app: { slug: 'github-actions' }, ...x }));
    return ok({ total_count: runs.length, check_runs: page(runs, q) });
  }
  if ((m = r.match(/^commits\/([^/]+)\/status$/))) return ok({ state: 'success', statuses: s.statuses[m[1]] || [] });
  if ((m = r.match(/^branches\/([^/]+)\/protection$/))) {
    if (s.protection.mode === 'paywall') return err(403, 'Upgrade to GitHub Pro or make this repository public to enable this feature.');
    if (method === 'PUT') { s.protection = { mode: 'on', contexts: body.required_status_checks.contexts }; return ok({}); }
    if (s.protection.mode === 'on') return ok({ required_status_checks: { contexts: s.protection.contexts } });
    return err(404, 'Branch not protected');
  }
  if ((m = r.match(/^contents\/(.+)$/))) {
    const key = `${q.get('ref')}:${decodeURIComponent(m[1])}`;
    if (!(key in s.contents)) return err(404, 'Not Found');
    return ok({ type: 'file', encoding: 'base64', sha: `blob-${Buffer.from(String(s.contents[key])).toString('hex').slice(0, 16)}`, content: Buffer.from(s.contents[key]).toString('base64') });
  }
  return err(404, `Not Found: ${method} ${r}`);
}

// In-process runner over a state object; records every call.
export function fakeGh(state = emptyState()) {
  const calls = [];
  const runner = (args, input) => {
    assert.equal(args[0], 'api', `only gh api is allowed, got gh ${args.join(' ')}`);
    assert.ok(!args.includes('graphql'), 'GraphQL is never used');
    const method = args[args.indexOf('--method') + 1] || 'GET';
    const body = input ? JSON.parse(input) : undefined;
    calls.push({ method, path: args[1], body });
    return handle(state, method, args[1], body);
  };
  return { state, calls, runner };
}

// Script for RB_GH_BIN: loads state from RB_GH_STATE, answers, saves state, logs to RB_GH_LOG.
export function fakeGhScript(dir) {
  const file = path.join(dir, 'fake-gh.mjs');
  const helpers = pathToFileURL(path.join(HERE, 'rb-helpers.mjs')).href;
  writeFileSync(file, `import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const { handle } = await import(${JSON.stringify(helpers)});
const args = process.argv.slice(2);
const input = args.includes('--input') ? readFileSync(0, 'utf8') : '';
const state = JSON.parse(readFileSync(process.env.RB_GH_STATE, 'utf8'));
const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
if (process.env.RB_GH_LOG) appendFileSync(process.env.RB_GH_LOG, JSON.stringify({ args, input }) + '\\n');
if (args[0] !== 'api') { process.stderr.write('only gh api is supported'); process.exit(1); }
const r = handle(state, method, args[1], input ? JSON.parse(input) : undefined);
writeFileSync(process.env.RB_GH_STATE, JSON.stringify(state));
process.stdout.write(r.stdout);
if (!r.ok) { process.stderr.write(r.stderr); process.exit(1); }
`);
  return file;
}
