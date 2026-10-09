// Monthly budgets per category (T1 of docs/specs/01-monthly-budgets). Amounts are integers in COP.

export function parseBudgets(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('budgets must be an object');
  const out = new Map();
  for (const [category, amount] of Object.entries(obj)) {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error(`invalid budget for category "${category}"`);
    out.set(category, amount);
  }
  return out;
}
