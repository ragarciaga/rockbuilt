// Decision inventory (PLAN-1.0 E1, DESIGN 31.1). Every requirement of a spec carries a
// `### Decisions` (or `### Decisiones`) block with six lines: numbers and thresholds, timing,
// what if (failures, cancellations, duplicates, caps), who can, data (retention, deletion,
// redaction) and definitions (metrics). Each says the decision, or `n/a: <why>`. The checks are
// mechanical, after trail-blazer-flow's decision record: required lines, with content.
// Evidence: 18 of Doorcas's 22 escalations were gaps the spec left open (thresholds, timers,
// retries, who sees a phone number, retention), each one a category below.
export const CATEGORIES = [
  { key: 'numbers', en: 'Numbers', es: 'Números' },
  { key: 'timing', en: 'Timing', es: 'Tiempos' },
  { key: 'whatIf', en: 'What if', es: 'Qué pasa si' },
  { key: 'whoCan', en: 'Who can', es: 'Quién puede' },
  { key: 'data', en: 'Data', es: 'Datos' },
  { key: 'definitions', en: 'Definitions', es: 'Definiciones' },
];

const HEADING = /^###\s+(Decisions|Decisiones)\s*$/i;
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').trim();

// The requirements of a requirements.md text, each with its decisions block (or null). A
// requirement is any `## R<n>` heading, and any `R<n>` that criteria name (`- R2.1 ...`) even
// under an odd heading, so a heading typo cannot skip the check (independent review of 1.2.0).
const HEADING_ANY = /^###\s+(Decisions|Decisiones)\b/i;
export function parseInventory(text) {
  const reqs = [];
  const byId = new Map();
  const get = (id) => { if (!byId.has(id)) { const r = { id, decisions: null }; byId.set(id, r); reqs.push(r); } return byId.get(id); };
  let cur = null;
  let inBlock = false;
  let last = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const r = line.match(/^##\s+(R\d+)\b/);
    if (r) { cur = get(r[1]); inBlock = false; last = null; continue; }
    if (/^##\s/.test(line)) { cur = null; inBlock = false; continue; }
    const crit = line.match(/^\s*[-*]\s*(R\d+)\.\d+\b/);
    if (crit && (!cur || cur.id !== crit[1])) cur = get(crit[1]);
    if (!cur) continue;
    if (HEADING_ANY.test(line)) { cur.decisions = cur.decisions || {}; inBlock = true; last = null; continue; }
    if (/^###\s/.test(line)) { inBlock = false; continue; }
    if (!inBlock) continue;
    const m = line.match(/^\s*[-*]\s*\**([^:*]+?)\**:\s*(.*)$/);
    const cat = m ? CATEGORIES.find((c) => norm(c.en) === norm(m[1]) || norm(c.es) === norm(m[1])) : null;
    if (cat && /^[-*]/.test(line.trim()) && !/^\s{2,}/.test(line)) { cur.decisions[cat.key] = m[2].trim(); last = cat.key; continue; }
    // An indented line continues the previous decision (sub-bullets).
    if (last && /^\s{2,}\S/.test(line)) cur.decisions[last] = `${cur.decisions[last]} ${line.trim()}`.trim();
  }
  return reqs;
}

const PLACEHOLDER = /<[^>]*>|^[.\-–\s]+$|\(default\|owner\)|\b(tbd|todo|pendiente|pending|por definir)\b|^\?+$/i;
const MARK = /\((default|owner|por defecto|dueño|dueno)\)\s*$/i;

// Problems that keep a spec from approval; [] when complete.
export function inventoryProblems(text) {
  const problems = [];
  const reqs = parseInventory(text);
  if (!reqs.length) return ['no requirements (## R1: ...) found'];
  for (const r of reqs) {
    if (!r.decisions) { problems.push(`${r.id} has no "### Decisions" block`); continue; }
    for (const c of CATEGORIES) {
      const v = r.decisions[c.key];
      if (v === undefined) { problems.push(`${r.id} Decisions: missing "${c.en}" (${c.es})`); continue; }
      const na = /^(n\/a|na|no aplica)\b/i.test(v);
      if (!v || PLACEHOLDER.test(v)) problems.push(`${r.id} Decisions: "${c.en}" is empty or a placeholder`);
      else if (na && !/^(n\/a|na|no aplica)\s*[:(-]\s*\S+(\s+\S+){2,}/i.test(v)) problems.push(`${r.id} Decisions: "${c.en}" says n/a without a reason of three or more words`);
      else if (!na && !MARK.test(v)) problems.push(`${r.id} Decisions: "${c.en}" does not end with (default) or (owner)`);
    }
  }
  return problems;
}
