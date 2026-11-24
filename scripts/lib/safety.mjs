// rb safety-check (PLAN-1.0 F3, DESIGN 32.3): before the verifier, every Safety step of the plan
// has its test, and the implementer's report shows that the test fails when the step is deleted.
// Most kickbacks in the five projects came from the verifier finding a safety rule with no test
// that pinned it; this check costs no agent.
import path from 'node:path';
import { readText } from './util.mjs';

function section(text, name) {
  const lines = String(text || '').split(/\r?\n/);
  const i = lines.findIndex((l) => new RegExp(`^##\\s+${name}\\s*$`, 'i').test(l.trim()));
  if (i === -1) return null;
  const out = [];
  for (let k = i + 1; k < lines.length && !/^##\s/.test(lines[k]); k++) out.push(lines[k]);
  return out;
}

const BULLET = /^\s*(?:[-*]|\d+[.)])\s+/;

// "- <step> (file, symbol) | <test file>: <case>"; the last " | " separates the test, so a "|"
// inside the step text does not break it.
export function planSafetySteps(planText) {
  const body = section(planText, 'Safety steps');
  if (!body) return null;
  return body.filter((l) => BULLET.test(l) && !/^\s*(?:[-*]|\d+[.)])\s+none\b/i.test(l)).map((l) => {
    const text = l.replace(BULLET, '').trim();
    const cut = text.lastIndexOf(' | ');
    const step = (cut === -1 ? text : text.slice(0, cut)).trim();
    const t = cut === -1 ? null : text.slice(cut + 3).trim().match(/^([^:]+?):\s*(.+)$/);
    return { step, testFile: t ? t[1].trim().replace(/`/g, '') : null, testCase: t ? t[2].trim().replace(/^["`']|["`']$/g, '') : null };
  });
}

// Every evidence line of the report under "Safety steps" (inline or nested bullets), split on ";"
// so one line cannot speak for two steps.
function evidenceSegments(reportText) {
  const lines = String(reportText || '').split(/\r?\n/);
  const out = [];
  let inside = false;
  for (const l of lines) {
    if (/^\s*[-*]\s*Safety steps\s*:/i.test(l)) { inside = true; const rest = l.replace(/^\s*[-*]\s*Safety steps\s*:/i, ''); if (rest.trim()) out.push(...rest.split(';')); continue; }
    if (inside && /^\s{2,}(?:[-*]|\d+[.)])\s+/.test(l)) { out.push(...l.split(';')); continue; }
    if (inside && l.trim() && !/^\s{2,}/.test(l)) inside = false;
  }
  return out.map((x) => x.trim()).filter(Boolean);
}

export function safetyCheck(root, planText, reportText) {
  const steps = planSafetySteps(planText);
  if (steps === null) return { ok: false, problems: ['the plan has no "## Safety steps" section (write "None" when there is none)'], steps: [] };
  const problems = [];
  const segments = evidenceSegments(reportText);
  for (const s of steps) {
    if (!s.testFile || !s.testCase) { problems.push(`"${s.step}" names no test and case (| <test file>: <case>)`); continue; }
    const text = readText(path.join(root, s.testFile));
    if (text === null) { problems.push(`"${s.step}": test file ${s.testFile} does not exist`); continue; }
    const quoted = new RegExp(`(test|it|describe|def\\s+test\\w*)\\s*\\(?\\s*["'\`]${s.testCase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    if (!quoted.test(text) && !text.includes(s.testCase)) problems.push(`"${s.step}": ${s.testFile} has no case "${s.testCase}"`);
    const seg = segments.find((x) => x.includes(s.testCase) && x.includes(s.step.slice(0, 25)));
    if (!seg) problems.push(`"${s.step}": the implementer report shows no deletion check for "${s.testCase}" (Evidence, "Safety steps: <step> | <test file>: <case>: deleted, failed: yes")`);
    else if (!/failed:\s*yes\b/i.test(seg)) problems.push(`"${s.step}": deleting the step did not make "${s.testCase}" fail: the step is not pinned`);
  }
  return { ok: problems.length === 0, problems, steps };
}
