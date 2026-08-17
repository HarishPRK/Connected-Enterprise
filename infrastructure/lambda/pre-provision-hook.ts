import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { AWS_ACCOUNT_ID, AWS_REGION_NAME, TABLE_NAME } from './shared/config.js';
import {
  ddb,
  bootstrapCertificatePk,
  deploymentSk,
  gatewaySk,
  normalizeIdentifier,
  operationSk,
  serialPk,
  tenantPk,
} from './shared/ddb.js';
import { sha256 } from './shared/crypto.js';
import { requireCanonicalSerial } from './shared/manufacturing-credentials.js';

interface ProvisioningEvent {
  claimCertificateId?: string;
  certificateId?: string;
  templateArn?: string;
  clientId?: string;
  parameters?: Record<string, string>;
}

interface ManufacturingRecord extends Record<string, unknown> {
  state?: string;
  tenantId?: string;
  gatewayId?: string;
  operationId?: string;
  siteId?: string;
  profileVersionId?: string;
  verificationId?: string;
  verificationExpiresAtEpoch?: number;
  claimMechanism?: string;
  bootstrapCertificateId?: string;
  bootstrapCertificateStatus?: string;
  manufacturer?: string;
  model?: string;
  signedDescriptor?: Record<string, unknown>;
  deliveryMode?: string;
  thingName?: string;
  certificateId?: string;
}

const EXPECTED_TEMPLATE_ARN = process.env.PROVISIONING_TEMPLATE_ARN?.trim() ?? '';
const BOOTSTRAP_CLIENT_ID_PREFIX = process.env.BOOTSTRAP_CLIENT_ID_PREFIX?.trim() ?? '';
const PRELOADED_BOOTSTRAP_MECHANISM = 'PRELOADED_UNIQUE_BOOTSTRAP';

