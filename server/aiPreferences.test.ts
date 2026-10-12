import assert from 'node:assert/strict';
import test from 'node:test';
import { aiCapabilities, aiStylePrompt, resolveAiPreferences } from './aiPreferences.js';
import type { LLMSetup } from './llm.js';

const llm: LLMSetup = { provider: 'anthropic', model: 'configured-default', client: null };
const preferences = { model: 'haiku', tone: 'detailed', timeZone: 'America/Chicago' };

test('AI preferences preserve the configured default and expose only configured alternatives', () => {
  assert.deepEqual(aiCapabilities(llm, {}), { defaultModel: 'haiku', availableModels: [{ value: 'haiku', modelId: 'configured-default' }] });
  assert.equal(resolveAiPreferences(preferences, llm, {}).llm.model, 'configured-default');
  assert.equal(resolveAiPreferences({ ...preferences, model: 'sonnet' }, llm, { ASK_MODEL_SONNET: ' configured-sonnet ' }).llm.model, 'configured-sonnet');
  assert.throws(() => resolveAiPreferences({ ...preferences, model: 'opus' }, llm, {}), /not configured/);
});

test('AI preferences reject malformed values and produce a concrete style instruction', () => {
  for (const raw of [null, [], {}, { ...preferences, tone: 'anything' }, { ...preferences, timeZone: 'invalid' }, { ...preferences, tone: ['detailed'] }, { ...preferences, model: ['haiku'] }, { ...preferences, timeZone: ['UTC'] }, { ...preferences, extra: true }]) {
    assert.throws(() => resolveAiPreferences(raw, llm, {}), TypeError);
  }
  const resolved = resolveAiPreferences(preferences, llm, {}).preferences;
  assert.match(aiStylePrompt(resolved), /detailed explanation/);
  assert.match(aiStylePrompt(resolved), /America\/Chicago/);
  assert.equal(resolveAiPreferences(undefined, llm, {}).llm, llm);
});
