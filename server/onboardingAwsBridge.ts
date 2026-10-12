import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { InvokeCommand, LambdaClient, type InvokeCommandInput } from '@aws-sdk/client-lambda';

export interface OnboardingAwsBridgeConfig {
  apiFunctionArn: string;
  region: string;
  fixedTenantId: string;
  fixedSubject: string;
}

export interface OnboardingAwsPrincipal {
  subject: string;
  tenantId: string;
  role: 'tenant_admin';
}

export interface OnboardingAwsRequest {
  method: string;
  /** Router-relative path, such as /snapshot or /gateways/<id>/assignments. */
  path: string;
  body?: unknown;
  idempotencyKey?: string;
}

export interface OnboardingAwsResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
}

export interface OnboardingAwsInvocationResult {
  StatusCode?: number;
  FunctionError?: string;
  Payload?: Uint8Array;
}

export type OnboardingAwsInvoke = (
  input: InvokeCommandInput,
  options: { abortSignal: AbortSignal },
) => Promise<OnboardingAwsInvocationResult>;

export interface OnboardingAwsBridgeOptions {
  /** Test seam; production uses the SDK's default IAM credential chain. */
  invoke?: OnboardingAwsInvoke;
  timeoutMs?: number;
}

export interface OnboardingAwsBridge {
  resolvePrincipal(): OnboardingAwsPrincipal;
  forward(request: OnboardingAwsRequest): Promise<OnboardingAwsResponse>;
}

export class OnboardingAwsBridgeError extends Error {
  readonly status: number;
  readonly statusCode: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'OnboardingAwsBridgeError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
  }
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEV_API_ARN = /^arn:aws:lambda:([a-z0-9-]+):(\d{12}):function:connected-enterprise-onboarding-dev-api$/;
const REQUEST_BODY_LIMIT = 256 * 1024;
const RESPONSE_PAYLOAD_LIMIT = 6 * 1024 * 1024;
const ZIP_BODY_LIMIT = 1024 * 1024;
const STATIC_ROUTES = new Set([
  'GET /snapshot', 'POST /claims/verify', 'POST /bootstrap-packages',
  'POST /profiles', 'POST /controller', 'POST /operations',
]);
const RESPONSE_HEADERS = new Set([
  'content-type', 'content-disposition', 'x-certificate-id', 'x-request-id',
  'cache-control', 'x-content-type-options', 'x-frame-options', 'referrer-policy',
]);

