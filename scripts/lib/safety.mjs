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

export function planSafetySteps(planText) {
  const body = section(planText, 'Safety steps');
  if (!body) return null;
  return body.filter((l) => /^\s*[-*]\s+/.test(l) && !/^\s*[-*]\s+none\b/i.test(l)).map((l) => {
    const m = l.replace(/^\s*[-*]\s+/, '').split('|');
    const t = (m[1] || '').trim().match(/^([^:]+?)(?::\s*(.+))?$/);
    return { step: m[0].trim(), testFile: t ? t[1].trim().replace(/`/g, '') : null, testCase: t && t[2] ? t[2].trim().replace(/^["`']|["`']$/g, '') : null };
  });
}

export function safetyCheck(root, planText, reportText) {
  const steps = planSafetySteps(planText);
  if (steps === null) return { ok: false, problems: ['the plan has no "## Safety steps" section (write "None" when there is none)'], steps: [] };
  const problems = [];
  const evidence = (reportText || '').split(/\r?\n/).filter((l) => /safety step/i.test(l) || /\|\s*failed:/i.test(l)).join('\n');
  for (const s of steps) {
    if (!s.testFile) { problems.push(`"${s.step}" names no test (| <test file>: <case>)`); continue; }
    const text = readText(path.join(root, s.testFile));
    if (text === null) { problems.push(`"${s.step}": test file ${s.testFile} does not exist`); continue; }
    if (s.testCase && !text.includes(s.testCase)) problems.push(`"${s.step}": ${s.testFile} has no case "${s.testCase}"`);
    const key = s.testCase || path.basename(s.testFile);
    const line = evidence.split('\n').find((l) => l.includes(key) || l.includes(s.step.slice(0, 30)));
    if (!line) problems.push(`"${s.step}": the implementer report shows no deletion check (Evidence, "Safety steps: <step> | <test>: deleted, failed: yes")`);
    else if (!/failed:\s*yes/i.test(line)) problems.push(`"${s.step}": deleting the step did not make ${key} fail: the step is not pinned`);
  }
  return { ok: problems.length === 0, problems, steps };
}
