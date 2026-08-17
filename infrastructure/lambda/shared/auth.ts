import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ForbiddenError } from './ddb.js';
import { isSafeIdentifier } from './identifiers.js';

export interface TenantContext {
  subject: string;
  tenantId: string;
  role: 'platform_admin' | 'tenant_admin' | 'operator' | 'auditor';
}

const ALLOWED_ROLES = new Set<TenantContext['role']>([
  'platform_admin',
  'tenant_admin',
  'operator',
  'auditor',
]);

export function tenantContext(event: APIGatewayProxyEventV2WithJWTAuthorizer): TenantContext {
  const claims = event.requestContext.authorizer.jwt.claims;
  if (claims.token_use !== 'access') {
    throw new ForbiddenError('An OAuth access token is required');
  }
  const subject = typeof claims.sub === 'string' ? claims.sub : '';
  const tenantId = typeof claims.tenant_id === 'string' ? claims.tenant_id : '';
  const rawRole = typeof claims.tenant_role === 'string' ? claims.tenant_role : '';
  if (!isSafeIdentifier(subject) || !isSafeIdentifier(tenantId) || !ALLOWED_ROLES.has(rawRole as TenantContext['role'])) {
    throw new ForbiddenError('The authenticated identity has no active tenant membership');
  }
  return { subject, tenantId, role: rawRole as TenantContext['role'] };
}

export function requireRole(
  context: TenantContext,
  ...roles: TenantContext['role'][]
): void {
  if (!roles.includes(context.role)) throw new ForbiddenError('The authenticated role cannot perform this operation');
}
