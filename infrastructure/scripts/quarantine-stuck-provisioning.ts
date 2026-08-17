import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DescribeCertificateCommand, IoTClient, UpdateCertificateCommand } from '@aws-sdk/client-iot';
import { DeleteConnectionCommand, IoTDataPlaneClient } from '@aws-sdk/client-iot-data-plane';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { requireSafeIdentifier } from '../lambda/shared/identifiers.js';

const values = process.argv.slice(2);
const argument = (name: string): string => {
  const index = values.indexOf(name);
  const value = values[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
};

const tableName = argument('--table');
const serialNumber = argument('--serial').trim().toUpperCase();
const expectedCertificateId = argument('--certificate-id').trim();
const reason = argument('--reason').trim();
const actor = requireSafeIdentifier(argument('--actor').trim(), 'actor');
const endpointHost = argument('--iot-data-endpoint').trim().replace(/^https:\/\//i, '').replace(/\/$/, '');
const apply = values.includes('--apply');
const minimumAgeMinutes = Number(values.includes('--minimum-age-minutes') ? argument('--minimum-age-minutes') : '30');
if (!/^[A-Z0-9][A-Z0-9._:-]{2,127}$/.test(serialNumber)) throw new Error('serial must use the manufacturing identifier grammar');
if (!/^[A-Za-z0-9]+$/.test(expectedCertificateId) || expectedCertificateId.length > 128) throw new Error('certificate-id is invalid');
if (!reason || reason.length > 240) throw new Error('reason is required and must not exceed 240 characters');
if (!/^[a-z0-9-]+-ats\.iot\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/.test(endpointHost)) {
  throw new Error('iot-data-endpoint must be the account Data-ATS endpoint hostname');
}
if (!Number.isSafeInteger(minimumAgeMinutes) || minimumAgeMinutes < 15 || minimumAgeMinutes > 10_080) {
  throw new Error('minimum-age-minutes must be an integer from 15 through 10080');
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const iot = new IoTClient({});
const iotData = new IoTDataPlaneClient({ endpoint: `https://${endpointHost}` });
const manufacturingKey = { PK: `SERIAL#${serialNumber}`, SK: 'MANUFACTURING' };
const current = (await ddb.send(new GetCommand({ TableName: tableName, Key: manufacturingKey, ConsistentRead: true }))).Item;
if (!current) throw new Error('Manufacturing record not found');
if (current.state !== 'PROVISIONING' && current.state !== 'RECOVERY_LOCKED') {
  throw new Error(`Record is ${String(current.state)}; only stuck PROVISIONING/RECOVERY_LOCKED records can be quarantined`);
}
if (current.certificateId !== expectedCertificateId) throw new Error('Expected certificate does not match the ledger binding');
if (typeof current.tenantId !== 'string' || typeof current.gatewayId !== 'string' || typeof current.thingName !== 'string') {
  throw new Error('Provisioning ownership binding is incomplete');
}
const observedUpdatedAt = Date.parse(String(current.updatedAt));
if (current.state === 'PROVISIONING'
  && (!Number.isFinite(observedUpdatedAt) || Date.now() - observedUpdatedAt < minimumAgeMinutes * 60_000)) {
  throw new Error(`Provisioning record is not at least ${minimumAgeMinutes} minutes old`);
}

let certificateStatus: string;
try {
  const described = await iot.send(new DescribeCertificateCommand({ certificateId: expectedCertificateId }));
  certificateStatus = described.certificateDescription?.status ?? '';
  if (!certificateStatus) throw new Error('IoT certificate status could not be verified');
} catch (error) {
  if (errorName(error) === 'ResourceNotFoundException') certificateStatus = 'NOT_FOUND';
  else throw error;
}
console.log(JSON.stringify({
  action: apply ? 'QUARANTINE_STUCK_PROVISIONING' : 'DRY_RUN',
  serialNumber,
  gatewayId: current.gatewayId,
  thingName: current.thingName,
  certificateId: expectedCertificateId,
  certificateStatus,
  currentState: current.state,
  reason,
}, null, 2));
if (!apply) {
  console.log('No changes made. Re-run with --apply after independently confirming the gateway is offline.');
  process.exit(0);
}

const tenantKey = `TENANT#${current.tenantId}`;
const gatewayKey = { PK: tenantKey, SK: `GATEWAY#${current.gatewayId}` };
const recoveryId = typeof current.recoveryId === 'string' ? current.recoveryId : `recovery_${randomUUID()}`;
const lockTime = new Date().toISOString();
if (current.state === 'PROVISIONING') {
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    {
      Update: {
        TableName: tableName,
        Key: manufacturingKey,
        UpdateExpression: 'SET #state = :locked, recoveryId = :recoveryId, recoveryReason = :reason, recoveryLockedAt = :now, updatedAt = :now',
        ConditionExpression: '#state = :provisioning AND certificateId = :certificateId AND thingName = :thingName AND updatedAt = :observedUpdatedAt',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':provisioning': 'PROVISIONING', ':locked': 'RECOVERY_LOCKED', ':recoveryId': recoveryId,
          ':reason': reason, ':now': lockTime, ':certificateId': expectedCertificateId,
          ':thingName': current.thingName, ':observedUpdatedAt': current.updatedAt,
        },
      },
    },
    {
      Update: {
        TableName: tableName,
        Key: gatewayKey,
        UpdateExpression: 'SET #state = :locked, certificateStatus = :deactivating, recoveryId = :recoveryId, updatedAt = :now',
        ConditionExpression: 'entityType = :gateway AND #state = :identityProvisioning AND certificateStatus = :pending AND certificateId = :certificateId AND thingName = :thingName',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':gateway': 'GATEWAY', ':identityProvisioning': 'IDENTITY_PROVISIONING', ':pending': 'PENDING_ACTIVATION',
          ':locked': 'RECOVERY_LOCKED', ':deactivating': 'DEACTIVATING', ':recoveryId': recoveryId,
          ':now': lockTime, ':certificateId': expectedCertificateId, ':thingName': current.thingName,
        },
      },
    },
  ] }));
} else if (current.recoveryId !== recoveryId) {
  throw new Error('Recovery lock ownership is inconsistent');
}

