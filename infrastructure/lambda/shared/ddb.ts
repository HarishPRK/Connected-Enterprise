import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { isSafeIdentifier } from './identifiers.js';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  },
});

export const tenantPk = (tenantId: string): string => `TENANT#${tenantId}`;
export const userPk = (subject: string): string => `USER#${subject}`;
export const serialPk = (serialNumber: string): string => `SERIAL#${normalizeSerial(serialNumber)}`;
export const profileSk = (profileId: string): string => `PROFILE#${profileId}`;
export const profileVersionSk = (profileId: string, version: number): string =>
  `PROFILE_VERSION#${profileId}#${String(version).padStart(10, '0')}`;
export const gatewaySk = (gatewayId: string): string => `GATEWAY#${gatewayId}`;
export const operationSk = (operationId: string): string => `OPERATION#${operationId}`;
export const idempotencySk = (route: string, key: string): string =>
  `IDEMPOTENCY#${Buffer.from(route).toString('base64url')}#${key}`;
export const deploymentSk = (gatewayId: string, generation: number): string =>
  `DEPLOYMENT#${gatewayId}#${String(generation).padStart(12, '0')}`;
export const outboxSk = (createdAt: string, outboxId: string): string => `OUTBOX#${createdAt}#${outboxId}`;
export const auditSk = (createdAt: string, auditId: string): string => `AUDIT#${createdAt}#${auditId}`;

export function normalizeSerial(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 128);
}

export function normalizeIdentifier(value: unknown, label: string, maxLength = 128): string {
  if (typeof value !== 'string') throw new InputError(`${label} must be a string`);
  const normalized = value.trim();
  if (!isSafeIdentifier(normalized, maxLength)) {
    throw new InputError(`${label} contains unsupported characters or exceeds ${maxLength} characters`);
  }
  return normalized;
}

export class InputError extends Error {
  readonly statusCode = 400;
}

export class ConflictError extends Error {
  readonly statusCode = 409;
}

export class ForbiddenError extends Error {
  readonly statusCode = 403;
}

export class NotFoundError extends Error {
  readonly statusCode = 404;
}