interface MatchedRoute {
  routeKey: string;
  rawPath: string;
  pathParameters: Record<string, string>;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function invalidResponse(): OnboardingAwsBridgeError {
  return new OnboardingAwsBridgeError(502, 'ONBOARDING_AWS_RESPONSE_INVALID', 'AWS onboarding returned an invalid response. Try again.');
}

function matchRoute(method: string, path: string): MatchedRoute {
  if (typeof path !== 'string' || path.length > 1024) {
    throw new OnboardingAwsBridgeError(400, 'ONBOARDING_PATH_INVALID', 'The onboarding path is invalid.');
  }
  if (STATIC_ROUTES.has(`${method} ${path}`)) {
    return { routeKey: `${method} /api/onboarding${path}`, rawPath: `/api/onboarding${path}`, pathParameters: {} };
  }
  const operation = method === 'GET' ? /^\/operations\/([^/?#]+)$/.exec(path) : null;
  const gateway = method === 'POST' ? /^\/gateways\/([^/?#]+)\/(assignments|decommission)$/.exec(path) : null;
  if (!operation && !gateway) {
    throw new OnboardingAwsBridgeError(404, 'ONBOARDING_ROUTE_NOT_FOUND', 'This onboarding route is not available.');
  }
  let identifier: string;
  try {
    identifier = decodeURIComponent((operation ?? gateway)![1]);
  } catch {
    throw new OnboardingAwsBridgeError(400, 'ONBOARDING_PATH_INVALID', 'The onboarding resource identifier is invalid.');
  }
  if (!SAFE_IDENTIFIER.test(identifier)) {
    throw new OnboardingAwsBridgeError(400, 'ONBOARDING_PATH_INVALID', 'The onboarding resource identifier is invalid.');
  }
  if (operation) {
    return {
      routeKey: 'GET /api/onboarding/operations/{operationId}',
      rawPath: `/api/onboarding/operations/${encodeURIComponent(identifier)}`,
      pathParameters: { operationId: identifier },
    };
  }
  return {
    routeKey: `POST /api/onboarding/gateways/{gatewayId}/${gateway![2]}`,
    rawPath: `/api/onboarding/gateways/${encodeURIComponent(identifier)}/${gateway![2]}`,
    pathParameters: { gatewayId: identifier },
  };
}

function serializeBody(request: OnboardingAwsRequest): string | undefined {
  if (request.method === 'GET') {
    if (request.body !== undefined) {
      throw new OnboardingAwsBridgeError(400, 'ONBOARDING_BODY_INVALID', 'GET requests cannot contain an onboarding body.');
    }
    return undefined;
  }
  if (!object(request.body)) {
    throw new OnboardingAwsBridgeError(400, 'ONBOARDING_BODY_INVALID', 'A JSON object is required.');
  }
  let body: string;
  try {
    body = JSON.stringify(request.body);
    if (!object(JSON.parse(body))) throw new Error('Not an object');
  } catch {
    throw new OnboardingAwsBridgeError(400, 'ONBOARDING_BODY_INVALID', 'The onboarding body must be a valid JSON object.');
  }
  if (Buffer.byteLength(body, 'utf8') > REQUEST_BODY_LIMIT) {
    throw new OnboardingAwsBridgeError(413, 'ONBOARDING_BODY_TOO_LARGE', 'The onboarding body exceeds 256 KiB.');
  }
  return body;
}

function parseInvocation(result: OnboardingAwsInvocationResult): Record<string, unknown> {
  if (result.FunctionError) {
    // Lambda failures may include request data or stack traces; never expose them.
    throw new OnboardingAwsBridgeError(502, 'ONBOARDING_AWS_FUNCTION_FAILED', 'AWS onboarding could not complete this request. Try again.');
  }
  if (result.StatusCode !== 200 || !(result.Payload instanceof Uint8Array)
    || result.Payload.byteLength > RESPONSE_PAYLOAD_LIMIT) throw invalidResponse();
  try {
    const parsed = object(JSON.parse(Buffer.from(result.Payload).toString('utf8')));
    if (!parsed) throw new Error('Not an object');
    return parsed;
  } catch {
    throw invalidResponse();
  }
}

function responseFromLambda(result: Record<string, unknown>, routeKey: string): OnboardingAwsResponse {
  if (typeof result.statusCode !== 'number' || !Number.isInteger(result.statusCode)
    || result.statusCode < 200 || result.statusCode > 599 || typeof result.body !== 'string'
    || (result.isBase64Encoded !== undefined && typeof result.isBase64Encoded !== 'boolean')) throw invalidResponse();
  const rawHeaders = object(result.headers);
  if (!rawHeaders) throw invalidResponse();
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawHeaders)) {
    const lower = name.toLowerCase();
    if (!RESPONSE_HEADERS.has(lower)) continue;
    if (typeof value !== 'string' || /[\r\n\0]/.test(value) || value.length > 2048) throw invalidResponse();
    headers[lower] = value;
  }
  // Bootstrap archives contain private keys and must never be cached.
  headers['cache-control'] = 'no-store, private';
  headers['x-content-type-options'] = 'nosniff';
  headers['x-frame-options'] = 'DENY';
  headers['referrer-policy'] = 'no-referrer';
  const contentType = headers['content-type']?.toLowerCase();
  if (!contentType || (!/^application\/json(?:;\s*charset=utf-8)?$/.test(contentType) && contentType !== 'application/zip')) throw invalidResponse();
  const body = Buffer.from(result.body, result.isBase64Encoded === true ? 'base64' : 'utf8');
  if (result.isBase64Encoded === true && body.toString('base64') !== result.body) throw invalidResponse();
  if (contentType === 'application/zip'
    && (routeKey !== 'POST /api/onboarding/bootstrap-packages' || result.statusCode !== 201
      || result.isBase64Encoded !== true || body.length === 0 || body.length > ZIP_BODY_LIMIT
      || !/^[a-f0-9]{64}$/i.test(headers['x-certificate-id'] ?? ''))) throw invalidResponse();
  return { statusCode: result.statusCode, headers, body };
}

/**
 * Explicit dev service delegation, not a human sign-in or a membership claim.
 * The router must enforce the deployment's enable flag and expiry before calling.
 */
export function createOnboardingAwsBridge(
  config: OnboardingAwsBridgeConfig,
  options: OnboardingAwsBridgeOptions = {},
): OnboardingAwsBridge {
  const { apiFunctionArn, region, fixedTenantId, fixedSubject } = config;
  const arn = DEV_API_ARN.exec(apiFunctionArn);
  const timeoutMs = options.timeoutMs ?? 20_000;
  if (typeof fixedSubject !== 'string' || !SAFE_IDENTIFIER.test(fixedSubject)
    || typeof fixedTenantId !== 'string' || !SAFE_IDENTIFIER.test(fixedTenantId)
    || !arn || arn[1] !== region || !/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(region)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new OnboardingAwsBridgeError(503, 'ONBOARDING_AWS_CONFIGURATION_INVALID', 'The AWS onboarding bridge is not configured correctly.');
  }
  const principal: Readonly<OnboardingAwsPrincipal> = Object.freeze({ subject: fixedSubject, tenantId: fixedTenantId, role: 'tenant_admin' });
  const client = options.invoke ? undefined : new LambdaClient({ region, maxAttempts: 1 });
  const invoke: OnboardingAwsInvoke = options.invoke ?? ((input, requestOptions) => client!.send(new InvokeCommand(input), requestOptions));

  async function forward(request: OnboardingAwsRequest): Promise<OnboardingAwsResponse> {
    const route = matchRoute(request.method, request.path);
    const body = serializeBody(request);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (request.method === 'POST') {
      const key = request.idempotencyKey?.trim();
      if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
        throw new OnboardingAwsBridgeError(428, 'IDEMPOTENCY_KEY_REQUIRED', 'An 8–128 character URL-safe Idempotency-Key is required.');
      }
      headers['idempotency-key'] = key;
    }
    const requestId = randomUUID();
    // Copy only route/body/idempotency inputs. Browser-supplied identity stays data.
    const payload = {
      version: '2.0', routeKey: route.routeKey, rawPath: route.rawPath, rawQueryString: '',
      headers, ...(body === undefined ? {} : { body }), isBase64Encoded: false,
      pathParameters: route.pathParameters,
      requestContext: {
        accountId: arn![2], requestId, routeKey: route.routeKey, stage: '$default',
        authorizer: { jwt: { claims: {
          token_use: 'access', sub: principal.subject,
          tenant_id: principal.tenantId, tenant_role: principal.role,
        }, scopes: [] } },
        http: { method: request.method, path: route.rawPath, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'ConnectedEnterpriseDevService' },
      },
    };
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new OnboardingAwsBridgeError(504, 'ONBOARDING_AWS_TIMEOUT', 'AWS onboarding took too long to respond. Retry with the same request.'));
      }, timeoutMs);
    });
    try {
      const invoked = await Promise.race([
        invoke({ FunctionName: apiFunctionArn, InvocationType: 'RequestResponse', LogType: 'None', Payload: Buffer.from(JSON.stringify(payload)) }, { abortSignal: controller.signal }),
        timedOut,
      ]);
      return responseFromLambda(parseInvocation(invoked), route.routeKey);
    } catch (error) {
      if (error instanceof OnboardingAwsBridgeError) throw error;
      if (controller.signal.aborted) {
        throw new OnboardingAwsBridgeError(504, 'ONBOARDING_AWS_TIMEOUT', 'AWS onboarding took too long to respond. Retry with the same request.');
      }
      throw new OnboardingAwsBridgeError(503, 'ONBOARDING_AWS_UNAVAILABLE', 'AWS onboarding is temporarily unavailable. Try again.');
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  return { resolvePrincipal: () => ({ ...principal }), forward };
}
