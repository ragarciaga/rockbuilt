// tasks.md and requirements.md parsing (DESIGN.md section 15).
import path from 'node:path';
import { CliError, readText } from './util.mjs';

const TASK_HEADING = /^##\s+(T\d+)\s*[:.-]?\s*(.*)$/;
const FIELD = /^\s*[-*]\s+(\p{L}[\p{L} /]*?)\s*:\s*(.*)$/u;
const CRITERION_ID = /\bR\d+\.\d+\b/g;
const TASK_ID = /\bT\d+\b/g;

export const STATUSES = ['todo', 'in-progress', 'in-review', 'done', 'blocked'];
export const STATUS_DONE_ES = 'hecho';

// Canonical key for each accepted spelling (lowercase, accents kept and stripped).
export const KEY_SYNONYMS = {
  purpose: 'purpose', 'propósito': 'purpose', proposito: 'purpose',
  covers: 'covers', cubre: 'covers',
  size: 'size', 'tamaño': 'size', tamano: 'size',
  'depends on': 'depends on', 'depende de': 'depends on',
  files: 'files', archivos: 'files',
  verify: 'verify', verificar: 'verify',
  issue: 'issue', incidencia: 'issue',
  status: 'status', estado: 'status',
};
const SPANISH_KEYS = new Set(['propósito', 'proposito', 'cubre', 'tamaño', 'tamano', 'depende de', 'archivos', 'verificar', 'incidencia', 'estado']);

export const STATUS_SYNONYMS = {
  todo: 'todo', 'to-do': 'todo', pending: 'todo', pendiente: 'todo',
  'in-progress': 'in-progress', 'in progress': 'in-progress', 'en progreso': 'in-progress', 'en-progreso': 'in-progress',
  'in-review': 'in-review', 'in review': 'in-review', 'en revisión': 'in-review', 'en revision': 'in-review', 'en-revision': 'in-review', 'en-revisión': 'in-review',
  done: 'done', hecho: 'done',
  blocked: 'blocked', bloqueado: 'blocked',
};
const SPANISH_STATUSES = new Set(['pendiente', 'en progreso', 'en-progreso', 'en revisión', 'en revision', 'en-revision', 'en-revisión', 'hecho', 'bloqueado']);

function splitList(value) {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// "src/a.ts, src/a.test.ts           (expected touch list...)" -> ["src/a.ts", "src/a.test.ts"]
export function parseFiles(value) {
  const cleaned = value.replace(/\s{2,}\(.*\)\s*$/, '').replace(/`/g, '');
  if (/^(none|ninguno|n\/a|-)?$/i.test(cleaned.trim())) return [];
  return splitList(cleaned).map((f) => f.replace(/\\/g, '/').replace(/^\.\//, ''));
}

function parseVerify(value) {
  const cleaned = value.replace(/\s{2,}\(.*\)\s*$/, '');
  const ticks = [...cleaned.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const rest = cleaned.replace(/`[^`]+`/g, '').split(/[;]/).map((s) => s.trim()).filter(Boolean);
  return [...ticks, ...rest];
}

// Canonical status, or { raw } when unknown. Tries the whole value, then two words, then one.
export function normalizeStatus(value) {
  const v = value.toLowerCase().replace(/[`*_]/g, '').replace(/\s*\(.*$/, '').replace(/\s+#.*$/, '').trim().replace(/\s+/g, ' ');
  const words = v.split(' ');
  for (const cand of [v, words.slice(0, 2).join(' '), words[0]]) {
    const c = cand.replace(/[.,;:]+$/, '');
    if (STATUS_SYNONYMS[c]) return { status: STATUS_SYNONYMS[c], spanish: SPANISH_STATUSES.has(c) };
  }
  return { status: null, raw: v };
}

function emptyTask(id, title) {
  return {
    id, title, purpose: '', covers: [], size: null, depends: [], files: [], verify: [], issue: null, status: 'todo',
  };
}

function applyField(task, key, value) {
  switch (key) {
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
    default: break;
  }
}

// Strict parser: unknown keys and statuses become errors (DESIGN.md section 15).
export function parseTasks(text) {
  const lines = text.split(/\r?\n/);
  const header = { feature: null, spec: null, status: null };
  const titleMatch = text.match(/^#\s+(?:Tasks|Tareas):\s*(.+)$/m);
  if (titleMatch) header.feature = titleMatch[1].trim();
  const specMatch = text.match(/^Spec:\s*([^|\n]+)/m);
  if (specMatch) header.spec = specMatch[1].trim();
  const statusMatch = text.match(/\|\s*(?:Status|Estado):\s*([A-Za-z-]+)/);
  if (statusMatch) header.status = statusMatch[1].toLowerCase();

  const tasks = [];
  const errors = [];
  let spanishStatus = false;
  let current = null;
  let inDecisionLog = false;
  lines.forEach((line, idx) => {
    const h = line.match(TASK_HEADING);
    if (h) {
      current = emptyTask(h[1], h[2].trim());
      tasks.push(current);
      inDecisionLog = false;
      return;
    }
    if (/^##\s/.test(line)) { current = null; return; }
    if (/^###\s/.test(line)) { inDecisionLog = true; return; }
    if (!current || inDecisionLog) return;
    const f = line.match(FIELD);
    if (!f) return;
    const rawKey = f[1].trim().toLowerCase().replace(/\s+/g, ' ');
    const key = KEY_SYNONYMS[rawKey];
    if (!key) { errors.push(`${current.id} line ${idx + 1}: unknown key "${f[1].trim()}"`); return; }
    if (SPANISH_KEYS.has(rawKey) && key === 'status') spanishStatus = true;
    if (key === 'status') {
      const s = normalizeStatus(f[2]);
      if (s.status) {
        current.status = s.status;
        if (s.spanish) spanishStatus = true;
      } else {
        current.status = s.raw || '';
        errors.push(`${current.id} line ${idx + 1}: unknown status "${f[2].trim()}" (use ${STATUSES.join(', ')})`);
      }
      return;
    }
    applyField(current, key, f[2]);
  });
  return { ...header, tasks, errors, spanishStatus };
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

export function taskProblems(tasks, errors = []) {
  const ids = new Set(tasks.map((t) => t.id));
  const problems = [...errors];
  const dup = tasks.map((t) => t.id).filter((id, i, a) => a.indexOf(id) !== i);
  for (const id of new Set(dup)) problems.push(`duplicate task id ${id}`);
  for (const t of tasks) {
    for (const d of t.depends) if (!ids.has(d)) problems.push(`${t.id} depends on unknown ${d}`);
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
