// PLAN-1.0 E1: rb spec check refuses a requirements.md whose decision inventory is incomplete.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { inventoryProblems, parseInventory } from '../scripts/lib/inventory.mjs';
import { cleanup, rbJson, repoWith } from './rb-helpers.mjs';

after(cleanup);

const full = (id, extra = '') => `## ${id}: Alerts
As a vet, I want alerts.

- ${id}.1 When a case is submitted, the system shall alert on-duty vets. \`[unit]\`

### Decisions
- Numbers: up to 10 retries per vet per case (default)
- Timing: retry every minute; give up after 2 hours (owner)
- What if: a send fails 10 times, the case shows "not delivered" (default)
- Who can: any logged-in vet sees the case list (owner)
- Data: n/a: alerts store no personal data
- Definitions: "on duty" means inside the working hours in Settings (default)${extra}
`;

test('E1: a complete inventory passes; missing, empty or reasonless n/a lines fail', () => {
  assert.deepEqual(inventoryProblems(`# Requirements\n\n${full('R1')}\n${full('R2')}`), []);
  assert.equal(parseInventory(full('R1'))[0].decisions.whoCan, 'any logged-in vet sees the case list (owner)');
  const missing = inventoryProblems(full('R1').replace(/- Timing:.*\n/, ''));
  assert.ok(missing.some((p) => /R1 Decisions: missing "Timing"/.test(p)));
  assert.ok(inventoryProblems(full('R1').replace('- Numbers: up to 10 retries per vet per case (default)', '- Numbers: <threshold>')).some((p) => /placeholder/.test(p)));
  assert.ok(inventoryProblems(full('R1').replace('n/a: alerts store no personal data', 'n/a')).some((p) => /without a reason/.test(p)));
  assert.ok(inventoryProblems('## R1: x\n- R1.1 The system shall x. `[unit]`\n').some((p) => /R1 has no "### Decisions" block/.test(p)));
  const es = full('R1').replace('### Decisions', '### Decisiones').replace('- Numbers:', '- Números:').replace('- Timing:', '- Tiempos:').replace('- What if:', '- Qué pasa si:').replace('- Who can:', '- Quién puede:').replace('- Data:', '- Datos:').replace('- Definitions:', '- Definiciones:');
  assert.deepEqual(inventoryProblems(es), [], 'Spanish headings and keys');
});

test('E1: rb spec check exits 3 with the problems, 0 when complete', async () => {
  const root = repoWith({ 'docs/specs/01-x/requirements.md': `# Requirements\n\n${full('R1')}`, 'docs/specs/02-y/requirements.md': '# R\n\n## R1: x\n- R1.1 The system shall x. `[unit]`\n' });
  const ok = await rbJson(root, ['spec', 'check', 'docs/specs/01-x']);
  assert.equal(ok.code, 0, ok.err);
  const bad = await rbJson(root, ['spec', 'check', 'docs/specs/02-y']);
  assert.equal(bad.code, 3);
  assert.ok(bad.json.problems.some((p) => /no "### Decisions" block/.test(p)));
});

test('independent review of 1.2.0: the shipped template fails; marks are required; odd headings and sub-bullets', async () => {
  const { readFileSync } = await import('node:fs');
  const tpl = readFileSync(new URL('../harness/skills/rb-spec/templates/requirements.md', import.meta.url), 'utf8');
  assert.ok(inventoryProblems(tpl).length > 0, 'the unedited template never passes');
  assert.ok(inventoryProblems(full('R1').replace('up to 10 retries per vet per case (default)', 'up to 10 retries')).some((p) => /does not end with \(default\) or \(owner\)/.test(p)));
  assert.ok(inventoryProblems(full('R1').replace('up to 10 retries per vet per case (default)', 'TBD (default)')).some((p) => /placeholder/.test(p)));
  assert.ok(inventoryProblems(`${full('R1')}\n## R2 - Other\n- R2.1 The system shall y. \`[unit]\`\n`).some((p) => /R2 has no/.test(p)), 'a heading typo does not skip R2');
  const sub = full('R1').replace('- Numbers: up to 10 retries per vet per case (default)', '- Numbers:\n  - up to 10 retries per vet per case (default)').replace('### Decisions', '### Decisions (R1)');
  assert.deepEqual(inventoryProblems(sub), [], 'sub-bullets and a heading suffix are fine');
});
