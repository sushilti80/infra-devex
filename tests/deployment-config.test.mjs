import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAzureTarget } from '../.github/workflows/scripts/validate_azure_target.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const options = { directory: 'infrastructure/demo/dev', subscriptionId: id, catalogConfig: JSON.stringify({ subscriptions: { dev: id } }) };
test('accepts a matching explicit subscription for the target environment', () => {
  assert.doesNotThrow(() => validateAzureTarget(options));
});
test('refuses missing, invalid, or mismatched Azure targets', () => {
  assert.throws(() => validateAzureTarget({ ...options, subscriptionId: '' }));
  assert.throws(() => validateAzureTarget({ ...options, catalogConfig: '{}' }));
  assert.throws(() => validateAzureTarget({ ...options, catalogConfig: '{' }));
  assert.throws(() => validateAzureTarget({ ...options, catalogConfig: JSON.stringify({ subscriptions: { dev: '22222222-2222-4222-8222-222222222222' } }) }));
  assert.throws(() => validateAzureTarget({ ...options, directory: 'infrastructure/../dev' }));
});