if (certificateStatus !== 'INACTIVE' && certificateStatus !== 'REVOKED') {
  if (certificateStatus !== 'NOT_FOUND') {
    await iot.send(new UpdateCertificateCommand({ certificateId: expectedCertificateId, newStatus: 'INACTIVE' }));
  }
}
try {
  await iotData.send(new DeleteConnectionCommand({
    clientId: String(current.thingName),
    cleanSession: true,
    preventWillMessage: true,
  }));
} catch (error) {
  if (errorName(error) !== 'ResourceNotFoundException') throw error;
}

const quarantinedAt = new Date().toISOString();
const auditId = `recovery_${randomUUID()}`;
await ddb.send(new TransactWriteCommand({ TransactItems: [
  {
    Update: {
      TableName: tableName,
      Key: manufacturingKey,
      UpdateExpression: 'SET #state = :quarantined, certificateStatus = :inactive, quarantinedAt = :now, updatedAt = :now',
      ConditionExpression: '#state = :locked AND recoveryId = :recoveryId AND certificateId = :certificateId',
      ExpressionAttributeNames: { '#state': 'state' },
      ExpressionAttributeValues: {
        ':locked': 'RECOVERY_LOCKED', ':quarantined': 'QUARANTINED', ':inactive': 'INACTIVE',
        ':recoveryId': recoveryId, ':certificateId': expectedCertificateId, ':now': quarantinedAt,
      },
    },
  },
  {
    Update: {
      TableName: tableName,
      Key: gatewayKey,
      UpdateExpression: 'SET #state = :quarantined, certificateStatus = :inactive, quarantinedAt = :now, updatedAt = :now',
      ConditionExpression: '#state = :locked AND recoveryId = :recoveryId AND certificateId = :certificateId',
      ExpressionAttributeNames: { '#state': 'state' },
      ExpressionAttributeValues: {
        ':locked': 'RECOVERY_LOCKED', ':quarantined': 'QUARANTINED', ':inactive': 'INACTIVE',
        ':recoveryId': recoveryId, ':certificateId': expectedCertificateId, ':now': quarantinedAt,
      },
    },
  },
  {
    Put: {
      TableName: tableName,
      Item: {
        PK: tenantKey,
        SK: `AUDIT#${quarantinedAt}#${auditId}`,
        entityType: 'AUDIT',
        auditId,
        tenantId: current.tenantId,
        actorSubject: actor,
        actorRole: 'RECOVERY_OPERATOR',
        action: 'STUCK_PROVISIONING_QUARANTINED',
        targetId: current.gatewayId,
        details: {
          serialNumber,
          thingName: current.thingName,
          certificateId: expectedCertificateId,
          certificateOutcome: certificateStatus === 'NOT_FOUND' ? 'NOT_FOUND' : 'INACTIVE',
          recoveryId,
          reason,
        },
        outcome: 'SUCCESS',
        createdAt: quarantinedAt,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    },
  },
] }));
console.log(`Quarantined ${serialNumber}; certificate outcome is ${certificateStatus === 'NOT_FOUND' ? 'NOT_FOUND' : 'INACTIVE'}. The record was not reset or made claimable.`);

function errorName(error: unknown): string {
  return error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name ?? '') : '';
}
