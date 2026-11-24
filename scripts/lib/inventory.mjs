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

// The requirements of a requirements.md text, each with its decisions block (or null).
export function parseInventory(text) {
  const reqs = [];
  let cur = null;
  let inBlock = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    const r = line.match(/^##\s+(R\d+)\s*[:.]/);
    if (r) { cur = { id: r[1], decisions: null }; reqs.push(cur); inBlock = false; continue; }
    if (/^##\s/.test(line)) { cur = null; inBlock = false; continue; }
    if (!cur) continue;
    if (HEADING.test(line)) { cur.decisions = {}; inBlock = true; continue; }
    if (/^###\s/.test(line)) { inBlock = false; continue; }
    if (!inBlock) continue;
    const m = line.match(/^\s*[-*]\s*([^:]+):\s*(.*)$/);
    if (!m) continue;
    const cat = CATEGORIES.find((c) => norm(c.en) === norm(m[1]) || norm(c.es) === norm(m[1]));
    if (cat) cur.decisions[cat.key] = m[2].trim();
  }
  return reqs;
}

// Problems that keep a spec from approval; [] when complete.
export function inventoryProblems(text) {
  const problems = [];
  const reqs = parseInventory(text);
  if (!reqs.length) return ['no requirements (## R1: ...) found'];
  for (const r of reqs) {
    if (!r.decisions) { problems.push(`${r.id} has no "### Decisions" block`); continue; }
    for (const c of CATEGORIES) {
      const v = r.decisions[c.key];
      if (v === undefined) problems.push(`${r.id} Decisions: missing "${c.en}" (${c.es})`);
      else if (!v || /^<.*>$/.test(v) || /^(tbd|todo|pending|pendiente|\?+)$/i.test(v)) problems.push(`${r.id} Decisions: "${c.en}" is empty or a placeholder`);
      else if (/^(n\/a|na|no aplica)\b/i.test(v) && !/^(n\/a|na|no aplica)\s*[:(-]\s*\S+(\s+\S+){2,}/i.test(v)) problems.push(`${r.id} Decisions: "${c.en}" says n/a without a reason of three or more words`);
    }
  }
  return problems;
}
