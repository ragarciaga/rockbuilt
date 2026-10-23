// Attention hours (DESIGN.md section 22, rb hours): the owner's time per project, feature and task.
//
// Nobody can time a person who jumps between projects, so this counts attention, not sessions:
// every prompt the owner sends and every comment the owner writes on GitHub is a mark. Marks of
// one repo closer than `gap` minutes form a block; a block ends `tail` minutes after its last
// mark. When blocks of different repos overlap, the overlapping minutes are split evenly, so two
// hours spent jumping between three projects add up to two hours, not six.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from './util.mjs';

export const HOURS_TITLE = 'Rockbuilt hours';
export const UNATTENDED_TAG = '[rockbuilt:unattended]';
export const DEFAULTS = { gapMin: 10, tailMin: 5 };
// GitHub rejects comments over 65,536 characters; stay well under (the host may append a footer).
const MAX_LINES_PER_COMMENT = 900;
const MAX_CHARS_PER_COMMENT = 50000;
const MIN = 60000;

// ---------- local marks (written by the UserPromptSubmit hook) ----------

export const attentionFile = (root) => path.join(root, '.rockbuilt', 'attention.jsonl');
// One state file per session, so two sessions stopping at once never overwrite each other.
const stateFile = (root, session) => path.join(root, '.rockbuilt', 'attention-state', `${String(session).replace(/[^\w.-]/g, '_')}.json`);

export function recordMark(root, { session, branch, ts }) {
  const file = attentionFile(root);
  mkdirSync(path.dirname(file), { recursive: true });
  const rec = { ts: new Date(ts).toISOString(), session: session || 'unknown', branch: branch || null };
  appendFileSync(file, `${JSON.stringify(rec)}\n`);
  return rec;
}

export function readMarks(root) {
  let text;
  try {
    text = readFileSync(attentionFile(root), 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line);
      if (m && m.ts && Number.isFinite(Date.parse(m.ts))) out.push(m);
    } catch {
      // A torn line is skipped.
    }
  }
  return out;
}

// Manual entries in `Hours: local` mode stay in this file instead of the hours issue.
const manualFile = (root) => path.join(root, '.rockbuilt', 'attention-manual.jsonl');

export function recordManualLocal(root, entry) {
  mkdirSync(path.dirname(manualFile(root)), { recursive: true });
  appendFileSync(manualFile(root), `${JSON.stringify(entry)}\n`);
}

