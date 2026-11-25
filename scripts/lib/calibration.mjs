// PLAN-1.0 G2 (DESIGN 33.2): calibration mode. The project's eval is the gate: each iteration
// records its score and cost; an iteration stays only when it beats the best so far, and the loop
// stops at the cost cap or after three iterations without improvement. Machine-local state in
// .rockbuilt/calibration/<task>.jsonl (one JSON line per iteration).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, now } from './util.mjs';

export const PLATEAU = 3;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function fileFor(root, task) {
  if (!TASK_ID.test(String(task || ''))) throw new CliError('task id: letters, digits, "-" or "_", up to 64 characters', 2);
  return path.join(root, '.rockbuilt', 'calibration', `${task}.jsonl`);
}

export function readCalibration(root, task) {
  const file = fileFor(root, task);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const better = (a, b, lower) => (lower ? a < b : a > b);

// The state after a list of entries: best kept iteration, money spent, iterations since the last
// improvement, and why it stopped (null while it may continue).
export function calibrationState(entries) {
  if (!entries.length) return { iterations: 0, best: null, spent: 0, cap: null, lowerIsBetter: false, sinceImprovement: 0, stop: null };
  const { cap, lowerIsBetter } = entries[0];
  let best = null;
  let spent = 0;
  let since = 0;
  for (const e of entries) {
    spent += e.cost;
    if (e.kept) { best = e; since = 0; } else since += 1;
  }
  spent = Math.round(spent * 1e6) / 1e6;
  const stop = spent >= cap ? 'cap' : since >= PLATEAU ? 'plateau' : null;
  return { iterations: entries.length, best: best && { iteration: best.iteration, score: best.score, ref: best.ref }, spent, cap, lowerIsBetter, sinceImprovement: since, stop };
}

function number(v, name, { min = -Infinity, positive = false } = {}) {
  const n = Number(v);
  if (v === undefined || v === null || v === true || String(v).trim() === '' || !Number.isFinite(n) || n < min || (positive && n <= 0)) throw new CliError(`--${name} needs a ${positive ? 'positive ' : min === 0 ? 'non-negative ' : ''}number`, 2);
  return n;
}

// Records one iteration. The cap and the direction are fixed by the first iteration: a later call
// may not change them (raising the cap is the owner's cost decision: a new calibration name).
// `prior`: the iterations recorded on the task issue (a fresh container has no local file); the
// longer history wins, so a new session never restarts the spend at zero.
export function addIteration(root, task, { score, cost, cap, lowerIsBetter = false, ref = null, prior = [] } = {}) {
  const file = fileFor(root, task);
  const s = number(score, 'score');
  const k = number(cost, 'cost', { min: 0 });
  const capN = number(cap, 'cap', { positive: true });
  if (!/^[0-9a-f]{7,40}$/i.test(String(ref ?? ''))) throw new CliError('--ref <sha>: the commit of this iteration (a kept one is what the loop restores)', 2);
  const local = readCalibration(root, task);
  const entries = prior.length > local.length ? prior : local;
  const before = calibrationState(entries);
  if (entries.length) {
    if (capN !== before.cap) throw new CliError(`the cap of ${task} is ${before.cap} USD, fixed at its first iteration; a higher cap is the owner's decision (cost): start a new calibration (${task}-2) from the kept version once they approve it`, 2);
    if (Boolean(lowerIsBetter) !== before.lowerIsBetter) throw new CliError(`${task} was started ${before.lowerIsBetter ? 'with' : 'without'} --lower-is-better; the direction cannot change`, 2);
    if (before.stop) throw new CliError(`${task} already stopped (${before.stop}): run the normal review on the kept iteration ${before.best ? before.best.iteration : '(none)'}`, 3);
  }
  const kept = !before.best || better(s, before.best.score, Boolean(lowerIsBetter));
  const entry = { at: now().toISOString(), iteration: entries.length + 1, score: s, cost: k, cap: capN, lowerIsBetter: Boolean(lowerIsBetter), ref, kept };
  mkdirSync(path.dirname(file), { recursive: true });
  if (entries !== local) writeFileSync(file, entries.map((e) => `${JSON.stringify(e)}\n`).join(''));
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
  const after = calibrationState([...entries, entry]);
  return { task, iteration: entry.iteration, score: s, kept, entry, ...after, remaining: Math.max(0, Math.round((after.cap - after.spent) * 1e6) / 1e6), next: after.stop ? 'stop' : 'continue' };
}

// One iteration as a machine line on the task issue, and back.
export function calibrationLine(task, e) {
  return `<!-- rockbuilt:calibration task=${task} iteration=${e.iteration} score=${e.score} cost=${e.cost} cap=${e.cap} lower=${e.lowerIsBetter ? 1 : 0} ref=${e.ref} kept=${e.kept ? 1 : 0} -->`;
}

export function entriesFromComments(comments, task) {
  const out = new Map();
  for (const cm of comments) {
    if (!['OWNER', 'MEMBER', 'COLLABORATOR'].includes(cm.author_association)) continue;
    for (const m of String(cm.body || '').matchAll(/<!--\s*rockbuilt:calibration\s+([^>]*?)\s*-->/g)) {
      const kv = Object.fromEntries([...m[1].matchAll(/([\w-]+)=(\S+)/g)].map((x) => [x[1], x[2]]));
      if (kv.task !== task) continue;
      const e = { at: cm.created_at, iteration: Number(kv.iteration), score: Number(kv.score), cost: Number(kv.cost), cap: Number(kv.cap), lowerIsBetter: kv.lower === '1', ref: kv.ref, kept: kv.kept === '1' };
      if ([e.iteration, e.score, e.cost, e.cap].every(Number.isFinite) && !out.has(e.iteration)) out.set(e.iteration, e);
    }
  }
  const list = [...out.values()].sort((a, b) => a.iteration - b.iteration);
  // Only a gapless history from iteration 1 counts.
  return list.filter((e, i) => e.iteration === i + 1);
}

export function calibrationText(r) {
  const best = r.best ? `best: iteration ${r.best.iteration}, score ${r.best.score}${r.best.ref ? ` at ${String(r.best.ref).slice(0, 7)}` : ''}` : 'best: none';
  const head = r.iteration ? `iteration ${r.iteration}: score ${r.score} ${r.kept ? 'kept (improves the best)' : 'discarded (does not improve the best): restore the kept version'}` : `${r.iterations} iteration(s)`;
  const stop = r.stop === 'cap' ? 'stop: the cost cap is reached; review the kept version' : r.stop === 'plateau' ? `stop: ${PLATEAU} iterations without improvement; review the kept version` : 'continue';
  return [head, best, `spent ${r.spent} of ${r.cap} USD`, stop].join('\n');
}
