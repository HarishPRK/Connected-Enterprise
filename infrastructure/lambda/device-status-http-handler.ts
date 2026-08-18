import { TextDecoder } from 'node:util';
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import { AWS_ACCOUNT_ID } from './shared/config.js';
import {
  DeviceStatusAuthorizationError,
  DeviceStatusConflictError,
  recordAuthoritativeDeviceStatus,
  type AuthoritativeDeviceIdentity,
  type DeviceStatus,
  type DeviceStatusRecordDisposition,
  type DeviceStatusReport,
} from './iot-status-handler.js';

const ROUTE_KEY = 'POST /device/v1/things/{thingName}/certificates/{certificateId}/status';
const GATEWAY_CONFIG_ROLE_NAME = process.env.GATEWAY_CONFIG_ROLE_NAME?.trim() ?? '';
const THING_NAME_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const CERTIFICATE_ID_PATTERN = /^[a-f0-9]{64}$/;
const PROFILE_VERSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const ROLE_SESSION_PATTERN = /^[A-Za-z0-9+=,.@_-]{1,128}$/;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_GENERATION = 999_999_999_999;
const HTTP_STATUSES = new Set<DeviceStatus>([
  'APPLYING',
  'HEALTH_CHECK',
  'APPLIED_HEALTHY',
  'FAILED',
  'ROLLING_BACK',
  'ROLLED_BACK',
]);

interface AuthorizedStatusRequest {
  identity: AuthoritativeDeviceIdentity;
  report: DeviceStatusReport & { generation: number; status: DeviceStatus };
}

export interface DeviceStatusHttpDependencies {
  recordStatus(
    identity: AuthoritativeDeviceIdentity,
    report: DeviceStatusReport,
    context: Context,
  ): Promise<DeviceStatusRecordDisposition>;
}

class DeviceStatusHttpError extends Error {
  constructor(
    readonly statusCode: 400 | 403,
    readonly code: 'INVALID_REQUEST' | 'DEVICE_NOT_AUTHORIZED',
    message: string,
  ) {
    super(message);
  }
}

const productionDependencies: DeviceStatusHttpDependencies = {
  recordStatus: recordAuthoritativeDeviceStatus,
};

export function createDeviceStatusHttpHandler(
  dependencies: DeviceStatusHttpDependencies = productionDependencies,
) {
  return async (
    event: APIGatewayProxyEventV2WithIAMAuthorizer,
    context: Context,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const requestId = safeRequestId(event.requestContext?.requestId) ?? context.awsRequestId;
    try {
      const request = authorizedStatusRequest(event);
      const disposition = await dependencies.recordStatus(request.identity, request.report, context);
      if (disposition === 'QUARANTINED') {
        return json(409, {
          accepted: false,
          code: 'STATUS_NOT_ACCEPTED',
          error: 'Rollback attestation was rejected',
          requestId,
        }, requestId);
      }
      return json(200, {
        accepted: true,
        disposition,
        generation: request.report.generation,
        status: request.report.status,
        requestId,
      }, requestId);
    } catch (error) {
      if (error instanceof DeviceStatusHttpError) {
        return json(error.statusCode, {
          error: error.message,
          code: error.code,
          requestId,
        }, requestId);
      }
      if (error instanceof DeviceStatusAuthorizationError) {
        return json(403, {
          error: 'Device is not authorized',
          code: 'DEVICE_NOT_AUTHORIZED',
          requestId,
        }, requestId);
      }
      if (error instanceof DeviceStatusConflictError) {
        return json(409, {
          error: 'Device status is not consistent with the authoritative deployment',
          code: 'STATUS_NOT_ACCEPTED',
          requestId,
        }, requestId);
      }
      // Do not log the event, body, SigV4 headers, or temporary credentials.
      console.error(JSON.stringify({
        level: 'error',
        requestId,
        error: error instanceof Error ? error.name : 'UnknownError',
      }));
      return json(500, {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        requestId,
      }, requestId);
    }
  };
}

export const handler = createDeviceStatusHttpHandler();

