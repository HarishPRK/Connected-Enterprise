import type {
  CreateProfileVersionInput,
  OnboardingOperation,
  OnboardingSnapshot,
  ProfileVersion,
  VerificationResult,
} from './types';
import { onboardingApiUrl, onboardingAuthorizationHeaders } from './auth';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export const ONBOARDING_EVENTS_URL = onboardingApiUrl('/api/onboarding/events');

export class OnboardingApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'OnboardingApiError';
    this.status = status;
    this.code = code;
  }
}

function unwrap<T>(value: T | { data?: T; result?: T }): T {
  if (value && typeof value === 'object') {
    const wrapped = value as { data?: T; result?: T };
    if (wrapped.data !== undefined) return wrapped.data;
    if (wrapped.result !== undefined) return wrapped.result;
  }
  return value as T;
}

async function readResponse<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const errorPayload = payload as { error?: string | { message?: string; code?: string }; message?: string; code?: string } | undefined;
    const nested = typeof errorPayload?.error === 'object' ? errorPayload.error : undefined;
    const message =
      nested?.message
      ?? (typeof errorPayload?.error === 'string' ? errorPayload.error : undefined)
      ?? errorPayload?.message
      ?? `Onboarding request failed (${response.status})`;
    throw new OnboardingApiError(message, response.status, nested?.code ?? errorPayload?.code);
  }

  return unwrap(payload as T | { data?: T; result?: T });
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(onboardingApiUrl(url), {
    method: 'GET',
    headers: { Accept: 'application/json', ...await onboardingAuthorizationHeaders() },
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  return readResponse<T>(response);
}

async function postJson<T>(
  url: string,
  body: unknown,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(onboardingApiUrl(url), {
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      Accept: 'application/json',
      'Idempotency-Key': idempotencyKey,
      ...await onboardingAuthorizationHeaders(),
    },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    signal,
  });
  return readResponse<T>(response);
}

export function createIdempotencyKey(scope: string): string {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `ce-${scope}-${id}`;
}

export function fetchOnboardingSnapshot(signal?: AbortSignal): Promise<OnboardingSnapshot> {
  return getJson<OnboardingSnapshot>('/api/onboarding/snapshot', signal);
}

export function verifyDeviceClaim(
  serialNumber: string,
  activationCode: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<VerificationResult> {
  return postJson<VerificationResult>(
    '/api/onboarding/claims/verify',
    { serialNumber, activationCode },
    idempotencyKey,
    signal,
  );
}

export async function startOnboardingOperation(
  verificationId: string,
  siteId: string,
  profileVersionId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<OnboardingOperation> {
  const result = await postJson<OnboardingOperation | { operation: OnboardingOperation }>(
    '/api/onboarding/operations',
    { verificationId, siteId, profileVersionId },
    idempotencyKey,
    signal,
  );
  return 'operation' in result ? result.operation : result;
}

export async function fetchOnboardingOperation(
  operationId: string,
  signal?: AbortSignal,
): Promise<OnboardingOperation> {
  const result = await getJson<OnboardingOperation | { operation: OnboardingOperation }>(
    `/api/onboarding/operations/${encodeURIComponent(operationId)}`,
    signal,
  );
  return 'operation' in result ? result.operation : result;
}

export async function decommissionGateway(
  gatewayId: string,
  confirmation: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<OnboardingOperation> {
  const result = await postJson<OnboardingOperation | { operation: OnboardingOperation }>(
    `/api/onboarding/gateways/${encodeURIComponent(gatewayId)}/decommission`,
    { confirmation },
    idempotencyKey,
    signal,
  );
  return 'operation' in result ? result.operation : result;
}

export async function deployProfileToGateway(
  gatewayId: string,
  profileVersionId: string,
  deliveryMode: 'SHADOW' | 'JOB',
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<OnboardingOperation> {
  const result = await postJson<{ operation: OnboardingOperation }>(
    `/api/onboarding/gateways/${encodeURIComponent(gatewayId)}/assignments`,
    { profileVersionId, deliveryMode },
    idempotencyKey,
    signal,
  );
  return result.operation;
}

export async function createProfileVersion(
  input: CreateProfileVersionInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ProfileVersion> {
  const result = await postJson<ProfileVersion | { profile: ProfileVersion }>(
    '/api/onboarding/profiles',
    input,
    idempotencyKey,
    signal,
  );
  return 'profile' in result ? result.profile : result;
}
