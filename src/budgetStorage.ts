export const BUDGET_COLLECTIONS = [
  'settings', 'expenses', 'fixedExpenses', 'incomeRules',
  'incomes', 'exceptions', 'savingsGoals', 'debts',
] as const;

// Keep historical namespaces: changing a path does not move Firestore documents.
// Probe the subcollections, since their parent user document may not exist.
export async function resolveBudgetNamespaces(
  hasData: (namespace: string) => Promise<boolean>,
  configuredNamespace?: string,
): Promise<string[]> {
  if (configuredNamespace?.trim()) return [configuredNamespace.trim()];
  const candidates = ['default-app-id', 'ataraxia'];
  const populated = await Promise.all(candidates.map(hasData));
  const existing = candidates.filter((_, index) => populated[index]);
  return existing.length ? existing : ['ataraxia'];
}
