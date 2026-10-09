// Suggests a category for an expense description (T1 of docs/specs/02-auto-categorize).
export const CATEGORIES = ['comida', 'transporte', 'hogar', 'salud', 'otros'];

export async function suggestCategory(description, llm) {
  try {
    const answer = String(await llm(`Categoria para: ${description}. Responde solo una de: ${CATEGORIES.join(', ')}`)).trim().toLowerCase();
    return CATEGORIES.includes(answer) ? answer : 'otros';
  } catch {
    return 'otros';
  }
}
