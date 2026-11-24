// Dependency check (PLAN-1.0 A7, DESIGN 29.9). A runtime dependency added outside the approved
// design is checked by code: license, deprecation and maintenance. Dev and test dependencies are
// free; one named in an approved design.md or ADR is approved already. A failed check, or a
// manifest this check cannot read (Python, Go, Ruby...), asks the owner (`dependency`).
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { git, readText } from './util.mjs';

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
      // Added, or changed to another spec (adversarial review of 1.0: "^4" -> "npm:evil@1" or a
      // tarball URL passed as a version bump).
      const add = c.match(/^added (.+?)@(.+) \((dependencies|optionalDependencies|peerDependencies|bundleDependencies|bundledDependencies)\)$/);
      const chg = c.match(/^(.+?) (.+) -> (.+) \((dependencies|optionalDependencies|peerDependencies|bundleDependencies|bundledDependencies)\)$/);
      if (add) out.push({ name: add[1], range: add[2], manifest: r.path });
      else if (chg) out.push({ name: chg[1], range: chg[3], manifest: r.path, changed: true });
    }
  }
  return { deps: out, unsupported };
}

// Names the approved design lists as dependencies: backticked names on list or table lines under a
// heading about dependencies, libraries or the stack, in design.md files and ADRs read at `ref`
// (the PR base; adversarial review of 1.0: a mention anywhere, or a design edited by the PR itself,
// must not pre-approve). Without `ref` (rb deps on a branch), the working tree.
const DEP_HEADING = /^#{1,6}\s.*(dependenc|librar|librer|stack|paquete|package)/i;
export function designDependencies(texts) {
  const names = new Set();
  for (const text of texts) {
    let inside = false;
    for (const line of String(text).split(/\r?\n/)) {
      if (/^#{1,6}\s/.test(line)) { inside = DEP_HEADING.test(line); continue; }
      if (inside && /^\s*([-*]|\|)/.test(line)) for (const m of line.matchAll(/`(@?[a-z0-9][\w.@/-]*)`/gi)) names.add(m[1].replace(/@[\^~<>=\d].*$/, ''));
    }
  }
  return names;
}

function designTexts(root, ref) {
  const pick = (p) => /^docs\/specs\/[^/]+\/design\.md$/.test(p) || /^docs\/adr\/[^/]+\.md$/.test(p);
  if (ref) {
    if (!git(root, ['cat-file', '-e', `${ref}^{commit}`]).ok) return [];
    const ls = git(root, ['ls-tree', '-r', '--name-only', ref, '--', 'docs/specs', 'docs/adr']);
    return ls.ok ? ls.stdout.split(/\r?\n/).filter(pick).map((p) => { const r = git(root, ['show', `${ref}:${p}`]); return r.ok ? r.stdout : ''; }) : [];
  }
  const texts = [];
  const walk = (dir) => {
    let names = [];
    try { names = readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      const rel = `${dir}/${d.name}`;
      if (d.isDirectory()) walk(rel);
      else if (pick(rel)) texts.push(readText(path.join(root, rel)) || '');
    }
  };
  walk('docs/specs');
  walk('docs/adr');
  return texts;
}

const NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const RANGE = /^[\w.^~<>=| *-]+$/;

function npmView(name, range) {
  const fixture = process.env.RB_DEPS_FIXTURE;
  if (fixture) {
    const all = JSON.parse(readText(fixture) || '{}');
    return all[name] || null;
  }
  // Never through a shell: name and range come from the PR (adversarial review of 1.0).
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['view', '--', `${name}@${range}`, 'license', 'deprecated', 'time.modified', '--json'], { encoding: 'utf8', shell: false, timeout: 30000 });
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
export function dependencyCheck(root, risk, { view = npmView, now = Date.now(), ref = null } = {}) {
  const { deps, unsupported } = addedRuntimeDeps(risk);
  const listed = designDependencies(designTexts(root, ref));
  const results = deps.map((d) => {
    // Only a registry semver range is checked; npm:, git, file and URL specs ask the owner.
    if (!NAME.test(d.name) || !RANGE.test(d.range)) return { ...d, inDesign: false, problems: [`spec ${d.name}@${d.range} is not a plain registry version: the owner decides`] };
    const inDesign = listed.has(d.name);
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
