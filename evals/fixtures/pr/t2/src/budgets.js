// Monthly budgets per category (docs/specs/01-monthly-budgets). Amounts are integers in COP.

export function parseBudgets(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('budgets must be an object');
  const out = new Map();
  for (const [category, amount] of Object.entries(obj)) {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error(`invalid budget for category "${category}"`);
    out.set(category, amount);
  }
  return out;
}

// R2.1, R2.2, R2.3: one row per category with spending or a budget.
export function compare(byCategory, budgets) {
  const categories = new Set([...Object.keys(byCategory), ...budgets.keys()]);
  return [...categories].map((category) => {
    const spent = byCategory[category] || 0;
    const budget = budgets.has(category) ? budgets.get(category) : null;
    if (budget === null) return { category, spent, budget, diff: null, status: 'sin tope' };
    return { category, spent, budget, diff: budget - spent, status: spent > budget ? 'excedido' : 'ok' };
  });
}
