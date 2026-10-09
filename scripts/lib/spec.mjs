// tasks.md and requirements.md parsing (DESIGN.md section 7).
import path from 'node:path';
import { CliError, readText } from './util.mjs';

const TASK_HEADING = /^##\s+(T\d+)\s*[:.-]?\s*(.*)$/;
const FIELD = /^\s*[-*]\s+([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/;
const CRITERION_ID = /\bR\d+\.\d+\b/g;
const TASK_ID = /\bT\d+\b/g;

export const STATUSES = ['todo', 'in-progress', 'in-review', 'done', 'blocked'];

function splitList(value) {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// "src/a.ts, src/a.test.ts           (expected touch list...)" -> ["src/a.ts", "src/a.test.ts"]
export function parseFiles(value) {
  const cleaned = value.replace(/\s{2,}\(.*\)\s*$/, '').replace(/`/g, '');
  if (/^(none|n\/a|-)?$/i.test(cleaned.trim())) return [];
  return splitList(cleaned).map((f) => f.replace(/\\/g, '/').replace(/^\.\//, ''));
}

function parseVerify(value) {
  const cleaned = value.replace(/\s{2,}\(.*\)\s*$/, '');
  const ticks = [...cleaned.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const rest = cleaned.replace(/`[^`]+`/g, '').split(/[;]/).map((s) => s.trim()).filter(Boolean);
  return [...ticks, ...rest];
}

function firstWord(value) {
  const m = value.trim().match(/^[A-Za-z-]+/);
  return m ? m[0].toLowerCase() : '';
}

function emptyTask(id, title) {
  return {
    id, title, purpose: '', covers: [], size: null, depends: [], files: [], verify: [], issue: null, status: 'todo',
  };
}

function applyField(task, key, value) {
  switch (key.toLowerCase()) {
    case 'purpose': task.purpose = value.trim(); break;
    case 'covers': task.covers = value.match(CRITERION_ID) || []; break;
    case 'size': task.size = (value.trim().match(/^[SML]\b/i) || [null])[0]?.toUpperCase() ?? null; break;
    case 'depends on': task.depends = value.match(TASK_ID) || []; break;
    case 'files': task.files = parseFiles(value); break;
    case 'verify': task.verify = parseVerify(value); break;
    case 'issue': {
      const m = value.match(/#?(\d+)/);
      task.issue = m ? Number(m[1]) : null;
      break;
    }
    case 'status': task.status = firstWord(value) || 'todo'; break;
    default: break;
  }
}

export function parseTasks(text) {
  const lines = text.split(/\r?\n/);
  const header = { feature: null, spec: null, status: null };
  const titleMatch = text.match(/^#\s+Tasks:\s*(.+)$/m);
  if (titleMatch) header.feature = titleMatch[1].trim();
  const specMatch = text.match(/^Spec:\s*([^|\n]+)/m);
  if (specMatch) header.spec = specMatch[1].trim();
  const statusMatch = text.match(/\|\s*Status:\s*([A-Za-z-]+)/);
  if (statusMatch) header.status = statusMatch[1].toLowerCase();

  const tasks = [];
  let current = null;
  let inDecisionLog = false;
  for (const line of lines) {
    const h = line.match(TASK_HEADING);
    if (h) {
      current = emptyTask(h[1], h[2].trim());
      tasks.push(current);
      inDecisionLog = false;
      continue;
    }
    if (/^##\s/.test(line)) { current = null; continue; }
    if (/^###\s/.test(line)) { inDecisionLog = true; continue; }
    if (!current || inDecisionLog) continue;
    const f = line.match(FIELD);
    if (f) applyField(current, f[1], f[2]);
  }
  return { ...header, tasks };
}

// Criteria are the R<n>.<m> IDs that start a list item or line, e.g. "- R1.1: When ...".
export function parseRequirements(text) {
  const criteria = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*]|\d+\.)?\s*(?:\*\*)?(R\d+\.\d+)\b/);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      const tag = line.match(/\[(unit|integration|e2e|eval|manual)\]/i);
      criteria.push({ id: m[1], verifyBy: tag ? tag[1].toLowerCase() : null });
    }
  }
  return criteria;
}

export function coverage(criteria, tasks) {
  const known = new Set(criteria.map((c) => c.id));
  const covered = new Map();
  const unknown = [];
  for (const t of tasks) {
    for (const id of t.covers) {
      if (!known.has(id)) unknown.push({ task: t.id, id });
      if (!covered.has(id)) covered.set(id, []);
      covered.get(id).push(t.id);
    }
  }
  const matrix = criteria.map((c) => ({ id: c.id, tasks: covered.get(c.id) || [] }));
  return {
    matrix,
    uncovered: matrix.filter((r) => r.tasks.length === 0).map((r) => r.id),
    unknown,
  };
}

export function taskProblems(tasks) {
  const ids = new Set(tasks.map((t) => t.id));
  const problems = [];
  const dup = tasks.map((t) => t.id).filter((id, i, a) => a.indexOf(id) !== i);
  for (const id of new Set(dup)) problems.push(`duplicate task id ${id}`);
  for (const t of tasks) {
    for (const d of t.depends) if (!ids.has(d)) problems.push(`${t.id} depends on unknown ${d}`);
    if (!STATUSES.includes(t.status)) problems.push(`${t.id} has unknown status "${t.status}"`);
    if (t.verify.length === 0) problems.push(`${t.id} has no Verify check`);
  }
  return problems;
}

export function loadSpec(specDir) {
  const tasksText = readText(path.join(specDir, 'tasks.md'));
  if (tasksText === null) throw new CliError(`tasks.md not found in ${specDir}`);
  const reqText = readText(path.join(specDir, 'requirements.md'));
  const parsed = parseTasks(tasksText);
  const criteria = reqText === null ? null : parseRequirements(reqText);
  return { ...parsed, criteria };
}
