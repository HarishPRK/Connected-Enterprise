import { readFile } from 'node:fs/promises';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { requireSafeIdentifier } from '../lambda/shared/identifiers.js';

interface BootstrapInput {
  tenant: { id: string; name: string };
  subject: string;
  role: 'platform_admin' | 'tenant_admin' | 'operator' | 'auditor';
  sites: Array<{ id: string; name: string; location: string }>;
  gatewayModels: Array<{ id: string; name: string; vendor: string; description: string }>;
}

const values = process.argv.slice(2);
const argument = (name: string): string => {
  const index = values.indexOf(name);
  const value = values[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
};
const tableName = argument('--table');
const file = argument('--file');
const apply = values.includes('--apply');
const makeDefaultMembership = values.includes('--default-membership');
const input = JSON.parse(await readFile(file, 'utf8')) as BootstrapInput;
if (!input.tenant?.id || !input.tenant.name || !input.subject || !input.role) throw new Error('tenant, subject, and role are required');
if (!Array.isArray(input.sites) || !Array.isArray(input.gatewayModels)) throw new Error('sites and gatewayModels arrays are required');
requireSafeIdentifier(input.tenant.id, 'tenant.id');
requireSafeIdentifier(input.subject, 'subject');
if (!['platform_admin', 'tenant_admin', 'operator', 'auditor'].includes(input.role)) throw new Error('role is invalid');
for (const site of input.sites) requireSafeIdentifier(site.id, 'site.id');
for (const model of input.gatewayModels) requireSafeIdentifier(model.id, 'gatewayModels.id');
if (new Set(input.sites.map((site) => site.id)).size !== input.sites.length) throw new Error('site ids must be unique');
if (new Set(input.gatewayModels.map((model) => model.id)).size !== input.gatewayModels.length) throw new Error('gateway model ids must be unique');
if (!apply) {
  console.log(`Validated tenant ${input.tenant.id}; re-run with --apply to write bootstrap records.`);
  process.exit(0);
}

const now = new Date().toISOString();
const tenantPk = `TENANT#${input.tenant.id}`;
const userPk = `USER#${input.subject}`;
const items = [
  { PK: tenantPk, SK: 'METADATA', entityType: 'TENANT', tenantId: input.tenant.id, name: input.tenant.name, createdAt: now, updatedAt: now },
  ...input.sites.map((site) => ({ PK: tenantPk, SK: `SITE#${site.id}`, entityType: 'SITE', tenantId: input.tenant.id, siteId: site.id, ...site, createdAt: now, updatedAt: now })),
  ...input.gatewayModels.map((model) => ({ PK: tenantPk, SK: `MODEL#${model.id}`, entityType: 'GATEWAY_MODEL', tenantId: input.tenant.id, modelId: model.id, ...model, createdAt: now, updatedAt: now })),
  { PK: userPk, SK: `TENANT#${input.tenant.id}`, entityType: 'MEMBERSHIP', tenantId: input.tenant.id, role: input.role, status: 'ACTIVE', isDefault: makeDefaultMembership, createdAt: now, updatedAt: now },
];
if (items.length + (makeDefaultMembership ? 1 : 0) > 100) throw new Error('Bootstrap transaction cannot exceed 100 records');
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
if (makeDefaultMembership) {
  const existing = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :tenant)',
    ExpressionAttributeValues: { ':pk': userPk, ':tenant': 'TENANT#' },
    ConsistentRead: true,
  }));
  if (existing.LastEvaluatedKey || (existing.Items ?? []).some((item) => item.status === 'ACTIVE' && item.isDefault === true)) {
    throw new Error('An active default membership already exists or the membership set is too large to verify safely');
  }
}
await ddb.send(new TransactWriteCommand({
  TransactItems: [
    ...items.map((Item) => ({ Put: { TableName: tableName, Item, ConditionExpression: 'attribute_not_exists(PK)' } })),
    ...(makeDefaultMembership ? [{
      Put: {
        TableName: tableName,
        Item: {
          PK: userPk,
          SK: 'DEFAULT_MEMBERSHIP',
          entityType: 'DEFAULT_MEMBERSHIP_GUARD',
          tenantId: input.tenant.id,
          createdAt: now,
          updatedAt: now,
        },
        // This guard makes concurrent attempts to create two defaults a CAS:
        // only one transaction can create the user's default selector.
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    }] : []),
  ],
}));
console.log(`Bootstrapped tenant ${input.tenant.id} and Cognito subject membership ${input.subject}${makeDefaultMembership ? ' as the guarded default' : ''}`);
