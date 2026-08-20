/**
 * LLM client factory — picks between the direct Anthropic API and AWS Bedrock
 * based on env vars. Both clients share the same Messages API surface, so the
 * agent loop stays identical regardless of provider.
 *
 * Bedrock supports two auth styles:
 *   1. Traditional SigV4 — AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (+ optional session token)
 *   2. Bedrock API key (bearer token) — looks like "bedrock-api-key-<base64>",
 *      AWS's newer convenience auth introduced in 2025. Decodes server-side
 *      into temporary AWS credentials.
 *
 * Both styles are supported here. If ANTHROPIC_API_KEY contains a value that
 * starts with "bedrock-api-key-", we auto-detect and route it to Bedrock so
 * the server "just works" without further config.
 */
import Anthropic from '@anthropic-ai/sdk';
import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import { makeBedrockBearerClient } from './bedrockBearer.js';

export type Provider = 'anthropic' | 'bedrock';

export interface AgentClient {
  messages: {
    create: Anthropic['messages']['create'];
  };
}

export interface LLMSetup {
  provider: Provider;
  client: AgentClient | null;
  model: string;
  authMode?: 'anthropic-api-key' | 'bedrock-api-key' | 'aws-iam' | 'aws-default-chain';
  /** Why client is null, if it is. Surfaced in /api/health and the 503 body. */
  reason?: string;
}

export interface MakeLLMOptions {
  /** Force a provider for a scoped feature without changing the app-wide LLM. */
  provider?: Provider;
  /** Explicit model for that provider. Forced providers otherwise use their default. */
  model?: string;
  /** Prefer explicit SigV4 credentials before a Bedrock bearer token. */
  bedrockAuth?: 'auto' | 'iam-first';
}

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  bedrock:   'us.anthropic.claude-haiku-4-5-20251001-v1:0',
};

const isBedrockApiKey = (s: string | undefined): s is string =>
  !!s && s.startsWith('bedrock-api-key-');

export function makeLLM(options: MakeLLMOptions = {}): LLMSetup {
  // ── Find a Bedrock bearer token in any of the conventional env vars ──
  const bedrockBearer =
    process.env.AWS_BEARER_TOKEN_BEDROCK ||
    process.env.AWS_BEDROCK_API_KEY ||
    (isBedrockApiKey(process.env.ANTHROPIC_API_KEY) ? process.env.ANTHROPIC_API_KEY : undefined);

  // ── Pick a provider ──
  // Explicit LLM_PROVIDER wins. Otherwise, presence of a Bedrock bearer auto-routes
  // to Bedrock; everything else defaults to Anthropic.
  const explicit = options.provider ?? (process.env.LLM_PROVIDER ?? '').toLowerCase();
  let provider: Provider =
    explicit === 'bedrock' ? 'bedrock' :
    explicit === 'anthropic' ? 'anthropic' :
    (bedrockBearer ? 'bedrock' : 'anthropic');

  // If they set LLM_PROVIDER=anthropic but pasted a Bedrock key, override and tell them.
  if (provider === 'anthropic' && isBedrockApiKey(process.env.ANTHROPIC_API_KEY)) {
    provider = 'bedrock';
  }

  const model = options.model
    ?? (options.provider ? undefined : process.env.AGENT_MODEL)
    ?? DEFAULT_MODELS[provider];

  if (provider === 'bedrock') {
    const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';

    // ── Bearer token auth (newer: Bedrock API keys) ──
    // @anthropic-ai/bedrock-sdk v0.29 does not reliably honour AWS_BEARER_TOKEN_BEDROCK
    // end-to-end (it still signs with SigV4 against the default credential chain),
    // so we go direct to the Bedrock REST API with a thin fetch wrapper.
    if (bedrockBearer && options.bedrockAuth !== 'iam-first') {
      const client = makeBedrockBearerClient({ region, apiKey: bedrockBearer }) as AgentClient;
      return { provider, client, model, authMode: 'bedrock-api-key' };
    }

    // ── SigV4 auth (explicit access key + secret) ──
    const accessKey = process.env.AWS_ACCESS_KEY_ID;
    const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (accessKey && secretKey) {
      const client = new AnthropicBedrock({
        // Suppress the SDK's implicit AWS_BEARER_TOKEN_BEDROCK lookup when
        // explicit SigV4 credentials were selected for this client.
        apiKey: null as unknown as string,
        awsRegion: region,
        awsAccessKey: accessKey,
        awsSecretKey: secretKey,
        awsSessionToken: process.env.AWS_SESSION_TOKEN,
      }) as unknown as AgentClient;
      return { provider, client, model, authMode: 'aws-iam' };
    }

    // A scoped feature may prefer IAM when both auth forms are present, but
    // still fall back to the bearer token on hosts without explicit keys.
    if (bedrockBearer) {
      const client = makeBedrockBearerClient({ region, apiKey: bedrockBearer }) as AgentClient;
      return { provider, client, model, authMode: 'bedrock-api-key' };
    }

    // ── AWS default credential chain (IAM role on EC2/ECS/Lambda, ~/.aws/credentials, SSO) ──
    const client = new AnthropicBedrock({ awsRegion: region }) as unknown as AgentClient;
    return { provider, client, model, authMode: 'aws-default-chain' };
  }

  // ────── Anthropic direct API ──────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { provider, client: null, model, reason: 'ANTHROPIC_API_KEY not set' };
  }
  // Defense in depth — if we got here with a Bedrock-shaped key, refuse.
  if (isBedrockApiKey(apiKey)) {
    return {
      provider, client: null, model,
      reason:
        'ANTHROPIC_API_KEY contains a Bedrock API key (starts with "bedrock-api-key-"). ' +
        'Set LLM_PROVIDER=bedrock and AWS_REGION, or rename the env var to AWS_BEARER_TOKEN_BEDROCK.',
    };
  }
  const client = new Anthropic({ apiKey });
  return { provider, client, model, authMode: 'anthropic-api-key' };
}
