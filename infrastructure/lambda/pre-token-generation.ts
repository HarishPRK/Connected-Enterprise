import type { PreTokenGenerationTriggerEvent } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE_NAME } from './shared/config.js';
import { ddb, userPk } from './shared/ddb.js';
import { isSafeIdentifier } from './shared/identifiers.js';

interface Membership {
  tenantId?: string;
  role?: string;
  status?: string;
  isDefault?: boolean;
}

interface ResolvedMembership extends Membership {
  tenantId: string;
  role: string;
}

export function selectTokenMembership(items: Membership[]): ResolvedMembership {
  const active = items.filter((item): item is ResolvedMembership => item.status === 'ACTIVE'
    && isSafeIdentifier(item.tenantId)
    && (item.role === 'platform_admin' || item.role === 'tenant_admin' || item.role === 'operator' || item.role === 'auditor'));
  if (active.length === 1) return active[0]!;

  const defaults = active.filter((item) => item.isDefault === true);
  if (defaults.length === 1) return defaults[0]!;

  // Throwing from the trigger prevents Cognito from issuing a tenant-bearing
  // access token when ownership is absent or ambiguous. Silently choosing the
  // first record would make DynamoDB query ordering an authorization input.
  throw new Error('A unique active tenant membership could not be resolved');
}

export async function handler(event: PreTokenGenerationTriggerEvent): Promise<PreTokenGenerationTriggerEvent> {
  const subject = event.request.userAttributes.sub;
  if (!isSafeIdentifier(subject)) throw new Error('Cognito subject does not match the authorization identifier grammar');

  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :membership)',
    ExpressionAttributeValues: {
      ':pk': userPk(subject),
      ':membership': 'TENANT#',
    },
    ConsistentRead: true,
    Limit: 25,
  }));

  if (result.LastEvaluatedKey) throw new Error('Tenant membership set exceeds the supported authorization bound');
  const membership = selectTokenMembership((result.Items ?? []).map((item) => item as Membership));

  const claims = {
    tenant_id: membership.tenantId,
    tenant_role: membership.role,
  };

  // Cognito V1 token customization (ID token).
  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: claims,
    },
  };

  // Cognito V2 events can customize both ID and access tokens. The Lambda type
  // package models V1, so add the V2 response without weakening handler input.
  if (event.version === '2') {
    const v2 = event as unknown as { response: Record<string, unknown> };
    v2.response = {
      claimsAndScopeOverrideDetails: {
        idTokenGeneration: { claimsToAddOrOverride: claims },
        accessTokenGeneration: { claimsToAddOrOverride: claims },
      },
    };
  }

  return event;
}
