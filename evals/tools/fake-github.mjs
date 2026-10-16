#!/usr/bin/env node
// A GitHub simulator for evals of the autonomous parts (merge train, merge queue, bookkeeping,
// lock). Used as RB_GH_BIN: `rb` calls it exactly as it calls `gh api ...`. Issues, comments,
// labels and the rest come from the in-memory model the unit tests use (tests/rb-helpers.mjs,
// state in RB_GH_STATE); everything about commits is answered from the real bare repo the
// workspace pushes to (RB_FAKE_GIT): PR heads, compare, files, squash merges, update-branch,
// commit trees. With `autoCI: true` in the state, every commit gets a green `rockbuilt-ci` check
// run, as if GitHub Actions had passed.
//
// Env: RB_GH_STATE (JSON state file), RB_FAKE_GIT (bare repo path), RB_GH_REPO (owner/name),
// optional RB_GH_LOG (one JSON line per call).
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { handle } = await import(pathToFileURL(path.resolve(HERE, '..', '..', 'tests', 'rb-helpers.mjs')).href);

const BARE = process.env.RB_FAKE_GIT;
const REPO = process.env.RB_GH_REPO || 'acme/app';

function git(args, cwd = null) {
  const full = cwd ? ['-C', cwd, '-c', 'user.name=GitHub', '-c', 'user.email=noreply@github.com', ...args] : ['--git-dir', BARE, '-c', 'user.name=GitHub', '-c', 'user.email=noreply@github.com', ...args];
  const r = spawnSync('git', full, { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const sha = (ref) => { const r = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); return r.ok ? r.out : null; };
const ok = (body, status = 200) => ({ ok: true, stdout: body === undefined ? '' : JSON.stringify(body), stderr: '', http: status });
const err = (status, message) => ({ ok: false, stdout: JSON.stringify({ message, status: String(status) }), stderr: `gh: ${message} (HTTP ${status})` });

function files(base, head) {
  const r = git(['diff', '--name-status', '-M', `${base}...${head}`]);
  const out = [];
  for (const line of r.out.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const st = parts[0][0];
    const name = parts[parts.length - 1];
    const status = { A: 'added', M: 'modified', D: 'removed', R: 'renamed' }[st] || 'modified';
    const patch = git(['diff', `${base}...${head}`, '--', name]).out.split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l)).join('\n');
    const blob = status === 'removed' ? null : git(['rev-parse', `${head}:${name}`]).out;
    out.push({ filename: name, status, previous_filename: st === 'R' ? parts[1] : undefined, sha: blob, patch, changes: patch.split('\n').filter((l) => /^[+-]/.test(l)).length, additions: patch.split('\n').filter((l) => l.startsWith('+')).length, deletions: patch.split('\n').filter((l) => l.startsWith('-')).length });
  }
  return out;
}

function inWorktree(ref, fn) {
  const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'fake-gh-')), 'wt');
  const add = git(['worktree', 'add', '-q', dir, ref]);
  if (!add.ok) return { ok: false, err: add.err };
  try { return fn(dir); } finally { git(['worktree', 'remove', '--force', dir]); rmSync(path.dirname(dir), { recursive: true, force: true }); }
}

function refresh(s, p) {
  const head = sha(`refs/heads/${p.head}`);
  if (head) p.headSha = head;
  p.baseSha = sha(`refs/heads/${p.base}`) || p.baseSha;
}

