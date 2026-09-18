import { readFile } from 'node:fs/promises';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { requireSafeIdentifier } from '../lambda/shared/identifiers.js';

/** Add a reviewed site list without changing memberships, existing sites,
 * gateway assignments, or profiles. Dry run is the default. */
const args = process.argv.slice(2);
function argument(name: string): string {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}
const tableName = argument('--table');
const tenantId = requireSafeIdentifier(argument('--tenant-id'), 'tenant ID');
const input: unknown = JSON.parse(await readFile(argument('--file'), 'utf8'));
if (!Array.isArray(input) || !input.length || input.length > 99) throw new Error('Provide between 1 and 99 sites');
const sites = input.map((site: unknown) => {
  if (!site || typeof site !== 'object') throw new Error('Each site must be an object');
  const value = site as Record<string, unknown>;
  const id = requireSafeIdentifier(value.id, 'site ID');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80) throw new Error(`Invalid name for ${id}`);
  if (typeof value.location !== 'string' || !value.location.trim() || value.location.length > 160) throw new Error(`Invalid location for ${id}`);
  return { id, name: value.name.trim(), location: value.location.trim() };
});
if (new Set(sites.map((site) => site.id)).size !== sites.length) throw new Error('Duplicate site IDs');
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: argument('--region') }));
const pk = `TENANT#${tenantId}`;
const tenant = (await ddb.send(new GetCommand({
  TableName: tableName, Key: { PK: pk, SK: 'METADATA' }, ConsistentRead: true,
}))).Item;
if (tenant?.entityType !== 'TENANT' || tenant.tenantId !== tenantId) throw new Error('Tenant metadata not found');

const existing = new Map<string, Record<string, unknown>>();
let cursor: Record<string, unknown> | undefined;
do {
  const page = await ddb.send(new QueryCommand({
    TableName: tableName, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk, ':prefix': 'SITE#' },
    ConsistentRead: true, ExclusiveStartKey: cursor,
  }));
  for (const item of page.Items ?? []) existing.set(String(item.siteId), item);
  cursor = page.LastEvaluatedKey;
} while (cursor);
const additions = sites.filter((site) => {
  const previous = existing.get(site.id);
  if (!previous) return true;
  if (previous.entityType !== 'SITE' || previous.tenantId !== tenantId
    || previous.name !== site.name || previous.location !== site.location) {
    throw new Error(`Site ${site.id} already exists with different metadata`);
  }
  return false;
});
console.log(JSON.stringify({ tenantId, tenant: tenant.name, existing: existing.size, additions }, null, 2));
if (args.includes('--apply') && additions.length) {
  const now = new Date().toISOString();
  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      { ConditionCheck: {
        TableName: tableName, Key: { PK: pk, SK: 'METADATA' },
        ConditionExpression: 'entityType = :entity AND tenantId = :tenant',
        ExpressionAttributeValues: { ':entity': 'TENANT', ':tenant': tenantId },
      } },
      ...additions.map((site) => ({ Put: {
        TableName: tableName, ConditionExpression: 'attribute_not_exists(PK)',
        Item: { PK: pk, SK: `SITE#${site.id}`, entityType: 'SITE', tenantId, siteId: site.id,
          ...site, createdAt: now, updatedAt: now },
      } })),
    ],
  }));
  console.log(`Added ${additions.length} sites to ${tenantId}.`);
} else {
  console.log(additions.length ? 'Dry run complete; --apply adds only the listed sites.' : 'All sites already exist; no changes needed.');
}
