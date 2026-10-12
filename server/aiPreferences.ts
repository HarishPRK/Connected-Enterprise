import type { LLMSetup } from './llm.js';

export interface AiPreferences {
  model: 'haiku' | 'sonnet' | 'opus';
  tone: 'concise' | 'detailed';
  timeZone: 'America/Chicago' | 'America/New_York' | 'America/Los_Angeles' | 'UTC';
}

export function aiCapabilities(llm: Pick<LLMSetup, 'model'>, env: NodeJS.ProcessEnv = process.env) {
  const availableModels: { value: AiPreferences['model']; modelId: string }[] = [{ value: 'haiku', modelId: llm.model }];
  if (env.ASK_MODEL_SONNET?.trim()) availableModels.push({ value: 'sonnet', modelId: env.ASK_MODEL_SONNET.trim() });
  if (env.ASK_MODEL_OPUS?.trim()) availableModels.push({ value: 'opus', modelId: env.ASK_MODEL_OPUS.trim() });
  return { defaultModel: 'haiku' as const, availableModels };
}

export function resolveAiPreferences(raw: unknown, llm: LLMSetup, env: NodeJS.ProcessEnv = process.env) {
  if (raw === undefined) return { llm, preferences: undefined };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('AI preferences must be an object.');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !['model', 'tone', 'timeZone'].includes(key))
    || typeof value.model !== 'string' || typeof value.tone !== 'string' || typeof value.timeZone !== 'string'
    || !['haiku', 'sonnet', 'opus'].includes(String(value.model))
    || !['concise', 'detailed'].includes(String(value.tone))
    || !['America/Chicago', 'America/New_York', 'America/Los_Angeles', 'UTC'].includes(String(value.timeZone))) {
    throw new TypeError('Choose a supported AI model, response style and time zone in Settings.');
  }
  const preferences = value as unknown as AiPreferences;
  const model = aiCapabilities(llm, env).availableModels.find(item => item.value === preferences.model);
  if (!model) throw new TypeError('The selected AI model is not configured on this server. Choose an available model in Settings.');
  return { llm: { ...llm, model: model.modelId }, preferences };
}

export function aiStylePrompt(preferences?: AiPreferences) {
  if (!preferences) return '';
  return `\n\nOperator response preference: ${preferences.tone === 'detailed'
    ? 'Give a detailed explanation with the evidence, relevant limitations and next steps.'
    : 'Keep the answer concise with the key evidence and next steps.'}\nUse ${preferences.timeZone} when displaying timestamps; preserve source timestamps when their zone is unknown.`;
}
