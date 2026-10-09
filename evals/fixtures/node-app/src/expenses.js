// Expense helpers. Amounts are integers in COP (no decimals).

export function addExpense(list, { description, amount, category, date }) {
  if (!description || typeof description !== 'string') throw new Error('description is required');
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('amount must be a positive integer');
  return [...list, { description, amount, category: category || 'otros', date: date || new Date().toISOString().slice(0, 10) }];
}

export function total(list) {
  return list.reduce((sum, e) => sum + e.amount, 0);
}

// Known bug (used by the fix evals): categories are grouped case-sensitively,
// so "Comida" and "comida" end up as two separate rows.
export function byCategory(list) {
  const out = {};
  for (const e of list) out[e.category] = (out[e.category] || 0) + e.amount;
  return out;
}

export function inMonth(list, yyyyMm) {
  return list.filter((e) => e.date.startsWith(yyyyMm));
}
