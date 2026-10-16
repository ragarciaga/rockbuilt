// GitHub layer (DESIGN.md sections 7 and 21): REST only, through `gh api` with a JSON body on stdin.
// Never GraphQL, never `gh issue|pr|label`. The runner is injectable for tests (RB_GH_BIN or a function).
import path from 'node:path';
import { originSlug } from './repo.mjs';
import { CliError, readText, run, sleepMs } from './util.mjs';

export const LABELS = [
  { name: 'rb:task', color: '1d76db', description: 'Rockbuilt task from a spec' },
  { name: 'rb:skeleton', color: '5319e7', description: 'Walking skeleton task' },
  { name: 'rb:bug', color: 'd73a4a', description: 'Bug handled by the fix path' },
  { name: 'rb:blocked', color: 'b60205', description: 'Failed after the kickback budget or cannot proceed' },
  { name: 'rb:in-progress', color: 'fbca04', description: 'Being planned or implemented' },
  { name: 'rb:pr-open', color: '0e8a16', description: 'Pull request open' },
  { name: 'rb:tier-a', color: 'c2e0c6', description: 'Risk tier A: tests, docs, styles; automatic merge' },
  { name: 'rb:tier-b', color: 'fef2c0', description: 'Risk tier B: production code; automatic merge after audit' },
  { name: 'rb:tier-c', color: 'f9d0c4', description: 'Risk tier C: human approval and human merge' },
  { name: 'rb:needs-human', color: 'e99695', description: 'Waiting for a human decision' },
  { name: 'rb:needs-local', color: 'd4c5f9', description: 'Needs a step on the user machine' },
  { name: 'rb:approved', color: '0e8a16', description: 'Human approved the plan as posted' },
  { name: 'rb:hold', color: 'bfdadc', description: 'Do not merge or pick up' },
  { name: 'rb:stop', color: '000000', description: 'Stop switch: unattended runs halt' },
  { name: 'rb:running', color: '006b75', description: 'Run lock held on the control issue' },
  { name: 'rb:control', color: '5319e7', description: 'Rockbuilt control issue (lock, digests)' },
];

export class GhError extends CliError {
  constructor(message, status) {
    super(status ? `${message} (HTTP ${status})` : message, 1);
    this.status = status || null;
  }
}

// Default runner: spawns gh (or RB_GH_BIN; .js/.mjs/.cjs files run through node).
export function defaultRunner(cwd) {
  const bin = process.env.RB_GH_BIN || 'gh';
  const viaNode = /\.(c|m)?js$/i.test(bin);
  return (args, input) => {
    const r = viaNode
      ? run(process.execPath, [bin, ...args], { cwd, input, timeout: 60000 })
      : run(bin, args, { cwd, input, timeout: 60000 });
    return r;
  };
}

