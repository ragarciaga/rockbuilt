#!/usr/bin/env node
// Grader helper: lists files under <dir> (default ".") that contain the em dash (U+2014).
// Exit 0 when none, 1 otherwise. Skips .git and node_modules.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const EM_DASH = String.fromCharCode(0x2014);
const root = path.resolve(process.argv[2] || '.');
const hits = [];
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile()) {
      const buf = readFileSync(full);
      if (!buf.includes(0) && buf.toString('utf8').includes(EM_DASH)) hits.push(path.relative(root, full));
    }
  }
}
walk(root);
if (hits.length) {
  console.log(`FAIL: em dash found in\n${hits.join('\n')}`);
  process.exit(1);
}
console.log('PASS: no em dash');
