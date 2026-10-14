// rb sync (DESIGN.md section 11 step 2): tasks done from merged PRs, merged branches cleaned, labels repaired.
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { holdsLock } from './control.mjs';
import { ops } from './gh.mjs';
import { parseTasks, STATUS_DONE_ES } from './spec.mjs';
import { currentBranch, defaultBranch } from './repo.mjs';
import { exists, git, readText, slugify, toPosix } from './util.mjs';

export function specDirs(root) {
  const base = path.join(root, 'docs', 'specs');
  if (!exists(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && exists(path.join(base, e.name, 'tasks.md')))
    .map((e) => path.join(base, e.name))
    .sort();
}

// { id, spec } from a PR body marker or its rb/<id>-slug branch.
export function taskRefFromPr(pr) {
  const m = String(pr.body || '').match(/<!--\s*rockbuilt:task\s+(\S+)(?:\s+spec=(\S+?))?\s*-->/) || String(pr.body || '').match(/<!--\s*rockbuilt:task\s+(\S+)(?:\s+spec=(\S+))?/);
  if (m) return { id: m[1].toUpperCase().startsWith('T') ? m[1].toUpperCase() : m[1], spec: m[2] ? m[2].replace(/\/+$/, '') : null, via: 'marker' };
  const b = pr.head && pr.head.ref ? pr.head.ref.match(/^rb\/(T\d+)(?:-(.*))?$/i) : null;
  if (b) return { id: b[1].toUpperCase(), spec: null, slug: b[2] || '', via: 'branch' };
  return null;
}

// Rewrites "- Status: x" (or "- Estado: x") inside one task block, keeping key, bullet and spacing.
export function setTaskStatus(text, taskId, spanish) {
  const lines = text.split('\n');
  let inTask = false;
  let inLog = false;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^##\s+(T\d+)\b/);
    if (h) { inTask = h[1] === taskId; inLog = false; continue; }
    if (/^##\s/.test(lines[i])) { inTask = false; continue; }
    if (/^###\s/.test(lines[i])) { inLog = true; continue; }
    if (!inTask || inLog) continue;
    const m = lines[i].match(/^(\s*[-*]\s+(Status|Estado)\s*:\s*)(.*?)(\r?)$/i);
    if (m) {
      const es = spanish || /^estado$/i.test(m[2]);
      lines[i] = `${m[1]}${es ? STATUS_DONE_ES : 'done'}${m[4]}`;
      return { text: lines.join('\n'), changed: true, from: m[3].trim() };
    }
  }
  return { text, changed: false };
}

export function syncProject(root, c, { log = () => {}, run = null } = {}) {
  const result = { tasks: [], ambiguous: [], branches: { deleted: [], kept: [] }, labels: [], github: 'ok' };
  const specs = specDirs(root).map((dir) => ({ dir, rel: toPosix(path.relative(root, dir)), text: readText(path.join(dir, 'tasks.md')) }));
  for (const s of specs) s.parsed = parseTasks(s.text);

  let merged = [];
  let openPrs = [];
  let issueSpec = new Map();
  if (c) {
    try {
      merged = ops.prList(c, { state: 'closed' }).filter((p) => p.merged_at);
      openPrs = ops.prList(c, { state: 'open' });
    } catch (e) {
      result.github = `skipped: ${e.message}`;
      c = null;
    }
  } else {
    result.github = 'skipped: no GitHub access';
  }

  // Task issues carry `<!-- rockbuilt:task <id> spec=<dir> -->`; a PR body without its own marker
  // still says `Closes #n`, which names the spec when the id repeats across specs. Best effort.
  if (c) {
    try {
      for (const i of ops.issueList(c, { state: 'all' })) {
        const m = String(i.body || '').match(/<!--\s*rockbuilt:task\s+(\S+?)(?:\s+spec=(\S+?))?\s*-->/);
        if (m && m[2] && m[2] !== 'none') issueSpec.set(i.number, { id: m[1].toUpperCase().startsWith('T') ? m[1].toUpperCase() : m[1], spec: m[2].replace(/\/+$/, '') });
      }
    } catch (e) {
      result.github = `partial: ${e.message}`;
    }
  }

  // Tasks done from merged PRs.
  for (const pr of merged) {
    const ref = taskRefFromPr(pr);
    if (!ref) continue;
    if (!ref.spec) {
      const closes = [...String(pr.body || '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi)].map((m) => issueSpec.get(Number(m[1]))).filter((x) => x && x.id === ref.id);
      if (closes.length) { ref.spec = closes[0].spec; ref.via = `${ref.via}+issue`; }
    }
    let cands = specs.filter((s) => s.parsed.tasks.some((t) => t.id === ref.id));
    if (ref.spec) cands = cands.filter((s) => s.rel === ref.spec || s.rel.endsWith(`/${path.posix.basename(ref.spec)}`));
    if (cands.length > 1 && ref.slug) {
      const narrowed = cands.filter((s) => {
        const t = s.parsed.tasks.find((x) => x.id === ref.id);
        const sl = slugify(t.title);
        return sl && (ref.slug.startsWith(sl) || sl.startsWith(ref.slug));
      });
      if (narrowed.length) cands = narrowed;
    }
    if (cands.length !== 1) {
      if (cands.length > 1) result.ambiguous.push({ pr: pr.number, task: ref.id, specs: cands.map((s) => s.rel) });
      continue;
    }
    const s = cands[0];
    const task = s.parsed.tasks.find((t) => t.id === ref.id);
    if (task.status === 'done') continue;
    const spanish = s.parsed.spanishStatus;
    const r = setTaskStatus(s.text, ref.id, spanish);
    if (!r.changed) continue;
    s.text = r.text;
    s.dirty = true;
    task.status = 'done';
    result.tasks.push({ spec: s.rel, task: ref.id, from: r.from, pr: pr.number, via: ref.via });
    log(`${s.rel} ${ref.id}: ${r.from} -> done (PR #${pr.number})`);
  }
  for (const s of specs) if (s.dirty) writeFileSync(path.join(s.dir, 'tasks.md'), s.text);

  // Local rb/* branches of merged PRs: deleted only when the tip equals the merged PR head, or the
  // branch is contained in the default branch. Never `git branch -d` alone: it also accepts a
  // branch merged into its own upstream, which is every pushed branch of an open PR (3d_brain,
  // 2026-10-14). A branch with an open PR is always kept.
  const cur = currentBranch(root);
  const openHeads = new Set(openPrs.filter((p) => p.head).map((p) => p.head.ref));
  const base = (() => {
    const d = defaultBranch(root);
    for (const ref of [`refs/remotes/origin/${d}`, `refs/heads/${d}`]) if (git(root, ['rev-parse', '--verify', '--quiet', ref]).ok) return ref;
    return null;
  })();
  const wt = git(root, ['worktree', 'list', '--porcelain']).stdout.split(/\r?\n/).filter((l) => l.startsWith('branch ')).map((l) => l.slice(7).replace(/^refs\/heads\//, ''));
  const heads = new Map(merged.filter((p) => p.head).map((p) => [p.head.ref, p.head.sha]));
  const branches = git(root, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads/rb/']).stdout.split(/\r?\n/).filter(Boolean);
  for (const line of branches) {
    const [b, sha] = line.split(' ');
    if (b === cur || wt.includes(b)) { result.branches.kept.push({ branch: b, reason: 'checked out' }); continue; }
    if (openHeads.has(b)) { result.branches.kept.push({ branch: b, reason: 'open PR' }); continue; }
    let how = null;
    if (heads.get(b) && heads.get(b) === sha) how = 'squash-merged (tip equals the merged PR head)';
    else if (base && git(root, ['merge-base', '--is-ancestor', sha, base]).ok) how = 'merged into the default branch';
    if (how && git(root, ['update-ref', '-d', `refs/heads/${b}`, sha]).ok) { result.branches.deleted.push({ branch: b, how }); continue; }
    result.branches.kept.push({ branch: b, reason: 'not merged' });
  }

  // Labels on closed issues.
  if (c) {
    try {
      for (const label of ['rb:in-progress', 'rb:pr-open']) {
        for (const i of ops.issueList(c, { labels: [label], state: 'closed' })) {
          ops.labelRemove(c, i.number, label);
          result.labels.push({ issue: i.number, removed: label });
        }
      }
      // A run that holds the lock is the only one working: rb:in-progress left on an open issue
      // without an open PR is a claim from a run that died (timeout, exhausted context).
      if (run && holdsLock(c, run).held) {
        const prOpen = new Set(ops.issueList(c, { labels: ['rb:pr-open'], state: 'open' }).map((i) => i.number));
        for (const i of ops.issueList(c, { labels: ['rb:in-progress'], state: 'open' })) {
          if (prOpen.has(i.number)) continue;
          ops.labelRemove(c, i.number, 'rb:in-progress');
          result.labels.push({ issue: i.number, removed: 'rb:in-progress', reason: 'stale claim' });
        }
      }
    } catch (e) {
      result.github = `partial: ${e.message}`;
    }
  }
  return result;
}

export function syncText(r) {
  const lines = [];
  lines.push(r.tasks.length ? `tasks marked done: ${r.tasks.map((t) => `${t.spec} ${t.task} (#${t.pr})`).join(', ')}` : 'tasks: nothing to mark done');
  for (const a of r.ambiguous) lines.push(`ambiguous: PR #${a.pr} ${a.task} matches ${a.specs.join(', ')}`);
  lines.push(r.branches.deleted.length ? `branches deleted: ${r.branches.deleted.map((b) => b.branch).join(', ')}` : 'branches: none deleted');
  if (r.branches.kept.length) lines.push(`branches kept: ${r.branches.kept.map((b) => `${b.branch} (${b.reason})`).join(', ')}`);
  if (r.labels.length) lines.push(`labels repaired: ${r.labels.map((l) => `#${l.issue} -${l.removed}`).join(', ')}`);
  lines.push(`github: ${r.github}`);
  return lines.join('\n');
}
