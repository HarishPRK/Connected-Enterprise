import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { ConflictError, ForbiddenError, InputError, NotFoundError } from './ddb.js';

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
};

export function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: SECURITY_HEADERS, body: JSON.stringify(body) };
}

export function parseJsonBody<T = Record<string, unknown>>(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  maxBytes = 256 * 1024,
): T {
  if (!event.body) throw new InputError('A JSON request body is required');
  const encodedLength = Buffer.byteLength(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
  if (encodedLength > maxBytes) throw new InputError(`Request body exceeds ${maxBytes} bytes`);
  try {
    const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const value = JSON.parse(text) as unknown;
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      throw new InputError('The JSON body must be an object');
    }
    return value as T;
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('The request body is not valid JSON');
  }
}

export function idempotencyKey(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const value = event.headers['idempotency-key']?.trim();
  if (!value || value.length < 8 || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new InputError('Idempotency-Key is required and must be 8-128 URL-safe characters');
  }
  return value;
}

export function errorResponse(error: unknown, requestId: string): APIGatewayProxyStructuredResultV2 {
  const statusCode = error instanceof InputError
    || error instanceof ConflictError
    || error instanceof ForbiddenError
    || error instanceof NotFoundError
    ? error.statusCode
    : 500;
  const message = statusCode === 500 ? 'Internal server error' : (error as Error).message;
  if (statusCode === 500) {
    // Deliberately omit request bodies, hardware proofs, tokens, and AWS response objects.
    console.error(JSON.stringify({ level: 'error', requestId, error: error instanceof Error ? error.message : String(error) }));
  }
  return json(statusCode, { error: message, requestId });
}
