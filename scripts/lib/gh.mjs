// GitHub helpers: gh availability and the label set (DESIGN.md section 10, Labels).
import { CliError, gh } from './util.mjs';

export const LABELS = [
  { name: 'rb:task', color: '1d76db', description: 'Rockbuilt task from a spec' },
  { name: 'rb:skeleton', color: '5319e7', description: 'Walking skeleton task' },
  { name: 'rb:bug', color: 'd73a4a', description: 'Bug handled by the fix path' },
  { name: 'rb:blocked', color: 'b60205', description: 'Needs a human answer or failed after the kickback budget' },
  { name: 'rb:in-progress', color: 'fbca04', description: 'Being planned or implemented' },
  { name: 'rb:pr-open', color: '0e8a16', description: 'Pull request open, awaiting human review' },
  { name: 'rb:parallel-safe', color: 'c5def5', description: 'Can run in a parallel batch (informational)' },
];

// { installed, authenticated, detail }
export function ghStatus(cwd) {
  const v = gh(cwd, ['--version']);
  if (v.missing || (!v.ok && v.status === null)) return { installed: false, authenticated: false, detail: 'gh not found on PATH' };
  const a = gh(cwd, ['auth', 'status']);
  if (!a.ok) {
    const lines = (a.stderr || a.stdout).split(/\r?\n/).map((l) => l.trim().replace(/^[Xx!]\s+/, '')).filter(Boolean);
    const line = lines.find((l) => /fail|not logged|error|invalid|expired/i.test(l)) || 'not authenticated; run `gh auth login`';
    return { installed: true, authenticated: false, detail: line };
  }
  return { installed: true, authenticated: true, detail: 'authenticated' };
}

export function ensureLabels(cwd) {
  const s = ghStatus(cwd);
  if (!s.installed) throw new CliError('gh is not installed; install GitHub CLI and run `gh auth login`');
  if (!s.authenticated) throw new CliError(`gh is not authenticated (${s.detail}); run \`gh auth login\``);
  const results = [];
  for (const l of LABELS) {
    const r = gh(cwd, ['label', 'create', l.name, '--color', l.color, '--description', l.description, '--force']);
    results.push({ name: l.name, ok: r.ok, error: r.ok ? null : r.stderr || r.stdout });
  }
  return results;
}

export function missingLabels(cwd) {
  const r = gh(cwd, ['label', 'list', '--limit', '200', '--json', 'name']);
  if (!r.ok) return null;
  try {
    const names = new Set(JSON.parse(r.stdout).map((x) => x.name));
    return LABELS.map((l) => l.name).filter((n) => !names.has(n));
  } catch {
    return null;
  }
}