export function readManualLocal(root) {
  try {
    return readFileSync(manualFile(root), 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter((e) => e && Number(e.minutes) > 0 && Number.isFinite(Date.parse(e.at)));
  } catch {
    return [];
  }
}

export function readState(root, session) {
  try {
    return JSON.parse(readFileSync(stateFile(root, session), 'utf8')) || null;
  } catch {
    return null;
  }
}

export function writeState(root, session, state) {
  mkdirSync(path.dirname(stateFile(root, session)), { recursive: true });
  writeFileSync(stateFile(root, session), `${JSON.stringify(state, null, 2)}\n`);
}

// ---------- durable form: comments on the "Rockbuilt hours" issue ----------

const SESSION_RE = /<!--\s*rockbuilt:attention\s+session=(\S+?)(?:\s+part=(\d+))?\s*-->/;
const MANUAL_RE = /<!--\s*rockbuilt:attention\s+manual\s+([^>]*?)\s*-->/;
const LINE_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(\S+)\s*$/;

// One comment per session (edited in place as marks arrive), split in parts by lines and size.
// Only the time and the branch are kept; prompt text never leaves the machine.
export function sessionComments(session, marks) {
  const lines = marks.map((m) => `${new Date(m.ts).toISOString()} ${String(m.branch || '-').slice(0, 200)}`);
  const parts = [[]];
  let size = 0;
  for (const line of lines) {
    const cur = parts[parts.length - 1];
    if (cur.length && (cur.length >= MAX_LINES_PER_COMMENT || size + line.length + 1 > MAX_CHARS_PER_COMMENT)) {
      parts.push([]);
      size = 0;
    }
    parts[parts.length - 1].push(line);
    size += line.length + 1;
  }
  return parts.map((chunk, k) => [
    `<!-- rockbuilt:attention session=${session}${k ? ` part=${k + 1}` : ''} -->`,
    'Attention marks for `rb hours`: one line per prompt (UTC time, branch). No prompt text is stored.',
    '',
    '```',
    ...chunk,
    '```',
    '',
  ].join('\n'));
}

export function manualComment({ minutes, at, ref, spec, note }) {
  const attrs = [`min=${minutes}`, `at=${new Date(at).toISOString()}`];
  if (ref) attrs.push(`ref=${ref}`);
  if (spec) attrs.push(`spec=${spec}`);
  return `<!-- rockbuilt:attention manual ${attrs.join(' ')} -->\nManual time entry for \`rb hours\`: ${minutes} min${note ? `. ${note}` : ''}\n`;
}

// { marks: [{ ts, branch, session }], manual: [{ minutes, at, ref, spec }] } from comment bodies.
export function parseAttention(bodies) {
  const marks = [];
  const manual = [];
  for (const body of bodies) {
    const text = String(body || '');
    const s = text.match(SESSION_RE);
    if (s) {
      for (const line of text.split(/\r?\n/)) {
        const m = line.trim().match(LINE_RE);
        if (m) marks.push({ ts: m[1], branch: m[2] === '-' ? null : m[2], session: s[1] });
      }
      continue;
    }
    const mm = text.match(MANUAL_RE);
    if (mm) {
      const attrs = Object.fromEntries(mm[1].split(/\s+/).map((kv) => kv.split('=')).filter((kv) => kv.length === 2));
      const minutes = Number(attrs.min);
      if (Number.isFinite(minutes) && minutes > 0 && Number.isFinite(Date.parse(attrs.at))) {
        manual.push({ minutes, at: attrs.at, ref: attrs.ref || null, spec: attrs.spec || null });
      }
    }
  }
  return { marks, manual };
}

// ---------- attribution: branch or issue number -> { task, spec } ----------

const TASK_MARKER = /<!--\s*rockbuilt:task\s+(\S+?)(?:\s+spec=(\S+?))?\s*-->/;

function markerOf(body) {
  const m = String(body || '').match(TASK_MARKER);
  if (!m) return null;
  const spec = m[2] && m[2] !== 'none' ? m[2].replace(/\/+$/, '') : null;
  return { task: m[1], spec };
}

// Branch conventions from DESIGN 12: rb/<id>-<slug>[-r<k>], rb/spec-<NN-slug>, rb/verify-<slug>.
export function refFromBranch(branch) {
  if (!branch) return null;
  let m = branch.match(/^rb\/spec-(.+)$/);
  if (m) return { task: '(spec)', spec: `docs/specs/${m[1]}` };
  m = branch.match(/^rb\/verify-(.+)$/);
  if (m) return { task: '(verify)', spec: null, specSlug: m[1] };
  m = branch.match(/^rb\/([A-Za-z]+\d+)(?:-|$)/);
  if (m) return { task: m[1].toUpperCase().startsWith('T') ? m[1].toUpperCase() : m[1], spec: null };
  return null;
}

const cleanSpec = (spec) => (spec ? String(spec).replace(/\\/g, '/').replace(/\/+$/, '') : null);

export function makeResolver({ prs = [], issues = [] } = {}) {
  const byBranch = new Map();
  const byNumber = new Map();
  const specsOfTask = new Map();
  const specs = new Set();
  const note = (r) => {
    if (!r || !r.spec) return;
    specs.add(r.spec);
    if (!specsOfTask.has(r.task)) specsOfTask.set(r.task, new Set());
    specsOfTask.get(r.task).add(r.spec);
  };
  // Only trusted authors' markers count: a public visitor can paste a task marker into an issue
  // (rockbuilt #30). Issues without an author_association (older data) are trusted as before.
  const trustedIssue = (i) => !i.author_association || ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(i.author_association);
  for (const i of issues) {
    if (!trustedIssue(i)) continue;
    const r = markerOf(i.body);
    if (r) { byNumber.set(i.number, r); note(r); }
  }
  const marked = [];
  for (const p of prs) {
    const r = markerOf(p.body);
    if (r) note(r);
    marked.push([p, r]);
  }
  const general = { task: '(general)', spec: null };
  // A task id alone (a branch before its PR exists, a manual --ref) takes its spec when exactly
  // one spec has a task with that id; a verify branch takes the spec whose folder ends in its slug.
  const complete = (r) => {
    if (!r || r.spec) return r;
    if (r.specSlug) {
      const hit = [...specs].filter((s) => path.posix.basename(s) === r.specSlug || path.posix.basename(s).endsWith(`-${r.specSlug}`));
      return { task: r.task, spec: hit.length === 1 ? hit[0] : null };
    }
    const set = specsOfTask.get(r.task);
    return set && set.size === 1 ? { task: r.task, spec: [...set][0] } : { task: r.task, spec: null };
  };
  // PRs without a marker (verify PRs, older task PRs) are completed like a bare branch.
  for (const [p, marker] of marked) {
    const r = marker || complete(refFromBranch(p.head && p.head.ref));
    if (!r) continue;
    byNumber.set(p.number, r);
    if (p.head && p.head.ref) byBranch.set(p.head.ref, r);
  }
  return {
    branch(b) {
      if (!b) return general;
      return byBranch.get(b) || complete(refFromBranch(b)) || general;
    },
    number(n) {
      return byNumber.get(Number(n)) || general;
    },
    // Manual entries: --ref is a task id or an issue/PR number; --spec wins when given.
    manual(ref, spec) {
      const s = cleanSpec(spec);
      if (!ref) return { task: '(manual)', spec: s };
      if (/^#?\d+$/.test(ref)) {
        const r = byNumber.get(Number(String(ref).replace('#', '')));
        return r ? { task: r.task, spec: s || r.spec } : { task: `#${String(ref).replace('#', '')}`, spec: s };
      }
      const task = ref.toUpperCase().startsWith('T') ? ref.toUpperCase() : ref;
      return s ? { task, spec: s } : complete({ task, spec: null });
    },
  };
}

// ---------- the arithmetic ----------

// Segments of one repo's marks: a mark owns the time until the next mark when that is within
// `gap`, otherwise `tail` minutes. Marks at the same instant count once.
export function segmentsFor(marks, { gapMin = DEFAULTS.gapMin, tailMin = DEFAULTS.tailMin } = {}) {
  const sorted = marks
    .map((m) => ({ ...m, t: Date.parse(m.ts) }))
    .filter((m) => Number.isFinite(m.t))
    .sort((a, b) => a.t - b.t);
  const uniq = sorted.filter((m, i) => i === 0 || m.t !== sorted[i - 1].t);
  const out = [];
  for (let i = 0; i < uniq.length; i++) {
    const m = uniq[i];
    const next = uniq[i + 1];
    const end = next && next.t - m.t <= gapMin * MIN ? next.t : m.t + tailMin * MIN;
    out.push({ key: m.key, start: m.t, end });
  }
  return out;
}

// Splits overlapping segments evenly: in any instant covered by k segments each gets 1/k.
// Sweep line over start/end events. Returns Map key -> milliseconds.
export function splitOverlaps(segments) {
  const events = [];
  for (const s of segments) {
    if (!(s.end > s.start)) continue;
    events.push([s.start, 1, s.key], [s.end, -1, s.key]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const active = new Map();
  let count = 0;
  let prev = null;
  const totals = new Map();
  for (const [t, d, key] of events) {
    if (prev !== null && t > prev && count > 0) {
      const share = (t - prev) / count;
      for (const [k, n] of active) totals.set(k, (totals.get(k) || 0) + share * n);
    }
    prev = t;
    active.set(key, (active.get(key) || 0) + d);
    if (active.get(key) === 0) active.delete(key);
    count += d;
  }
  return totals;
}

function clip(segments, since, until) {
  return segments
    .map((s) => ({ ...s, start: Math.max(s.start, since ?? -Infinity), end: Math.min(s.end, until ?? Infinity) }))
    .filter((s) => s.end > s.start);
}

const keyOf = (repo, spec, task) => `${repo}\u0000${spec || ''}\u0000${task}`;
const unkey = (k) => {
  const [repo, spec, task] = k.split('\u0000');
  return { repo, spec: spec || null, task };
};

// projects: [{ repo, marks: [{ ts, branch }], comments: [{ ts, number }], manual: [...],
//              resolver, agent: [{ task, spec, minutes, estHours }], baselines: { spec: hours } }]
export function computeHours(projects, { gapMin = DEFAULTS.gapMin, tailMin = DEFAULTS.tailMin, since = null, until = null } = {}) {
  const segments = [];
  for (const p of projects) {
    const resolver = p.resolver || makeResolver();
    const keyed = [
      ...p.marks.map((m) => {
        const r = resolver.branch(m.branch);
        return { ts: m.ts, key: keyOf(p.repo, r.spec, r.task) };
      }),
      ...p.comments.map((c) => {
        const r = resolver.number(c.number);
        return { ts: c.ts, key: keyOf(p.repo, r.spec, r.task) };
      }),
    ];
    segments.push(...segmentsFor(keyed, { gapMin, tailMin }));
  }
  const totals = splitOverlaps(clip(segments, since, until));
  // Manual entries are time the owner states outright: added in full, never split with marks.
  for (const p of projects) {
    const resolver = p.resolver || makeResolver();
    for (const e of p.manual || []) {
      const end = Date.parse(e.at);
      const [seg] = clip([{ start: end - e.minutes * MIN, end }], since, until);
      if (!seg) continue;
      const r = resolver.manual(e.ref, e.spec);
      const k = keyOf(p.repo, r.spec, r.task);
      totals.set(k, (totals.get(k) || 0) + (seg.end - seg.start));
    }
  }

  const rows = new Map();
  const row = (repo, spec, task) => {
    const k = keyOf(repo, spec, task);
    if (!rows.has(k)) rows.set(k, { repo, spec, task, ownerMinutes: 0, agentMinutes: 0, estHours: null });
    return rows.get(k);
  };
  for (const [k, ms] of totals) {
    const { repo, spec, task } = unkey(k);
    row(repo, spec, task).ownerMinutes += ms / MIN;
  }
  for (const p of projects) {
    for (const a of p.agent || []) {
      const r = row(p.repo, a.spec, a.task);
      r.agentMinutes += a.minutes;
      if (Number.isFinite(a.estHours)) r.estHours = (r.estHours || 0) + a.estHours;
    }
  }
  const tasks = [...rows.values()].sort((a, b) => a.repo.localeCompare(b.repo) || String(a.spec || '~').localeCompare(String(b.spec || '~')) || a.task.localeCompare(b.task));

  const features = new Map();
  for (const t of tasks) {
    const k = `${t.repo}\u0000${t.spec || ''}`;
    if (!features.has(k)) {
      const p = projects.find((x) => x.repo === t.repo);
      const baseline = t.spec && p && p.baselines ? p.baselines[t.spec] : undefined;
      features.set(k, { repo: t.repo, spec: t.spec, ownerMinutes: 0, agentMinutes: 0, estHours: null, baselineHours: Number.isFinite(baseline) ? baseline : null, tasks: 0 });
    }
    const f = features.get(k);
    f.ownerMinutes += t.ownerMinutes;
    f.agentMinutes += t.agentMinutes;
    if (t.estHours !== null) f.estHours = (f.estHours || 0) + t.estHours;
    if (!t.task.startsWith('(')) f.tasks += 1;
  }
  const ownerTotal = tasks.reduce((s, t) => s + t.ownerMinutes, 0);
  return { tasks, features: [...features.values()], ownerMinutes: ownerTotal, gapMin, tailMin };
}

// ---------- rendering ----------

const h = (min) => (min / 60).toFixed(2);
const featureName = (spec) => (spec ? path.posix.basename(spec) : '(no feature)');
const cell = (v) => (v === null || v === undefined ? '' : String(v));

export function renderHours(report, { repos = [], notes = [] } = {}) {
  if (!report.tasks.length) return '_No attention marks or agent timing in this period._';
  const lines = ['## Hours by feature', '', '| Repo | Feature | Your hours | Agent minutes | Tasks | Baseline (you) h | Baseline (planner) h |', '|---|---|---:|---:|---:|---:|---:|'];
  for (const f of report.features) {
    lines.push(`| ${f.repo} | ${featureName(f.spec)} | ${h(f.ownerMinutes)} | ${f.agentMinutes.toFixed(1)} | ${f.tasks} | ${cell(f.baselineHours)} | ${f.estHours === null ? '' : f.estHours.toFixed(1)} |`);
  }
  lines.push('', `**Your total: ${h(report.ownerMinutes)} h.**`, '', '## By task', '', '| Repo | Feature | Task | Your hours | Agent minutes | Planner estimate h |', '|---|---|---|---:|---:|---:|');
  for (const t of report.tasks) {
    lines.push(`| ${t.repo} | ${featureName(t.spec)} | ${t.task} | ${h(t.ownerMinutes)} | ${t.agentMinutes.toFixed(1)} | ${t.estHours === null ? '' : t.estHours.toFixed(1)} |`);
  }
  lines.push(
    '',
    '## Method',
    '',
    `Estimated attention time, not a stopwatch. Marks are your prompts in Claude Code sessions and your own comments on GitHub (harness comments excluded), plus manual entries (\`rb hours log\`). Marks closer than ${report.gapMin} min form one block, which ends ${report.tailMin} min after its last mark. Where projects overlap in time, the minutes are split evenly between them. Time spent thinking without touching anything, and work in repositories outside this report, are not seen.`,
  );
  if (repos.length) lines.push('', `Repositories: ${repos.join(', ')}.`);
  for (const n of notes) lines.push('', n);
  return lines.join('\n');
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function renderCsv(report) {
  const out = [['level', 'repo', 'feature', 'task', 'your_hours', 'agent_minutes', 'baseline_you_hours', 'baseline_planner_hours'].join(',')];
  for (const f of report.features) {
    out.push(['feature', f.repo, featureName(f.spec), '', h(f.ownerMinutes), f.agentMinutes.toFixed(1), cell(f.baselineHours), f.estHours === null ? '' : f.estHours.toFixed(1)].map(csvCell).join(','));
  }
  for (const t of report.tasks) {
    out.push(['task', t.repo, featureName(t.spec), t.task, h(t.ownerMinutes), t.agentMinutes.toFixed(1), '', t.estHours === null ? '' : t.estHours.toFixed(1)].map(csvCell).join(','));
  }
  return `${out.join('\n')}\n`;
}

// "Baseline: 12 h" (or "Línea base: 12 h") anywhere in a spec's requirements.md.
export function parseBaseline(text) {
  const m = String(text || '').match(/^\s*(?:[-*]\s+)?(?:\*\*)?(?:baseline|l[ií]nea base)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(\d+(?:[.,]\d+)?)\s*h/im);
  return m ? Number(m[1].replace(',', '.')) : null;
}

export function parseWindow(value, name) {
  if (!value) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(t)) throw new CliError(`--${name} must be a date (YYYY-MM-DD) or an ISO time`, 2);
  return t;
}
