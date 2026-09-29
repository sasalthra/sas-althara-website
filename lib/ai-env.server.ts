import 'server-only';
import {unseal} from './secrets.server';
import {DEFAULT_MODEL, isPlausibleModel, type ProviderName} from './ai-public';

export type AiCredentials = {
  source: 'env' | 'database';
  provider: ProviderName;
  model: string;
  apiKey: string;
};

const warned = new Set<string>();

function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

export function redactModel(name: string, secret = ''): string {
  if (!name) return '[empty]';
  if ((secret && (name === secret || name.includes(secret))) || /^sk[-_]/i.test(name) || name.length > 80) return '[redacted]';
  return name;
}

export function resolveModelName(raw: string | null | undefined, secret = ''): string {
  const name = (raw ?? '').trim();
  if (isPlausibleModel(name)) return name;
  if (name) warnOnce(`AI model "${redactModel(name, secret)}" looks invalid; using ${DEFAULT_MODEL}`);
  return DEFAULT_MODEL;
}

export function readEnvAi(): {provider: ProviderName; model: string; apiKey: string} | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? '';
  if (!apiKey) return null;
  const requested = (process.env.AI_PROVIDER ?? '').trim().toLowerCase();
  let provider: ProviderName = 'openai';
  if (requested === 'anthropic') provider = 'anthropic';
  else if (requested && requested !== 'openai') {
    warnOnce(`AI_PROVIDER "${redactModel(requested, apiKey)}" is not supported; using openai`);
  }
  return {provider, model: resolveModelName(process.env.OPENAI_MODEL, apiKey), apiKey};
}

/** Safe to pass into a server-rendered page. Never includes the API key. */
export function publicAiEnv(): {provider: ProviderName; model: string} | null {
  const env = readEnvAi();
  if (!env) return null;
  return {provider: env.provider, model: env.model};
}

export function credentialsFromRow(row: {provider: string; model: string; encrypted_key: string} | null): AiCredentials | null {
  const env = readEnvAi();
  if (env) return {source: 'env', provider: env.provider, model: env.model, apiKey: env.apiKey};
  if (!row || (row.provider !== 'openai' && row.provider !== 'anthropic')) return null;
  return {
    source: 'database',
    provider: row.provider,
    model: row.model,
    apiKey: unseal(row.encrypted_key, row.provider),
  };
}
