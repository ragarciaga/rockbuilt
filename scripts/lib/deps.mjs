// Dependency check (PLAN-1.0 A7, DESIGN 29.9). A runtime dependency added outside the approved
// design is checked by code: license, deprecation and maintenance. Dev and test dependencies are
// free; one named in an approved design.md or ADR is approved already. A failed check, or a
// manifest this check cannot read (Python, Go, Ruby...), asks the owner (`dependency`).
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readText } from './util.mjs';

export const OK_LICENSES = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'Python-2.0', 'Zlib'];
export const STALE_DAYS = 730;
const LOCKFILES = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/;

export function addedRuntimeDeps(risk) {
  const out = [];
  const unsupported = [];
  for (const r of risk.reasons || []) {
    if (r.rule !== 'dependency') continue;
    if (!/package\.json$/.test(r.path)) { if (!LOCKFILES.test(r.path)) unsupported.push(r.path); continue; }
    for (const c of r.changes || []) {
      const m = c.match(/^added (.+?)@(.+) \((dependencies|optionalDependencies|peerDependencies)\)$/);
      if (m) out.push({ name: m[1], range: m[2], manifest: r.path });
    }
  }
  return { deps: out, unsupported };
}

function designText(root) {
  const texts = [];
  const read = (dir, pick) => {
    let names = [];
    try { names = readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      const rel = `${dir}/${d.name}`;
      if (d.isDirectory() && dir === 'docs/specs') read(rel, (n) => n === 'design.md');
      else if (d.isFile() && pick(d.name)) texts.push(readText(path.join(root, rel)) || '');
    }
  };
  read('docs/specs', () => false);
  read('docs/adr', (n) => n.endsWith('.md'));
  return texts.join('\n');
}

function npmView(name, range) {
  const fixture = process.env.RB_DEPS_FIXTURE;
  if (fixture) {
    const all = JSON.parse(readText(fixture) || '{}');
    return all[name] || null;
  }
  const r = spawnSync('npm', ['view', `${name}@${range}`, 'license', 'deprecated', 'time.modified', '--json'], { encoding: 'utf8', shell: process.platform === 'win32', timeout: 30000 });
  if (r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout || 'null');
    const one = Array.isArray(j) ? j[j.length - 1] : j;
    return one && typeof one === 'object' ? { license: one.license, deprecated: one.deprecated, modified: one['time.modified'] } : null;
  } catch { return null; }
}

export function checkPackage(meta, now = Date.now()) {
  if (!meta) return ['not found in the npm registry (or no network)'];
  const problems = [];
  const lic = typeof meta.license === 'string' ? meta.license : meta.license && meta.license.type;
  const parts = String(lic || '').replace(/[()]/g, '').split(/\s+OR\s+/i);
  if (!parts.some((p) => OK_LICENSES.includes(p.trim()))) problems.push(`license ${lic || 'unknown'} is not in the allowed list`);
  if (meta.deprecated) problems.push(`deprecated: ${String(meta.deprecated).slice(0, 120)}`);
  const t = Date.parse(meta.modified || '');
  if (Number.isFinite(t) && (now - t) / 86400000 > STALE_DAYS) problems.push(`no release since ${String(meta.modified).slice(0, 10)}`);
  return problems;
}

// { ok, results: [{ name, range, inDesign, problems }], unsupported }
export function dependencyCheck(root, risk, { view = npmView, now = Date.now() } = {}) {
  const { deps, unsupported } = addedRuntimeDeps(risk);
  const design = designText(root);
  const results = deps.map((d) => {
    const inDesign = new RegExp(`(^|[^\\w@/-])${d.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w/-]|$)`).test(design);
    return { ...d, inDesign, problems: inDesign ? [] : checkPackage(view(d.name, d.range), now) };
  });
  const ok = results.every((r) => !r.problems.length) && !unsupported.length;
  return { ok, results, unsupported };
}

export function depsText(r) {
  const lines = r.results.map((x) => `${x.name}@${x.range}: ${x.inDesign ? 'in the approved design' : x.problems.length ? x.problems.join('; ') : 'ok'}`);
  for (const u of r.unsupported) lines.push(`${u}: not checked automatically, the owner approves it`);
  if (!lines.length) lines.push('no runtime dependency added');
  return lines.join('\n');
}
