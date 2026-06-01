/**
 * Minimal Bedrock client that authenticates with a long-lived Bedrock API key
 * (the `bedrock-api-key-...` bearer token from the AWS console). It exposes the
 * exact same `messages.create()` signature the Anthropic SDK does, so the agent
 * loop in agent.ts is provider-agnostic.
 *
 * Why this exists: @anthropic-ai/bedrock-sdk v0.29 still always attempts SigV4
 * signing and does not honour AWS_BEARER_TOKEN_BEDROCK end-to-end. Going direct
 * to the Bedrock REST API is the most reliable path for bearer-token auth.
 *
 * Bedrock invoke endpoint:
 *   POST https://bedrock-runtime.<region>.amazonaws.com/model/<modelId>/invoke
 *   Authorization: Bearer bedrock-api-key-<base64>
 *   Body: { "anthropic_version": "bedrock-2023-05-31", ...same params as Anthropic Messages API }
 * Response body is the same shape as Anthropic Messages API.
 */
import type Anthropic from '@anthropic-ai/sdk';

export interface BedrockBearerClient {
  messages: {
    create: Anthropic['messages']['create'];
  };
}

export function makeBedrockBearerClient(opts: {
  region: string;
  apiKey: string;
}): BedrockBearerClient {
  const { region, apiKey } = opts;
  const base = `https://bedrock-runtime.${region}.amazonaws.com`;

  const create = (async (params: Anthropic.Messages.MessageCreateParams) => {
    const { model, stream, ...rest } = params as Anthropic.Messages.MessageCreateParams & { stream?: boolean };
    void stream; // we don't expose streaming through this client; agent.ts uses non-streaming Messages API

    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      ...rest,
    });
    const url = `${base}/model/${encodeURIComponent(model)}/invoke`;

    // eslint-disable-next-line no-console
    console.log(`[bedrock-bearer] POST ${url} (${body.length}B body)`);

    let res: Response;
    const t0 = Date.now();
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[bedrock-bearer] fetch threw after ${Date.now() - t0}ms:`, err);
      throw new Error(`Bedrock fetch failed: ${msg}`);
    }

    // eslint-disable-next-line no-console
    console.log(`[bedrock-bearer] ${res.status} ${res.statusText} (${Date.now() - t0}ms)`);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.error(`[bedrock-bearer] error body:`, text.slice(0, 400));
      throw new Error(`Bedrock ${res.status} ${res.statusText}: ${text.slice(0, 600)}`);
    }
    return (await res.json()) as Anthropic.Messages.Message;
  }) as Anthropic['messages']['create'];

  return { messages: { create } };
}