function parseJson(text) {
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function query(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

// Client bound to one repo. `repo` is resolved lazily (flag, then origin remote).
export function makeGh({ cwd = process.cwd(), repo = null, runner = null } = {}) {
  const exec = runner || defaultRunner(cwd);
  let slug = repo;
  const client = {
    get repo() {
      if (!slug) slug = originSlug(cwd);
      if (!slug) throw new CliError('no GitHub repo: pass --repo owner/name or add a GitHub origin remote');
      return slug;
    },
    exec,
    api(method, apiPath, { body, params } = {}) {
      const p = apiPath.replace('{repo}', () => `repos/${client.repo}`) + query(params);
      const args = ['api', p, '--method', method];
      let input;
      if (body !== undefined) { args.push('--input', '-'); input = JSON.stringify(body); }
      let r = exec(args, input);
      // One bounded retry for reads on a transient failure (5xx, 429, no status): a 502 must not
      // end a nightly run. Writes are never retried (they may have landed).
      if (!r.ok && method === 'GET' && !r.missing) {
        const st = Number((`${r.stderr} ${r.stdout}`.match(/HTTP (\d{3})/) || [])[1]) || null;
        if (st === null || st >= 500 || st === 429) {
          sleepMs(Number(process.env.RB_GH_RETRY_MS ?? 10000));
          r = exec(args, input);
        }
      }
      if (!r.ok) {
        const out = parseJson(r.stdout);
        const status = Number((`${r.stderr} ${r.stdout}`.match(/HTTP (\d{3})/) || [])[1]) || (out && Number(out.status)) || null;
        const msg = (out && typeof out === 'object' && out.message) || (r.stderr || r.stdout || 'gh api failed').split(/\r?\n/)[0];
        if (r.missing) throw new GhError('gh is not installed; install GitHub CLI and run `gh auth login`');
        throw new GhError(`${method} ${p}: ${msg}`, status);
      }
      return parseJson(r.stdout);
    },
    // Follows page numbers until a short page (per_page 100, at most `maxPages` pages).
    paged(apiPath, params = {}, pick = (x) => x, maxPages = 20) {
      const all = [];
      for (let page = 1; page <= maxPages; page++) {
        const data = client.api('GET', apiPath, { params: { ...params, per_page: 100, page } });
        const items = pick(data) || [];
        all.push(...items);
        if (items.length < 100) break;
      }
      return all;
    },
  };
  return client;
}

// ---------- shapes ----------

const labelNames = (labels) => (labels || []).map((l) => (typeof l === 'string' ? l : l.name));

export function shapeIssue(i) {
  return {
    number: i.number,
    title: i.title,
    body: i.body || '',
    state: i.state,
    labels: labelNames(i.labels),
    author: i.user ? i.user.login : null,
    author_association: i.author_association || null,
    created_at: i.created_at || null,
    updated_at: i.updated_at || null,
    closed_at: i.closed_at || null,
    url: i.html_url || null,
    comment_count: typeof i.comments === 'number' ? i.comments : null,
  };
}

export function shapeComment(c) {
  return {
    id: c.id,
    body: c.body || '',
    author: c.user ? c.user.login : null,
    author_association: c.author_association || null,
    created_at: c.created_at || null,
  };
}

export function shapePr(p) {
  return {
    number: p.number,
    title: p.title,
    body: p.body || '',
    state: p.state,
    draft: Boolean(p.draft),
    merged: Boolean(p.merged || p.merged_at),
    merged_at: p.merged_at || null,
    created_at: p.created_at || null,
    merge_commit_sha: p.merge_commit_sha || null,
    mergeable: p.mergeable === undefined ? null : p.mergeable,
    mergeable_state: p.mergeable_state || null,
    base: p.base ? { ref: p.base.ref, sha: p.base.sha } : null,
    head: p.head ? { ref: p.head.ref, sha: p.head.sha } : null,
    labels: labelNames(p.labels),
    author: p.user ? p.user.login : null,
    author_association: p.author_association || null,
    url: p.html_url || null,
  };
}

// ---------- operations ----------

export const ops = {
  whoami(c) {
    const u = c.api('GET', 'user');
    return { login: u.login, name: u.name || null };
  },
  issueCreate(c, { title, body = '', labels = [] }) {
    if (!title) throw new CliError('--title is required', 2);
    const i = c.api('POST', '{repo}/issues', { body: { title, body, labels } });
    return shapeIssue(i);
  },
  issueEdit(c, n, { title, body, state } = {}) {
    const patch = {};
    if (title !== undefined) patch.title = title;
    if (body !== undefined) patch.body = body;
    if (state !== undefined) {
      if (!['open', 'closed'].includes(state)) throw new CliError('--state must be open or closed', 2);
      patch.state = state;
    }
    return shapeIssue(c.api('PATCH', `{repo}/issues/${num(n)}`, { body: patch }));
  },
  // Every comment the harness writes carries a rockbuilt marker, so a trusted comment without one is
  // always a human answer (DESIGN 9) and never the harness talking to itself.
  issueComment(c, n, body) {
    const text = /<!--\s*rockbuilt:/.test(String(body)) ? String(body) : `<!-- rockbuilt:note -->\n${body}`;
    return shapeComment(c.api('POST', `{repo}/issues/${num(n)}/comments`, { body: { body: text } }));
  },
  issueComments(c, n) {
    return c.paged(`{repo}/issues/${num(n)}/comments`).map(shapeComment);
  },
  // Edits a comment in place (no notification). Used for the per-session attention comment.
  commentEdit(c, id, body) {
    return shapeComment(c.api('PATCH', `{repo}/issues/comments/${num(id)}`, { body: { body } }));
  },
  // Every issue and PR comment in the repo (or review comments with review=true), with the issue
  // or PR number it belongs to.
  repoComments(c, { since = null, review = false } = {}) {
    const p = review ? '{repo}/pulls/comments' : '{repo}/issues/comments';
    // A busy repo (lock, unlock and digest comments every night) passes 2000 comments quickly.
    return c.paged(p, since ? { since } : {}, (x) => x, 200).map((x) => {
      const url = String(x.issue_url || x.pull_request_url || '');
      const n = Number((url.match(/\/(\d+)$/) || [])[1]) || null;
      return { ...shapeComment(x), number: n };
    });
  },
  // owner/name of the repos where `login` opened a "<title>" issue (REST search).
  reposWithIssueTitled(c, login, title) {
    const q = `in:title "${title}" author:${login} is:issue`;
    const d = c.api('GET', 'search/issues', { params: { q, per_page: 100 } }) || {};
    const repos = (d.items || [])
      .filter((i) => i.title === title)
      .map((i) => String(i.repository_url || '').replace(/^.*\/repos\//, ''))
      .filter(Boolean);
    return [...new Set(repos)].sort();
  },
  issueView(c, n) {
    const i = shapeIssue(c.api('GET', `{repo}/issues/${num(n)}`));
    return { ...i, comments: ops.issueComments(c, n) };
  },
  // Label events of an issue, oldest first: { event, label, created_at }.
  issueEvents(c, n) {
    return c.paged(`{repo}/issues/${num(n)}/events`).map((e) => ({ event: e.event, label: e.label ? e.label.name : null, created_at: e.created_at || null }));
  },
  issueList(c, { labels = [], state = 'open', maxPages = 20 } = {}) {
    const params = { state };
    if (labels.length) params.labels = labels.join(',');
    return c.paged('{repo}/issues', params, (x) => x, maxPages).filter((i) => !i.pull_request).map(shapeIssue);
  },
  labelAdd(c, n, labels) {
    if (!labels.length) throw new CliError('no labels given', 2);
    return { number: num(n), labels: labelNames(c.api('POST', `{repo}/issues/${num(n)}/labels`, { body: { labels } })) };
  },
  labelRemove(c, n, label) {
    try {
      c.api('DELETE', `{repo}/issues/${num(n)}/labels/${encodeURIComponent(label)}`);
      return { number: num(n), removed: label };
    } catch (e) {
      if (e instanceof GhError && e.status === 404) return { number: num(n), removed: null, absent: label };
      throw e;
    }
  },
  labelsEnsure(c) {
    const existing = new Map(c.paged('{repo}/labels').map((l) => [l.name, l]));
    const results = [];
    for (const l of LABELS) {
      const have = existing.get(l.name);
      if (!have) {
        c.api('POST', '{repo}/labels', { body: l });
        results.push({ name: l.name, action: 'created' });
      } else if (have.color !== l.color || (have.description || '') !== l.description) {
        c.api('PATCH', `{repo}/labels/${encodeURIComponent(l.name)}`, { body: { color: l.color, description: l.description } });
        results.push({ name: l.name, action: 'updated' });
      } else {
        results.push({ name: l.name, action: 'ok' });
      }
    }
    return results;
  },
  missingLabels(c) {
    const names = new Set(c.paged('{repo}/labels').map((l) => l.name));
    return LABELS.map((l) => l.name).filter((n) => !names.has(n));
  },
  prCreate(c, { head, base, title, body = '', labels = [], draft = false }) {
    if (!head || !base || !title) throw new CliError('--head, --base and --title are required', 2);
    const p = shapePr(c.api('POST', '{repo}/pulls', { body: { head, base, title, body, draft: Boolean(draft) } }));
    if (labels.length) p.labels = ops.labelAdd(c, p.number, labels).labels;
    return p;
  },
  // How far a head is behind and ahead of a base (GitHub compare). Branch protection is what makes
  // GitHub report mergeable_state "behind"; without it the state says "clean" or "unstable".
  compare(c, base, head) {
    const d = c.api('GET', `{repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
    return { behindBy: Number(d && d.behind_by) || 0, aheadBy: Number(d && d.ahead_by) || 0, status: d && d.status };
  },
  // Files changed in base...head with their patches (index lines are not part of GitHub patches).
  // The compare API lists at most 300 files; treat that many as truncated.
  compareFiles(c, base, head) {
    const d = c.api('GET', `{repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`) || {};
    const files = (d.files || []).map((f) => ({ filename: f.filename, status: f.status, previous: f.previous_filename || null, sha: f.sha || null, patch: typeof f.patch === 'string' ? f.patch : null, changes: Number(f.changes) || 0 }));
    return { files, truncated: files.length >= 300 };
  },
  // Blob sha of a file at a ref, or null when the path does not exist there.
  blobSha(c, filePath, ref) {
    try {
      const f = c.api('GET', `{repo}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`, { params: { ref } });
      if (!f || Array.isArray(f) || f.type !== 'file' || !f.sha) throw new CliError(`${filePath} at ${ref} is not a file`);
      return f.sha;
    } catch (e) {
      if (e instanceof GhError && e.status === 404) return null;
      throw e;
    }
  },
  repoInfo(c) {
    const d = c.api('GET', '{repo}') || {};
    return { deleteBranchOnMerge: d.delete_branch_on_merge === true, private: d.private === true, defaultBranch: d.default_branch || null };
  },
  prView(c, n) {
    return shapePr(c.api('GET', `{repo}/pulls/${num(n)}`));
  },
  prList(c, { state = 'open', headPrefix = null, maxPages = 20 } = {}) {
    const all = c.paged('{repo}/pulls', { state }, (x) => x, maxPages).map(shapePr);
    return headPrefix ? all.filter((p) => p.head && p.head.ref.startsWith(headPrefix)) : all;
  },
  prFiles(c, n) {
    return c.paged(`{repo}/pulls/${num(n)}/files`).map((f) => ({
      path: f.filename,
      status: f.status,
      previous_path: f.previous_filename || null,
      additions: f.additions || 0,
      deletions: f.deletions || 0,
      patch: f.patch || null,
    }));
  },
  prUpdateBranch(c, n, expectedHeadSha) {
    const body = expectedHeadSha ? { expected_head_sha: expectedHeadSha } : {};
    const r = c.api('PUT', `{repo}/pulls/${num(n)}/update-branch`, { body });
    return { number: num(n), message: r && r.message ? r.message : 'updated' };
  },
  // check-runs plus the combined commit status, as [{ name, status, conclusion, source }].
  checks(c, sha) {
    if (!sha) throw new CliError('usage: rb gh checks <sha>', 2);
    const runs = c.paged(`{repo}/commits/${sha}/check-runs`, {}, (d) => (d && d.check_runs) || []);
    const latest = new Map();
    for (const r of runs) {
      const prev = latest.get(r.name);
      if (!prev || String(r.started_at || '') > String(prev.started_at || '')) latest.set(r.name, r);
    }
    const out = [...latest.values()].map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion || null, source: 'check-run', app: (r.app && r.app.slug) || null }));
    const combined = c.api('GET', `{repo}/commits/${sha}/status`, { params: { per_page: 100 } }) || {};
    for (const s of combined.statuses || []) {
      const pending = s.state === 'pending';
      out.push({
        name: s.context,
        status: pending ? 'in_progress' : 'completed',
        conclusion: pending ? null : s.state === 'success' ? 'success' : 'failure',
        source: 'status',
      });
    }
    return out;
  },
  // Branch protection read: { available, protected, mode, requiredChecks, detail }.
  protection(c, branch) {
    try {
      const p = c.api('GET', `{repo}/branches/${encodeURIComponent(branch)}/protection`);
      const checks = (p && p.required_status_checks && (p.required_status_checks.contexts || [])) || [];
      const hasCi = checks.includes('rockbuilt-ci');
      return { branch, available: true, protected: true, requiredChecks: checks, mode: hasCi ? 'github' : 'rb-only', detail: hasCi ? 'rockbuilt-ci is a required check' : 'protected, but rockbuilt-ci is not required; run rb protect' };
    } catch (e) {
      if (!(e instanceof GhError)) throw e;
      if (e.status === 404) return { branch, available: true, protected: false, requiredChecks: [], mode: 'rb-only', detail: 'branch not protected; run rb protect' };
      if (e.status === 403 && /upgrade|pro|public/i.test(e.message)) return { branch, available: false, protected: false, requiredChecks: [], mode: 'rb-only', detail: 'branch protection needs GitHub Pro or a public repo' };
      throw e;
    }
  },
  // File contents at a ref, or null when absent.
  fileAt(c, filePath, ref) {
    try {
      const f = c.api('GET', `{repo}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`, { params: { ref } });
      if (!f || f.type !== 'file' || typeof f.content !== 'string') return null;
      return Buffer.from(f.content, f.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
    } catch (e) {
      if (e instanceof GhError && e.status === 404) return null;
      throw e;
    }
  },
};

function num(n) {
  const v = Number(String(n).replace(/^#/, ''));
  if (!Number.isInteger(v) || v < 1) throw new CliError(`invalid issue or PR number "${n}"`, 2);
  return v;
}

// ---------- gh CLI status (doctor) ----------

export function ghStatus(cwd) {
  const bin = process.env.RB_GH_BIN;
  if (bin) return { installed: true, authenticated: true, detail: `RB_GH_BIN=${path.basename(bin)}` };
  const v = run('gh', ['--version'], { cwd, timeout: 15000 });
  if (v.missing || (!v.ok && v.status === null)) return { installed: false, authenticated: false, detail: 'gh not found on PATH' };
  const a = run('gh', ['auth', 'status'], { cwd, timeout: 20000 });
  if (!a.ok) {
    // Cloud sessions use a proxied token: `gh auth status` fails while the REST API works.
    const u = run('gh', ['api', 'user', '--jq', '.login'], { cwd, timeout: 20000 });
    if (u.ok && u.stdout.trim()) return { installed: true, authenticated: true, detail: `API reachable as ${u.stdout.trim()} (gh auth status fails with a proxied token; REST works)` };
    const lines = (a.stderr || a.stdout).split(/\r?\n/).map((l) => l.trim().replace(/^[Xx!]\s+/, '')).filter(Boolean);
    const line = lines.find((l) => /fail|not logged|error|invalid|expired/i.test(l)) || 'not authenticated; run `gh auth login`';
    return { installed: true, authenticated: false, detail: line };
  }
  return { installed: true, authenticated: true, detail: 'authenticated' };
}

// ---------- rb gh <op> CLI ----------

export const GH_OPS = {
  'issue-create': '--title <t> --body-file <f> [--label a,b]',
  'issue-edit': '<n> [--body-file <f>] [--title <t>] [--state open|closed] [--add-label a,b] [--remove-label a]',
  'issue-comment': '<n> --body-file <f>',
  'issue-view': '<n>',
  'issue-list': '[--label a,b] [--state open|closed|all]',
  'label-add': '<n> <label[,label]>',
  'label-remove': '<n> <label>',
  'labels-ensure': '',
  'pr-create': '--head <b> --base <b> --title <t> --body-file <f> [--label a,b] [--draft]',
  'pr-view': '<n>',
  'pr-list': '[--state open|closed|all] [--head-prefix rb/]',
  'pr-files': '<n>',
  'pr-comment': '<n> --body-file <f>',
  'pr-update-branch': '<n>',
  'pr-edit': '<n> --body-file <f>',
  'pr-line': '<n> --line <machine line>',
  checks: '<sha>',
  whoami: '',
  protection: '[--branch <b>]',
};

function bodyFrom(flags, cwd, { required = true } = {}) {
  const f = flags['body-file'];
  if (f === undefined || f === true) {
    if (typeof flags.body === 'string') return flags.body;
    if (required) throw new CliError('--body-file is required', 2);
    return undefined;
  }
  if (f === '-') return readText(0) ?? '';
  const text = readText(path.resolve(cwd, f));
  if (text === null) throw new CliError(`cannot read ${f}`);
  return text;
}

function labelsFlag(v) {
  if (v === undefined || v === true) return [];
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

// Flags every op accepts besides its own (from the GH_OPS usage line).
const GLOBAL_GH_FLAGS = new Set(['repo', 'json', 'help']);

// An unknown flag is an error, never silently ignored: `issue-edit --add-label` once did nothing
// and a PR went without its tier label (3d_brain, 2026-10-14).
function checkFlags(op, flags) {
  if (!Object.hasOwn(GH_OPS, op)) return;
  const allowed = new Set([...GH_OPS[op].matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]));
  if (allowed.has('body-file')) allowed.add('body');
  const bad = Object.keys(flags).filter((k) => !allowed.has(k) && !GLOBAL_GH_FLAGS.has(k));
  if (bad.length) throw new CliError(`rb gh ${op}: unknown flag ${bad.map((k) => `--${k}`).join(', ')}; usage: rb gh ${op} ${GH_OPS[op]}`, 2);
}

const TIER_MARKER = /<!--\s*rockbuilt:tier\s+([ABC])\s*-->/i;

// rb gh pr-line: replaces one machine line in a PR body without rewriting the rest (3d_brain
// cycle-4889aa8-pwzk rewrote six bodies by hand after update-branch). A status line replaces the
// line of the same stage; any other `<!-- rockbuilt:<kind> ... -->` line replaces the one of the
// same kind. With no match the line goes before the tier marker (or at the end).
export function replaceMachineLine(body, line) {
  const l = String(line || '').trim();
  const m = l.match(/^<!--\s*rockbuilt:([\w-]+)\s+([^>]*?)\s*-->$/);
  if (!m || /[\r\n]/.test(l)) throw new CliError('--line must be one `<!-- rockbuilt:<kind> ... -->` line', 2);
  const kind = m[1];
  const stage = kind === 'status' ? (m[2].match(/\bstage=(\S+)/) || [])[1] : null;
  if (kind === 'status' && !stage) throw new CliError('a status line needs stage=<agent>', 2);
  if (kind === 'tier') throw new CliError('the tier line is not replaced this way (relabel the PR instead)', 2);
  const lines = String(body || '').split('\n');
  // Lines inside code fences are examples, never the PR's own machine lines.
  const fenced = new Set();
  let fence = null;
  lines.forEach((x, i) => {
    const f = x.match(/^\s*(```|~~~)/);
    if (f && (!fence || f[1] === fence)) { fence = fence ? null : f[1]; fenced.add(i); return; }
    if (fence) fenced.add(i);
  });
  const sameAt = (x, i) => !fenced.has(i) && same(x);
  const same = (x) => {
    const y = x.trim().match(/^<!--\s*rockbuilt:([\w-]+)\s+([^>]*?)\s*-->$/);
    if (!y || y[1] !== kind) return false;
    return kind !== 'status' || (y[2].match(/\bstage=(\S+)/) || [])[1] === stage;
  };
  const at = lines.findIndex(sameAt);
  if (at !== -1) {
    lines[at] = l;
    return lines.filter((x, i) => i === at || !sameAt(x, i)).join('\n');
  }
  const tier = lines.findIndex((x, i) => !fenced.has(i) && TIER_MARKER.test(x));
  if (tier !== -1) lines.splice(tier, 0, l);
  else lines.push(l);
  return lines.join('\n');
}

// pr-create labels: the body's `<!-- rockbuilt:tier X -->` adds rb:tier-x when no tier label was
// given; a given tier label below the declared tier is refused (the gate would refuse it later).
export function prLabels(body, labels) {
  const m = String(body || '').match(TIER_MARKER);
  if (!m) return labels;
  const declared = m[1].toUpperCase();
  const given = labels.filter((l) => /^rb:tier-[abc]$/i.test(l)).map((l) => l.slice(-1).toUpperCase());
  if (!given.length) return [...labels, `rb:tier-${declared.toLowerCase()}`];
  const rank = (t) => 'ABC'.indexOf(t);
  if (given.some((t) => rank(t) < rank(declared))) throw new CliError(`the body declares tier ${declared} but --label gives rb:tier-${given.map((t) => t.toLowerCase()).join(',rb:tier-')}`, 2);
  return labels;
}

export function runGhOp(c, op, positionals, flags, { cwd, defaultBranch }) {
  const [a, b] = positionals;
  const str = (k) => (typeof flags[k] === 'string' ? flags[k] : undefined);
  checkFlags(op, flags);
  switch (op) {
    case 'issue-create': return ops.issueCreate(c, { title: str('title'), body: bodyFrom(flags, cwd), labels: labelsFlag(flags.label) });
    case 'issue-edit': {
      const n = req(a, op);
      const add = labelsFlag(flags['add-label']);
      const remove = labelsFlag(flags['remove-label']);
      const body = bodyFrom(flags, cwd, { required: false });
      const edited = (str('title') || body !== undefined || str('state')) ? ops.issueEdit(c, n, { title: str('title'), body, state: str('state') }) : ops.issueView(c, n);
      let labels = edited.labels;
      if (add.length) labels = ops.labelAdd(c, n, add).labels;
      for (const l of remove) ops.labelRemove(c, n, l);
      if (remove.length) labels = labels.filter((l) => !remove.includes(l));
      return { ...edited, labels };
    }
    case 'issue-comment': return ops.issueComment(c, req(a, op), bodyFrom(flags, cwd));
    case 'issue-view': return ops.issueView(c, req(a, op));
    case 'issue-list': return ops.issueList(c, { labels: labelsFlag(flags.label), state: str('state') || 'open' });
    case 'label-add': return ops.labelAdd(c, req(a, op), labelsFlag(req(b, op)));
    case 'label-remove': return ops.labelRemove(c, req(a, op), req(b, op));
    case 'labels-ensure': return ops.labelsEnsure(c);
    case 'pr-create': {
      const body = bodyFrom(flags, cwd);
      return ops.prCreate(c, { head: str('head'), base: str('base') || defaultBranch(), title: str('title'), body, labels: prLabels(body, labelsFlag(flags.label)), draft: Boolean(flags.draft) });
    }
    case 'pr-view': return ops.prView(c, req(a, op));
    case 'pr-list': return ops.prList(c, { state: str('state') || 'open', headPrefix: str('head-prefix') || null });
    case 'pr-files': return ops.prFiles(c, req(a, op));
    case 'pr-comment': return ops.issueComment(c, req(a, op), bodyFrom(flags, cwd));
    case 'pr-update-branch': return ops.prUpdateBranch(c, req(a, op));
    case 'pr-edit': return ops.issueEdit(c, req(a, op), { body: bodyFrom(flags, cwd) });
    case 'pr-line': {
      const n = req(a, op);
      const body = replaceMachineLine(ops.prView(c, n).body, str('line'));
      const edited = ops.issueEdit(c, n, { body });
      return { number: edited.number, line: str('line').trim() };
    }
    case 'checks': return ops.checks(c, req(a, op));
    case 'whoami': return ops.whoami(c);
    case 'protection': return ops.protection(c, str('branch') || defaultBranch());
    default: throw new CliError(`unknown gh op "${op}"; ops: ${Object.keys(GH_OPS).join(', ')}`, 2);
  }
}

function req(v, op) {
  if (v === undefined) throw new CliError(`usage: rb gh ${op} ${GH_OPS[op]}`, 2);
  return v;
}
