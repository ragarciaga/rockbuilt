// PLAN-1.0 G2 (DESIGN 33.2): calibration mode. The project's eval is the gate: each iteration
// records its score and cost; an iteration stays only when it beats the best so far, and the loop
// stops at the cost cap or after three iterations without improvement. Machine-local state in
// .rockbuilt/calibration/<task>.jsonl (one JSON line per iteration).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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
export function addIteration(root, task, { score, cost, cap, lowerIsBetter = false, ref = null } = {}) {
  const file = fileFor(root, task);
  const s = number(score, 'score');
  const k = number(cost, 'cost', { min: 0 });
  const capN = number(cap, 'cap', { positive: true });
  if (ref !== null && !/^[0-9a-f]{7,40}$/i.test(String(ref))) throw new CliError('--ref is a commit sha', 2);
  const entries = readCalibration(root, task);
  const before = calibrationState(entries);
  if (entries.length) {
    if (capN !== before.cap) throw new CliError(`the cap of ${task} is ${before.cap} USD, fixed at its first iteration; a higher cap is the owner's decision (cost): start a new calibration (${task}-2) from the kept version once they approve it`, 2);
    if (Boolean(lowerIsBetter) !== before.lowerIsBetter) throw new CliError(`${task} was started ${before.lowerIsBetter ? 'with' : 'without'} --lower-is-better; the direction cannot change`, 2);
    if (before.stop) throw new CliError(`${task} already stopped (${before.stop}): run the normal review on the kept iteration ${before.best ? before.best.iteration : '(none)'}`, 3);
  }
  const kept = !before.best || better(s, before.best.score, Boolean(lowerIsBetter));
  const entry = { at: now().toISOString(), iteration: entries.length + 1, score: s, cost: k, cap: capN, lowerIsBetter: Boolean(lowerIsBetter), ref, kept };
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
  const after = calibrationState([...entries, entry]);
  return { task, iteration: entry.iteration, score: s, kept, ...after, remaining: Math.max(0, Math.round((after.cap - after.spent) * 1e6) / 1e6), next: after.stop ? 'stop' : 'continue' };
}

export function calibrationText(r) {
  const best = r.best ? `best: iteration ${r.best.iteration}, score ${r.best.score}${r.best.ref ? ` at ${String(r.best.ref).slice(0, 7)}` : ''}` : 'best: none';
  const head = r.iteration ? `iteration ${r.iteration}: score ${r.score} ${r.kept ? 'kept (improves the best)' : 'discarded (does not improve the best): restore the kept version'}` : `${r.iterations} iteration(s)`;
  const stop = r.stop === 'cap' ? 'stop: the cost cap is reached; review the kept version' : r.stop === 'plateau' ? `stop: ${PLATEAU} iterations without improvement; review the kept version` : 'continue';
  return [head, best, `spent ${r.spent} of ${r.cap} USD`, stop].join('\n');
}