function authorizedStatusRequest(
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
): AuthorizedStatusRequest {
  if (event.routeKey !== ROUTE_KEY
    || event.requestContext?.routeKey !== ROUTE_KEY
    || event.requestContext?.http?.method !== 'POST') {
    throw invalidRequest('Route not found');
  }

  const iam = event.requestContext.authorizer?.iam;
  if (!iam
    || typeof iam.userArn !== 'string'
    || !iam.userArn
    || typeof iam.accessKey !== 'string'
    || !iam.accessKey
    || !AWS_ACCOUNT_ID
    || !GATEWAY_CONFIG_ROLE_NAME
    || iam.accountId !== AWS_ACCOUNT_ID) {
    throw unauthorized();
  }
  const expectedRolePrefix = `arn:aws:sts::${AWS_ACCOUNT_ID}:assumed-role/${GATEWAY_CONFIG_ROLE_NAME}/`;
  const roleSession = iam.userArn.startsWith(expectedRolePrefix)
    ? iam.userArn.slice(expectedRolePrefix.length)
    : '';
  if (!ROLE_SESSION_PATTERN.test(roleSession)) throw unauthorized();

  const thingName = event.pathParameters?.thingName;
  const certificateId = event.pathParameters?.certificateId;
  if (typeof thingName !== 'string' || !THING_NAME_PATTERN.test(thingName)) {
    throw invalidRequest('Invalid device status request');
  }
  if (typeof certificateId !== 'string' || !CERTIFICATE_ID_PATTERN.test(certificateId)) {
    throw invalidRequest('Invalid device status request');
  }
  const expectedPath = `/device/v1/things/${thingName}/certificates/${certificateId}/status`;
  if (event.rawPath !== expectedPath || event.requestContext.http.path !== expectedPath) {
    throw invalidRequest('Invalid device status request');
  }
  if (event.rawQueryString !== '' || Object.keys(event.queryStringParameters ?? {}).length !== 0) {
    throw invalidRequest('Device status requests do not accept query parameters');
  }

  const contentType = header(event.headers, 'content-type');
  if (!contentType || !CONTENT_TYPE_PATTERN.test(contentType)) {
    throw invalidRequest('Content-Type must be application/json');
  }
  const body = parseBody(event);
  const report = validatedReport(body);
  return { identity: { thingName, certificateId }, report };
}

function parseBody(event: APIGatewayProxyEventV2WithIAMAuthorizer): Record<string, unknown> {
  if (typeof event.body !== 'string' || event.body.length === 0) {
    throw invalidRequest('A JSON status body is required');
  }
  let bytes: Buffer;
  if (event.isBase64Encoded) {
    if (!isCanonicalBase64(event.body)) throw invalidRequest('The request body is not valid base64');
    bytes = Buffer.from(event.body, 'base64');
  } else {
    bytes = Buffer.from(event.body, 'utf8');
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BODY_BYTES) {
    throw invalidRequest(`Request body must not exceed ${MAX_BODY_BYTES} bytes`);
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw invalidRequest('The request body must be valid UTF-8');
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value)) throw invalidRequest('The JSON status body must be an object');
    return value;
  } catch (error) {
    if (error instanceof DeviceStatusHttpError) throw error;
    throw invalidRequest('The request body is not valid JSON');
  }
}

function validatedReport(value: Record<string, unknown>): DeviceStatusReport & { generation: number; status: DeviceStatus } {
  const generation = value.generation;
  if (typeof generation !== 'number'
    || !Number.isSafeInteger(generation)
    || generation < 1
    || generation > MAX_GENERATION) {
    throw invalidRequest('generation must be a positive integer');
  }
  if (typeof value.status !== 'string' || !HTTP_STATUSES.has(value.status as DeviceStatus)) {
    throw invalidRequest('status is unsupported');
  }
  const status = value.status as DeviceStatus;
  const attested = status === 'APPLIED_HEALTHY' || status === 'ROLLED_BACK';
  const allowed = new Set(['generation', 'status', 'detail']);
  if (attested) {
    allowed.add('profileVersionId');
    allowed.add('profileChecksum');
  }
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw invalidRequest('The status body contains unsupported fields');
  }

  let detail: string | undefined;
  if (value.detail != null) {
    if (typeof value.detail !== 'string'
      || value.detail !== value.detail.trim()
      || value.detail.length < 1
      || value.detail.length > 500
      || hasControlCharacters(value.detail)) {
      throw invalidRequest('detail must be 1-500 printable characters without surrounding whitespace');
    }
    detail = value.detail;
  }

  let profileVersionId: string | undefined;
  let profileChecksum: string | undefined;
  if (attested) {
    if (typeof value.profileVersionId !== 'string'
      || !PROFILE_VERSION_ID_PATTERN.test(value.profileVersionId)) {
      throw invalidRequest('profileVersionId is required for the reported status');
    }
    if (typeof value.profileChecksum !== 'string'
      || !CHECKSUM_PATTERN.test(value.profileChecksum)) {
      throw invalidRequest('profileChecksum must be a lowercase SHA-256 digest');
    }
    profileVersionId = value.profileVersionId;
    profileChecksum = value.profileChecksum;
  }

  return {
    generation,
    status,
    ...(detail ? { detail } : {}),
    ...(profileVersionId ? { profileVersionId } : {}),
    ...(profileChecksum ? { profileChecksum } : {}),
  };
}

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const matching = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);
  return matching.length === 1 ? matching[0]?.[1]?.trim() : undefined;
}

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function invalidRequest(message: string): DeviceStatusHttpError {
  return new DeviceStatusHttpError(400, 'INVALID_REQUEST', message);
}

function unauthorized(): DeviceStatusHttpError {
  return new DeviceStatusHttpError(403, 'DEVICE_NOT_AUTHORIZED', 'Device is not authorized');
}

function json(
  statusCode: number,
  body: unknown,
  requestId: string,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'x-request-id': requestId,
    },
    body: JSON.stringify(body),
  };
}