function route(s, method, full, body) {
  const [p] = full.split('?');
  const q = new URLSearchParams(full.split('?')[1] || '');
  const pre = `repos/${REPO}/`;
  if (!p.startsWith(pre)) return null;
  const r = p.slice(pre.length);
  let m;
  if (r === 'pulls' && method === 'POST') {
    const head = sha(`refs/heads/${body.head}`);
    if (!head) return err(422, `No commits between ${body.base} and ${body.head}`);
    const res = handle(s, method, full, body);
    const n = JSON.parse(res.stdout).number;
    s.pulls[n].headSha = head;
    s.issues[n].created_at = new Date().toISOString();
    return handle(s, 'GET', `${pre}pulls/${n}`);
  }
  if (r === 'pulls' && method === 'GET') { for (const x of Object.values(s.pulls)) if (!x.merged_at) refresh(s, x); return null; }
  if ((m = r.match(/^pulls\/(\d+)$/)) && method === 'GET') { const x = s.pulls[m[1]]; if (x && !x.merged_at) refresh(s, x); return null; }
  if ((m = r.match(/^pulls\/(\d+)\/files$/))) {
    const x = s.pulls[m[1]];
    if (!x) return err(404, 'Not Found');
    refresh(s, x);
    const list = files(`refs/heads/${x.base}`, x.headSha);
    const per = Number(q.get('per_page') || 30); const pg = Number(q.get('page') || 1);
    return ok(list.slice((pg - 1) * per, pg * per));
  }
  if ((m = r.match(/^compare\/(.+)\.\.\.(.+)$/))) {
    const a = sha(decodeURIComponent(m[1])) || sha(`refs/heads/${decodeURIComponent(m[1])}`);
    const b = sha(decodeURIComponent(m[2])) || sha(`refs/heads/${decodeURIComponent(m[2])}`);
    if (!a || !b) return err(404, 'Not Found');
    const [behind, ahead] = git(['rev-list', '--left-right', '--count', `${a}...${b}`]).out.split(/\s+/).map(Number);
    return ok({ status: behind && ahead ? 'diverged' : behind ? 'behind' : ahead ? 'ahead' : 'identical', behind_by: behind, ahead_by: ahead, files: files(a, b) });
  }
  if ((m = r.match(/^pulls\/(\d+)\/merge$/)) && method === 'PUT') {
    const x = s.pulls[m[1]];
    refresh(s, x);
    if (body.sha && body.sha !== x.headSha) return err(409, 'Head branch was modified');
    const res = inWorktree(x.base, (dir) => {
      const mg = git(['merge', '--squash', x.headSha], dir);
      if (!mg.ok) return { ok: false, err: mg.err };
      const c = git(['commit', '-q', '-m', body.commit_title || `#${m[1]}`], dir);
      return c.ok ? { ok: true, sha: git(['rev-parse', 'HEAD'], dir).out } : { ok: false, err: c.err };
    });
    if (!res.ok) return err(405, `Pull Request is not mergeable: ${res.err}`);
    x.merged_at = new Date().toISOString();
    x.merge_commit_sha = res.sha;
    s.issues[m[1]].state = 'closed';
    s.merges.push({ pr: Number(m[1]), ...body, mergeSha: res.sha });
    return ok({ sha: res.sha, merged: true, message: 'Pull Request successfully merged' });
  }
  if ((m = r.match(/^pulls\/(\d+)\/update-branch$/)) && method === 'PUT') {
    const x = s.pulls[m[1]];
    const res = inWorktree(x.head, (dir) => git(['merge', '--no-edit', '-q', `refs/heads/${x.base}`], dir));
    if (!res.ok) return err(422, 'merge conflict');
    s.updates = [...(s.updates || []), Number(m[1])];
    return ok({ message: 'Updating pull request branch.' }, 202);
  }
  if ((m = r.match(/^commits\/([^/]+)$/)) && method === 'GET') {
    const ref = decodeURIComponent(m[1]);
    const c = sha(ref) || sha(`refs/heads/${ref}`);
    if (!c) return err(404, 'No commit found');
    const parents = git(['rev-list', '--parents', '-n', '1', c]).out.split(' ').slice(1);
    return ok({ sha: c, commit: { tree: { sha: git(['rev-parse', `${c}^{tree}`]).out } }, parents: parents.map((x) => ({ sha: x })) });
  }
  if ((m = r.match(/^commits\/([^/]+)\/check-runs$/)) && s.autoCI) {
    const c = sha(decodeURIComponent(m[1]));
    const runs = c ? [{ name: 'rockbuilt-ci', status: 'completed', conclusion: 'success', app: { slug: 'github-actions' }, started_at: new Date().toISOString(), completed_at: new Date().toISOString() }] : [];
    return ok({ total_count: runs.length, check_runs: runs });
  }
  if ((m = r.match(/^git\/refs\/heads\/(.+)$/)) && method === 'DELETE') {
    const d = git(['update-ref', '-d', `refs/heads/${decodeURIComponent(m[1])}`]);
    return d.ok ? ok(undefined, 204) : err(422, 'Reference does not exist');
  }
  if ((m = r.match(/^contents\/(.+)$/)) && method === 'GET') {
    const ref = q.get('ref') || 'HEAD';
    const f = decodeURIComponent(m[1]);
    const blob = git(['rev-parse', `${ref}:${f}`]);
    if (!blob.ok) return err(404, 'Not Found');
    const text = git(['show', `${ref}:${f}`]).out;
    return ok({ type: 'file', encoding: 'base64', sha: blob.out, content: Buffer.from(text).toString('base64') });
  }
  return null;
}

const args = process.argv.slice(2);
if (args[0] !== 'api') { process.stderr.write('only gh api is supported'); process.exit(1); }
const input = args.includes('--input') ? readFileSync(0, 'utf8') : '';
const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
const state = JSON.parse(readFileSync(process.env.RB_GH_STATE, 'utf8'));
const body = input ? JSON.parse(input) : undefined;
const res = (BARE && route(state, method, args[1], body)) || handle(state, method, args[1], body);
writeFileSync(process.env.RB_GH_STATE, JSON.stringify(state));
if (process.env.RB_GH_LOG) appendFileSync(process.env.RB_GH_LOG, `${JSON.stringify({ method, path: args[1], ok: res.ok })}\n`);
process.stdout.write(res.stdout);
if (!res.ok) { process.stderr.write(res.stderr); process.exit(1); }