export async function handler(event: ProvisioningEvent): Promise<Record<string, unknown>> {
  try {
    if (!EXPECTED_TEMPLATE_ARN || event.templateArn !== EXPECTED_TEMPLATE_ARN) return deny('template mismatch');
    const claimCertificateId = requireCertificateId(event.claimCertificateId, 'claimCertificateId');
    const certificateId = requireCertificateId(event.certificateId, 'certificateId');
    if (claimCertificateId === certificateId) return deny('bootstrap and operational certificates must be different');
    const clientId = normalizeIdentifier(event.clientId, 'clientId', 128);
    if (!BOOTSTRAP_CLIENT_ID_PREFIX || !clientId.startsWith(BOOTSTRAP_CLIENT_ID_PREFIX)) {
      return deny('configured bootstrap client id prefix required');
    }

    const parameters = event.parameters ?? {};
    const serialNumber = requireCanonicalSerial(parameters.SerialNumber);

    const result = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: serialPk(serialNumber), SK: 'MANUFACTURING' },
      ConsistentRead: true,
    }));
    const record = result.Item as ManufacturingRecord | undefined;
    if (!record) return deny('unknown manufacturing identity');
    if (record.claimMechanism !== PRELOADED_BOOTSTRAP_MECHANISM) return deny('preloaded unique bootstrap mechanism required');
    if (record.bootstrapCertificateId !== claimCertificateId) return deny('bootstrap certificate is not authorized for this identity');
    if (record.bootstrapCertificateStatus !== 'ACTIVE') return deny('bootstrap certificate is not active for enrollment');
    const nowEpoch = Math.floor(Date.now() / 1000);
    const thingName = record.thingName ?? `gw-${sha256(serialNumber).slice(0, 24)}`;
    const idempotentRetry = ((record.state === 'PROVISIONING' && record.certificateStatus !== 'REVOKING')
      || (record.state === 'PROVISIONED' && record.certificateStatus === 'ACTIVE'))
      && record.certificateId === certificateId
      && record.thingName === thingName;
    if (idempotentRetry) {
      return allow(thingName, record.gatewayId, record.tenantId, serialNumber);
    }
    if (record.state !== 'ENROLLMENT_PENDING' || typeof record.verificationId !== 'string' || !record.verificationId) {
      return deny('server-side enrollment reservation is missing');
    }
    if (!record.tenantId || !record.gatewayId || !record.operationId || !record.siteId
      || !record.profileVersionId || !record.deliveryMode) {
      return deny('ownership reservation is incomplete');
    }
    if ((record.verificationExpiresAtEpoch ?? 0) < nowEpoch) return deny('verification expired');
    const verificationId = record.verificationId;
    const verificationExpiry = record.verificationExpiresAtEpoch;

    const certificatePrincipal = `arn:aws:iot:${AWS_REGION_NAME}:${AWS_ACCOUNT_ID}:cert/${certificateId}`;
    const now = new Date().toISOString();
    const tenantKey = tenantPk(record.tenantId);
    await ddb.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TABLE_NAME,
              Key: { PK: serialPk(serialNumber), SK: 'MANUFACTURING' },
              UpdateExpression: 'SET #state = :provisioning, certificateId = :certificateId, certificatePrincipal = :principal, thingName = :thingName, verificationConsumedAt = :now, updatedAt = :now REMOVE verificationId, verificationExpiresAtEpoch',
              ConditionExpression: [
                'entityType = :manufacturingEntity',
                '#state = :enrollmentPending',
                'tenantId = :tenantId',
                'gatewayId = :gatewayId',
                'operationId = :operationId',
                'siteId = :siteId',
                'profileVersionId = :profileVersionId',
                'deliveryMode = :deliveryMode',
                'thingName = :thingName',
                'claimMechanism = :claimMechanism',
                'bootstrapCertificateId = :bootstrapCertificateId',
                'bootstrapCertificateStatus = :bootstrapCertificateActive',
                'verificationId = :verificationId',
                'verificationExpiresAtEpoch = :verificationExpiry',
                'verificationExpiresAtEpoch >= :nowEpoch',
                '(attribute_not_exists(certificateId) OR certificateId = :certificateId)',
              ].join(' AND '),
              ExpressionAttributeNames: { '#state': 'state' },
              ExpressionAttributeValues: {
                ':enrollmentPending': 'ENROLLMENT_PENDING',
                ':provisioning': 'PROVISIONING',
                ':verificationId': verificationId,
                ':verificationExpiry': verificationExpiry,
                ':tenantId': record.tenantId,
                ':manufacturingEntity': 'MANUFACTURING',
                ':gatewayId': record.gatewayId,
                ':operationId': record.operationId,
                ':siteId': record.siteId,
                ':profileVersionId': record.profileVersionId,
                ':deliveryMode': record.deliveryMode,
                ':claimMechanism': PRELOADED_BOOTSTRAP_MECHANISM,
                ':bootstrapCertificateId': claimCertificateId,
                ':bootstrapCertificateActive': 'ACTIVE',
                ':nowEpoch': nowEpoch,
                ':certificateId': certificateId,
                ':principal': certificatePrincipal,
                ':thingName': thingName,
                ':now': now,
              },
            },
          },
          {
            Update: {
              TableName: TABLE_NAME,
              Key: { PK: tenantKey, SK: gatewaySk(record.gatewayId) },
              UpdateExpression: 'SET thingName = :thingName, certificateId = :certificateId, certificatePrincipal = :principal, certificateStatus = :certificatePending, #state = :state, updatedAt = :now, GSI1PK = :thingLookup, GSI1SK = :thingSort',
              ConditionExpression: 'entityType = :gatewayEntity AND tenantId = :tenantId AND gatewayId = :gatewayId AND serialNumber = :serialNumber AND thingName = :thingName AND siteId = :siteId AND operationId = :operationId AND desiredProfileVersionId = :profileVersionId AND #state = :pending AND certificateState = :certificateUnassigned AND generation = :generation AND desiredGeneration = :generation AND attribute_not_exists(certificateId) AND attribute_not_exists(certificatePrincipal)',
              ExpressionAttributeNames: { '#state': 'state' },
              ExpressionAttributeValues: {
                ':thingName': thingName,
                ':gatewayEntity': 'GATEWAY',
                ':tenantId': record.tenantId,
                ':gatewayId': record.gatewayId,
                ':siteId': record.siteId,
                ':operationId': record.operationId,
                ':profileVersionId': record.profileVersionId,
                ':pending': 'PENDING',
                ':certificateId': certificateId,
                ':principal': certificatePrincipal,
                ':state': 'IDENTITY_PROVISIONING',
                ':certificatePending': 'PENDING_ACTIVATION',
                ':certificateUnassigned': 'PENDING',
                ':generation': 1,
                ':now': now,
                ':thingLookup': `THING#${thingName}`,
                ':thingSort': tenantKey,
                ':serialNumber': serialNumber,
              },
            },
          },
          {
            Update: {
              TableName: TABLE_NAME,
              Key: { PK: tenantKey, SK: operationSk(record.operationId) },
              UpdateExpression: 'SET operationStatus = :status, #state = :state, updatedAt = :now, steps[1] = :identityStep, timeline = list_append(if_not_exists(timeline, :empty), :timeline)',
              ConditionExpression: 'entityType = :operationEntity AND #type = :onboard AND tenantId = :tenantId AND operationId = :operationId AND gatewayId = :gatewayId AND serialNumber = :serialNumber AND siteId = :siteId AND profileVersionId = :profileVersionId AND deliveryMode = :deliveryMode AND deploymentGeneration = :generation AND operationStatus = :inProgress AND #state = :claimAccepted AND #status = :waiting',
              ExpressionAttributeNames: { '#type': 'type', '#state': 'state', '#status': 'status' },
              ExpressionAttributeValues: {
                ':status': 'IN_PROGRESS',
                ':state': 'CSR_VERIFIED',
                ':operationEntity': 'OPERATION',
                ':onboard': 'ONBOARD',
                ':tenantId': record.tenantId,
                ':operationId': record.operationId,
                ':serialNumber': serialNumber,
                ':siteId': record.siteId,
                ':profileVersionId': record.profileVersionId,
                ':deliveryMode': record.deliveryMode,
                ':generation': 1,
                ':inProgress': 'IN_PROGRESS',
                ':claimAccepted': 'CLAIM_ACCEPTED',
                ':waiting': 'WAITING_FOR_DEVICE',
                ':now': now,
                ':empty': [],
                ':timeline': [{ state: 'CSR_VERIFIED', at: now, detail: 'The operational certificate request and reserved serial were accepted.' }],
                ':identityStep': {
                  key: 'identity',
                  label: 'Permanent identity provisioned',
                  status: 'in_progress',
                  detail: 'Certificate registered; waiting for the permanent mTLS reconnect.',
                  timestamp: now,
                },
                ':gatewayId': record.gatewayId,
              },
            },
          },
          {
            ConditionCheck: {
              TableName: TABLE_NAME,
              Key: { PK: bootstrapCertificatePk(claimCertificateId), SK: 'BINDING' },
              ConditionExpression: 'entityType = :entity AND bootstrapCertificateId = :bootstrapCertificateId AND serialNumber = :serialNumber AND tenantId = :tenantId AND #status = :active',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':entity': 'BOOTSTRAP_CERTIFICATE_BINDING', ':bootstrapCertificateId': claimCertificateId,
                ':serialNumber': serialNumber, ':tenantId': record.tenantId, ':active': 'ACTIVE',
              },
            },
          },
          {
            ConditionCheck: {
              TableName: TABLE_NAME,
              Key: { PK: tenantKey, SK: deploymentSk(record.gatewayId, 1) },
              ConditionExpression: 'entityType = :entity AND tenantId = :tenantId AND gatewayId = :gatewayId AND operationId = :operationId AND profileVersionId = :profileVersionId AND deliveryMode = :deliveryMode AND generation = :generation AND #status = :waiting',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':entity': 'DEPLOYMENT', ':tenantId': record.tenantId, ':gatewayId': record.gatewayId,
                ':operationId': record.operationId, ':profileVersionId': record.profileVersionId,
                ':deliveryMode': record.deliveryMode, ':generation': 1, ':waiting': 'WAITING_FOR_DEVICE',
              },
            },
          },
          {
            ConditionCheck: {
              TableName: TABLE_NAME,
              Key: { PK: tenantKey, SK: `VERIFICATION#${verificationId}` },
              ConditionExpression: 'entityType = :entity AND tenantId = :tenantId AND verificationId = :verificationId AND serialNumber = :serialNumber AND expiresAtEpoch = :verificationExpiry AND #state = :consumed',
              ExpressionAttributeNames: { '#state': 'state' },
              ExpressionAttributeValues: {
                ':entity': 'VERIFICATION', ':tenantId': record.tenantId, ':verificationId': verificationId,
                ':serialNumber': serialNumber, ':verificationExpiry': verificationExpiry, ':consumed': 'CONSUMED',
              },
            },
          },
        ],
    }));

    return allow(thingName, record.gatewayId, record.tenantId, serialNumber);
  } catch (error) {
    // Hook errors can contain request material. Log only the class/message.
    console.warn(JSON.stringify({ level: 'warn', action: 'deny-provisioning', error: error instanceof Error ? error.message : String(error) }));
    return deny('provisioning validation failed');
  }
}

function requireCertificateId(value: unknown, label: string): string {
  const certificateId = normalizeIdentifier(value, label, 128);
  if (!/^[a-f0-9]{64}$/i.test(certificateId)) throw new Error(`${label} must be an AWS IoT certificate ID`);
  return certificateId;
}

function deny(reason: string): Record<string, unknown> {
  return { allowProvisioning: false, parameterOverrides: {}, reason };
}

function allow(
  thingName: string,
  gatewayId: unknown,
  tenantId: unknown,
  serialNumber: string,
): Record<string, unknown> {
  if (typeof gatewayId !== 'string' || !gatewayId || typeof tenantId !== 'string' || !tenantId) {
    return deny('ownership reservation is incomplete');
  }
  return {
    allowProvisioning: true,
    parameterOverrides: { ThingName: thingName, GatewayId: gatewayId, TenantId: tenantId, SerialNumber: serialNumber },
  };
}
