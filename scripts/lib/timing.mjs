// Phase timing (DESIGN.md section 21, rb timing).
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, readText } from './util.mjs';

export const PHASES = ['plan', 'implement', 'check', 'verify', 'audit', 'fix', 'e2e', 'evals', 'security', 'pr', 'ci', 'merge'];
export const START_MARK = '<!-- rb:timing:start -->';
export const END_MARK = '<!-- rb:timing:end -->';

export function timingFile(root) {
  return path.join(root, '.rockbuilt', 'timing.jsonl');
}

export function appendEvent(root, event, task, phase, now = new Date()) {
  if (!task) throw new CliError('usage: rb timing start|end <task> <phase>');
  if (!PHASES.includes(phase)) throw new CliError(`unknown phase "${phase}"; use one of ${PHASES.join(', ')}`);
  const file = timingFile(root);
  mkdirSync(path.dirname(file), { recursive: true });
  const record = { task, phase, event, ts: now.toISOString() };
  appendFileSync(file, `${JSON.stringify(record)}\n`);
  return record;
}

export function readEvents(root) {
  let text;
  try {
    text = readFileSync(timingFile(root), 'utf8');
  } catch {
    return [];
  }
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // A torn line from a crash is skipped rather than failing the report.
    }
  }
  return events;
}

// Pairs each end with the latest open start of the same task and phase.
export function aggregate(events) {
  const open = new Map();
  const totals = new Map();
  const taskOrder = [];
  const openOut = [];
  for (const e of events) {
    if (!e || !e.task || !e.phase) continue;
    if (!totals.has(e.task)) { totals.set(e.task, {}); taskOrder.push(e.task); }
    const key = `${e.task}\u0000${e.phase}`;
    if (e.event === 'start') {
      if (!open.has(key)) open.set(key, []);
      open.get(key).push(Date.parse(e.ts));
    } else if (e.event === 'end') {
      const starts = open.get(key);
      if (!starts || starts.length === 0) continue;
      const ms = Date.parse(e.ts) - starts.pop();
      const t = totals.get(e.task);
      t[e.phase] = (t[e.phase] || 0) + Math.max(0, ms);
    }
  }
  for (const [key, starts] of open) {
    if (!starts.length) continue;
    const [task, phase] = key.split('\u0000');
    openOut.push({ task, phase });
  }
  const tasks = taskOrder.map((task) => {
    const phases = totals.get(task);
    const totalMs = Object.values(phases).reduce((a, b) => a + b, 0);
    return { task, phases, totalMs };
  });
  return { tasks, open: openOut };
}

const minutes = (ms) => (ms / 60000).toFixed(1);

export function renderTable(report) {
  if (report.tasks.length === 0) return '_No timing data yet._';
  const used = PHASES.filter((p) => report.tasks.some((t) => t.phases[p] !== undefined));
  const head = `| Task | ${used.join(' | ')} | Total |`;
  const sep = `|---|${used.map(() => '---:').join('|')}|---:|`;
  const rows = report.tasks.map((t) => {
    const cells = used.map((p) => (t.phases[p] === undefined ? '' : minutes(t.phases[p])));
    return `| ${t.task} | ${cells.join(' | ')} | ${minutes(t.totalMs)} |`;
  });
  const lines = [head, sep, ...rows, '', 'Minutes per phase.'];
  if (report.open.length) lines.push(`Open (started, not ended): ${report.open.map((o) => `${o.task}/${o.phase}`).join(', ')}.`);
  return lines.join('\n');
}

// Rows already in the progress.md block, as report tasks (minutes back to ms). Cloud runs start
// from a fresh clone without .rockbuilt/timing.jsonl, so earlier rows live only in this table.
export function parseBlock(text) {
  if (!text) return [];
  const s = text.indexOf(START_MARK);
  const e = text.indexOf(END_MARK);
  if (s === -1 || e === -1 || e < s) return [];
  const lines = text.slice(s + START_MARK.length, e).split(/\r?\n/).filter((l) => l.trim().startsWith('|'));
  if (lines.length < 2) return [];
  const cols = lines[0].split('|').slice(1, -1).map((c) => c.trim().toLowerCase());
  const tasks = [];
  for (const row of lines.slice(2)) {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    if (!cells[0]) continue;
    const phases = {};
    cols.forEach((c, i) => {
      if (i === 0 || c === 'total' || !PHASES.includes(c) || cells[i] === '' || cells[i] === undefined) return;
      const v = Number(cells[i]);
      if (Number.isFinite(v)) phases[c] = v * 60000;
    });
    tasks.push({ task: cells[0], phases, totalMs: Object.values(phases).reduce((a, b) => a + b, 0) });
  }
  return tasks;
}

// Durable timing: one machine line per task in its PR body, so minutes survive a fresh cloud clone.
// <!-- rockbuilt:timing task=T1 plan=1.0 implement=0.4 verify=2.6 -->
export function timingLine(report, task) {
  const t = report.tasks.find((x) => x.task === task);
  if (!t) return null;
  const parts = PHASES.filter((p) => t.phases[p] !== undefined).map((p) => `${p}=${(t.phases[p] / 60000).toFixed(1)}`);
  return `<!-- rockbuilt:timing task=${task} ${parts.join(' ')} -->`.replace(/  +/g, ' ');
}

const LINE_RE = /<!--\s*rockbuilt:timing\s+task=(\S+)((?:\s+[a-z]+=[0-9.]+)*)\s*-->/g;

export function parseTimingLines(text) {
  const tasks = [];
  for (const m of String(text || '').matchAll(LINE_RE)) {
    const phases = {};
    for (const kv of m[2].trim().split(/\s+/).filter(Boolean)) {
      const [k, v] = kv.split('=');
      if (PHASES.includes(k) && Number.isFinite(Number(v))) phases[k] = Number(v) * 60000;
    }
    tasks.push({ task: m[1], phases, totalMs: Object.values(phases).reduce((a, b) => a + b, 0) });
  }
  return tasks;
}

// Existing rows are kept; a task in this run's report replaces its old row.
export function mergeReports(previous, report) {
  const fresh = new Set(report.tasks.map((t) => t.task));
  return { tasks: [...previous.filter((t) => !fresh.has(t.task)), ...report.tasks], open: report.open };
}

export function writeProgressBlock(root, table) {
  const file = path.join(root, 'docs', 'progress.md');
  const block = `${START_MARK}\n${table}\n${END_MARK}`;
  const text = readText(file);
  let next;
  if (text === null) {
    next = `# Progress\n\n## Timing\n${block}\n`;
  } else {
    const s = text.indexOf(START_MARK);
    const e = text.indexOf(END_MARK);
    if (s !== -1 && e !== -1 && e > s) {
      next = text.slice(0, s) + block + text.slice(e + END_MARK.length);
    } else {
      next = `${text.replace(/\s*$/, '')}\n\n## Timing\n${block}\n`;
    }
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, next);
  return file;
}
