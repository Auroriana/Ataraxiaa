import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBudgetNamespaces } from '../src/budgetStorage.ts';

test('existing Google user opens the original namespace after the path change', async () => {
  assert.deepEqual(await resolveBudgetNamespaces(async name => name === 'default-app-id'), ['default-app-id']);
});

test('users with only newer data keep their existing budget', async () => {
  assert.deepEqual(await resolveBudgetNamespaces(async name => name === 'ataraxia'), ['ataraxia']);
});

test('both budgets remain available, with the original first', async () => {
  assert.deepEqual(await resolveBudgetNamespaces(async () => true), ['default-app-id', 'ataraxia']);
});

test('a new account uses the current namespace', async () => {
  assert.deepEqual(await resolveBudgetNamespaces(async () => false), ['ataraxia']);
});

test('permission or network failures must not be mistaken for an empty budget', async () => {
  for (const failedNamespace of ['default-app-id', 'ataraxia']) {
    await assert.rejects(resolveBudgetNamespaces(async name => {
      if (name === failedNamespace) throw new Error('permission-denied');
      return true;
    }), /permission-denied/);
  }
});

test('an explicitly configured historical namespace is used for custom deployments', async () => {
  assert.deepEqual(await resolveBudgetNamespaces(async () => {
    assert.fail('Do not probe unrelated namespaces when explicitly configured');
  }, ' original-deployment '), ['original-deployment']);
});
