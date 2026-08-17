import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { AWS_ACCOUNT_ID, AWS_REGION_NAME, TABLE_NAME } from './shared/config.js';
import {
  ddb,
  gatewaySk,
  normalizeIdentifier,
  operationSk,
  serialPk,
  tenantPk,
} from './shared/ddb.js';
import { hardwareProofDigest, safeDigestEqual, sha256 } from './shared/crypto.js';
import { HARDWARE_PROOF_KEY_VERSION, HARDWARE_PROOF_SCHEME, requireCanonicalSerial, requireHardwareId } from './shared/manufacturing-credentials.js';

interface ProvisioningEvent {
  claimCertificateId?: string;
  certificateId?: string;
  certificateStatus?: string;
  credentialScheme?: string;
  credentialKeyVersion?: number;
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
  hardwareId?: string;
  hardwareProofDigest?: string;
  claimCertificateId?: string;
  manufacturer?: string;
  model?: string;
  signedDescriptor?: Record<string, unknown>;
  deliveryMode?: string;
  thingName?: string;
  certificateId?: string;
}

const EXPECTED_TEMPLATE_ARN = process.env.PROVISIONING_TEMPLATE_ARN?.trim() ?? '';

export async function handler(event: ProvisioningEvent): Promise<Record<string, unknown>> {
  try {
    if (!EXPECTED_TEMPLATE_ARN || event.templateArn !== EXPECTED_TEMPLATE_ARN) return deny('template mismatch');
    const claimCertificateId = normalizeIdentifier(event.claimCertificateId, 'claimCertificateId', 128);
    const certificateId = normalizeIdentifier(event.certificateId, 'certificateId', 128);
    const clientId = normalizeIdentifier(event.clientId, 'clientId', 128);
    if (!clientId.startsWith('bootstrap-')) return deny('bootstrap client id required');

    const parameters = event.parameters ?? {};
    const serialNumber = requireCanonicalSerial(parameters.SerialNumber);
    const hardwareId = requireHardwareId(parameters.HardwareId);
    const suppliedDigest = await hardwareProofDigest(serialNumber, parameters.HardwareProof);

    const result = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: serialPk(serialNumber), SK: 'MANUFACTURING' },
      ConsistentRead: true,
    }));
    const record = result.Item as ManufacturingRecord | undefined;
    if (!record) return deny('unknown manufacturing identity');
    if (record.credentialScheme !== HARDWARE_PROOF_SCHEME || record.credentialKeyVersion !== HARDWARE_PROOF_KEY_VERSION) {
      return deny('unsupported manufacturing credential scheme');
    }
    if (!safeDigestEqual(record.hardwareProofDigest, suppliedDigest)) return deny('hardware proof rejected');
    if (record.hardwareId !== hardwareId) return deny('hardware identity mismatch');
    if (record.claimCertificateId !== claimCertificateId) return deny('claim certificate is not authorized for this identity');
    const thingName = record.thingName ?? `gw-${sha256(serialNumber).slice(0, 24)}`;
    const idempotentRetry = ((record.state === 'PROVISIONING' && record.certificateStatus !== 'REVOKING')
      || (record.state === 'PROVISIONED' && record.certificateStatus === 'ACTIVE'))
      && record.certificateId === certificateId
      && record.thingName === thingName;
    if (idempotentRetry) {
      return allow(thingName, record.gatewayId, record.tenantId, serialNumber, hardwareId);
    }
    if (record.state !== 'ENROLLMENT_PENDING' || typeof record.verificationId !== 'string' || !record.verificationId) {
      return deny('server-side enrollment reservation is missing');
    }
    if (!record.tenantId || !record.gatewayId || !record.operationId || !record.siteId || !record.profileVersionId) {
      return deny('ownership reservation is incomplete');
    }
    if ((record.verificationExpiresAtEpoch ?? 0) < Math.floor(Date.now() / 1000)) return deny('verification expired');
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
              ConditionExpression: '#state = :enrollmentPending AND verificationId = :verificationId AND verificationExpiresAtEpoch = :verificationExpiry AND tenantId = :tenantId AND (attribute_not_exists(certificateId) OR certificateId = :certificateId)',
              ExpressionAttributeNames: { '#state': 'state' },
              ExpressionAttributeValues: {
                ':enrollmentPending': 'ENROLLMENT_PENDING',
                ':provisioning': 'PROVISIONING',
                ':verificationId': verificationId,
                ':verificationExpiry': verificationExpiry,
                ':tenantId': record.tenantId,
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
              ConditionExpression: 'attribute_exists(PK) AND serialNumber = :serialNumber',
              ExpressionAttributeNames: { '#state': 'state' },
              ExpressionAttributeValues: {
                ':thingName': thingName,
                ':certificateId': certificateId,
                ':principal': certificatePrincipal,
                ':state': 'IDENTITY_PROVISIONING',
                ':certificatePending': 'PENDING_ACTIVATION',
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
              ConditionExpression: 'attribute_exists(PK) AND gatewayId = :gatewayId',
              ExpressionAttributeNames: { '#state': 'state' },
              ExpressionAttributeValues: {
                ':status': 'IN_PROGRESS',
                ':state': 'CSR_VERIFIED',
                ':now': now,
                ':empty': [],
                ':timeline': [{ state: 'CSR_VERIFIED', at: now, detail: 'The device CSR and one-time hardware proof were accepted.' }],
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
        ],
    }));

    return allow(thingName, record.gatewayId, record.tenantId, serialNumber, hardwareId);
  } catch (error) {
    // Hook errors can contain request material. Log only the class/message.
    console.warn(JSON.stringify({ level: 'warn', action: 'deny-provisioning', error: error instanceof Error ? error.message : String(error) }));
    return deny('provisioning validation failed');
  }
}

function deny(reason: string): Record<string, unknown> {
  return { allowProvisioning: false, parameterOverrides: {}, reason };
}

function allow(
  thingName: string,
  gatewayId: unknown,
  tenantId: unknown,
  serialNumber: string,
  hardwareId: string,
): Record<string, unknown> {
  if (typeof gatewayId !== 'string' || !gatewayId || typeof tenantId !== 'string' || !tenantId) {
    return deny('ownership reservation is incomplete');
  }
  return {
    allowProvisioning: true,
    parameterOverrides: { ThingName: thingName, GatewayId: gatewayId, TenantId: tenantId, SerialNumber: serialNumber, HardwareId: hardwareId },
  };
}
