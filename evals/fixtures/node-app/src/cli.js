// Minimal CLI: node src/cli.js <expenses.json> [YYYY-MM]
import { readFileSync } from 'node:fs';
import { byCategory, inMonth, total } from './expenses.js';

const [file, month] = process.argv.slice(2);
if (!file) {
  console.error('usage: node src/cli.js <expenses.json> [YYYY-MM]');
  process.exit(2);
}
let list = JSON.parse(readFileSync(file, 'utf8'));
if (month) list = inMonth(list, month);
console.log(JSON.stringify({ total: total(list), byCategory: byCategory(list) }, null, 2));
