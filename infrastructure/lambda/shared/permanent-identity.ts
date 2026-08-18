import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { AWS_ACCOUNT_ID, AWS_REGION_NAME, TABLE_NAME } from './config.js';
import {
  bootstrapCertificatePk,
  gatewaySk,
  operationSk,
  outboxSk,
  serialPk,
  tenantPk,
} from './ddb.js';

type Item = Record<string, unknown>;
type TransactItems = NonNullable<TransactWriteCommandInput['TransactItems']>;

export interface PermanentIdentityFinalizationDependencies {
  getItem(key: { PK: string; SK: string }): Promise<Item | undefined>;
  transactWrite(items: TransactItems): Promise<void>;
  now(): Date;
}

export interface PermanentIdentityEvidence {
  thingName: string;
  certificateId: string;
  requestId: string;
  channel: 'IOT_MQTT' | 'IOT_CREDENTIAL_PROVIDER';
}

export class PermanentIdentityFinalizationError extends Error {}

/**
 * Finalizes the first authenticated use of an operational certificate.
 *
 * The caller must first authenticate the certificate-derived Thing and
 * certificate ID. This transaction independently rechecks every stored
 * manufacturing, bootstrap, tenant, gateway, and operation binding before it
 * marks the permanent identity active and queues retirement of the bootstrap
 * certificate.
 */
export async function finalizePermanentIdentity(
  gateway: Item,
  evidence: PermanentIdentityEvidence,
  dependencies: PermanentIdentityFinalizationDependencies,
): Promise<Item> {
  const tenantId = requiredStoredString(gateway.tenantId, 'gateway tenantId');
  const gatewayId = requiredStoredString(gateway.gatewayId, 'gateway gatewayId');
  const serialNumber = requiredStoredString(gateway.serialNumber, 'gateway serialNumber');
  const operationId = requiredStoredString(gateway.operationId, 'gateway operationId');
  const certificatePrincipal = requiredStoredString(gateway.certificatePrincipal, 'gateway certificatePrincipal');
  const operationalCertificateId = requiredCertificateId(evidence.certificateId, 'operational certificateId');
  const expectedCertificatePrincipal = `arn:aws:iot:${AWS_REGION_NAME}:${AWS_ACCOUNT_ID}:cert/${operationalCertificateId}`;
  if (gateway.certificateId !== operationalCertificateId
    || gateway.thingName !== evidence.thingName
    || certificatePrincipal !== expectedCertificatePrincipal) {
    throw new PermanentIdentityFinalizationError('Gateway permanent identity binding is inconsistent');
  }
  if (gateway.state === 'DECOMMISSIONING'
    || gateway.state === 'DECOMMISSIONED'
    || gateway.certificateStatus === 'DEACTIVATING'
    || gateway.certificateStatus === 'INACTIVE') {
    throw new PermanentIdentityFinalizationError('Gateway permanent identity is not active');
  }

  const manufacturingKey = { PK: serialPk(serialNumber), SK: 'MANUFACTURING' };
  const manufacturing = await dependencies.getItem(manufacturingKey);
  if (!manufacturing
    || manufacturing.entityType !== 'MANUFACTURING'
    || manufacturing.tenantId !== tenantId
    || manufacturing.gatewayId !== gatewayId
    || manufacturing.certificateId !== operationalCertificateId
    || manufacturing.thingName !== evidence.thingName) {
    throw new PermanentIdentityFinalizationError('Manufacturing identity binding is inconsistent');
  }
  if (manufacturing.claimMechanism !== 'PRELOADED_UNIQUE_BOOTSTRAP') {
    throw new PermanentIdentityFinalizationError('Manufacturing bootstrap mechanism is inconsistent');
  }
  const bootstrapCertificateId = requiredCertificateId(
    manufacturing.bootstrapCertificateId,
    'manufacturing bootstrapCertificateId',
  );
  if (bootstrapCertificateId === operationalCertificateId) {
    throw new PermanentIdentityFinalizationError('Bootstrap and operational certificates must be different');
  }

  const bootstrapBindingKey = { PK: bootstrapCertificatePk(bootstrapCertificateId), SK: 'BINDING' };
  const bootstrapBinding = await dependencies.getItem(bootstrapBindingKey);
  if (!bootstrapBinding
    || bootstrapBinding.entityType !== 'BOOTSTRAP_CERTIFICATE_BINDING'
    || bootstrapBinding.bootstrapCertificateId !== bootstrapCertificateId
    || bootstrapBinding.serialNumber !== serialNumber
    || bootstrapBinding.tenantId !== tenantId) {
    throw new PermanentIdentityFinalizationError('Global bootstrap certificate binding is inconsistent');
  }

  if (manufacturing.state === 'PROVISIONED') {
    if (gateway.certificateStatus !== 'ACTIVE') {
      throw new PermanentIdentityFinalizationError('Provisioned gateway certificate is not active');
    }
    if (!retiredOrRetiring(manufacturing.bootstrapCertificateStatus)) {
      throw new PermanentIdentityFinalizationError('Provisioned gateway bootstrap certificate is not being retired');
    }
    if (!retiredOrRetiring(bootstrapBinding.status)) {
      throw new PermanentIdentityFinalizationError('Global bootstrap certificate binding is not being retired');
    }
    return gateway;
  }

  if (manufacturing.state !== 'PROVISIONING'
    || manufacturing.operationId !== operationId
    || manufacturing.bootstrapCertificateStatus !== 'ACTIVE'
    || bootstrapBinding.status !== 'ACTIVE'
    || gateway.state !== 'IDENTITY_PROVISIONING'
    || gateway.certificateStatus !== 'PENDING_ACTIVATION') {
    throw new PermanentIdentityFinalizationError('Gateway is not awaiting permanent identity activation');
  }

  const now = dependencies.now().toISOString();
  const tenantKey = tenantPk(tenantId);
  const requestId = requiredRequestId(evidence.requestId);
  const bootstrapDeactivationOutboxId = `bootstrap_${requestId}`.slice(0, 128);
  const identityDetail = evidence.channel === 'IOT_MQTT'
    ? 'Permanent certificate authenticated by the IoT broker.'
    : 'Permanent certificate authenticated by AWS IoT credentials provider.';

  try {
    await dependencies.transactWrite([
      {
        Update: {
          TableName: TABLE_NAME,
          Key: bootstrapBindingKey,
          UpdateExpression: 'SET #status = :deactivating, deactivationRequestedAt = if_not_exists(deactivationRequestedAt, :now), updatedAt = :now',
          ConditionExpression: 'entityType = :entity AND bootstrapCertificateId = :bootstrapCertificateId AND serialNumber = :serialNumber AND tenantId = :tenantId AND #status = :active',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':entity': 'BOOTSTRAP_CERTIFICATE_BINDING',
            ':bootstrapCertificateId': bootstrapCertificateId,
            ':serialNumber': serialNumber,
            ':tenantId': tenantId,
            ':active': 'ACTIVE',
            ':deactivating': 'DEACTIVATING',
            ':now': now,
          },
        },
      },
      {
        Update: {
          TableName: TABLE_NAME,
          Key: manufacturingKey,
          UpdateExpression: 'SET #state = :provisioned, certificateStatus = :active, bootstrapCertificateStatus = :bootstrapDeactivating, bootstrapDeactivationRequestedAt = if_not_exists(bootstrapDeactivationRequestedAt, :now), provisionedAt = if_not_exists(provisionedAt, :now), updatedAt = :now',
          ConditionExpression: 'entityType = :manufacturing AND #state = :provisioning AND tenantId = :tenantId AND gatewayId = :gatewayId AND operationId = :operationId AND certificateId = :certificateId AND thingName = :thingName AND claimMechanism = :claimMechanism AND bootstrapCertificateId = :bootstrapCertificateId AND bootstrapCertificateStatus = :bootstrapActive',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':manufacturing': 'MANUFACTURING',
            ':provisioning': 'PROVISIONING',
            ':provisioned': 'PROVISIONED',
            ':active': 'ACTIVE',
            ':tenantId': tenantId,
            ':gatewayId': gatewayId,
            ':operationId': operationId,
            ':certificateId': operationalCertificateId,
            ':thingName': evidence.thingName,
            ':now': now,
            ':claimMechanism': 'PRELOADED_UNIQUE_BOOTSTRAP',
            ':bootstrapCertificateId': bootstrapCertificateId,
            ':bootstrapActive': 'ACTIVE',
            ':bootstrapDeactivating': 'DEACTIVATING',
          },
        },
      },
      {
        Update: {
          TableName: TABLE_NAME,
          Key: { PK: tenantKey, SK: gatewaySk(gatewayId) },
          UpdateExpression: 'SET #state = :identityActive, certificateStatus = :active, lastAuthenticatedAt = :now, updatedAt = :now',
          ConditionExpression: 'entityType = :gateway AND #state = :identityProvisioning AND certificateStatus = :pending AND thingName = :thingName AND certificateId = :certificateId AND certificatePrincipal = :certificatePrincipal',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':gateway': 'GATEWAY',
            ':identityProvisioning': 'IDENTITY_PROVISIONING',
            ':identityActive': 'PERMANENT_IDENTITY_ACTIVE',
            ':pending': 'PENDING_ACTIVATION',
            ':active': 'ACTIVE',
            ':thingName': evidence.thingName,
            ':certificateId': operationalCertificateId,
            ':certificatePrincipal': certificatePrincipal,
            ':now': now,
          },
        },
      },
      {
        Update: {
          TableName: TABLE_NAME,
          Key: { PK: tenantKey, SK: operationSk(operationId) },
          UpdateExpression: 'SET operationStatus = :inProgress, #state = :identityActive, updatedAt = :now, steps[1] = :identityStep, timeline = list_append(if_not_exists(timeline, :empty), :events)',
          ConditionExpression: 'entityType = :operation AND gatewayId = :gatewayId AND #state = :csrVerified',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':operation': 'OPERATION',
            ':gatewayId': gatewayId,
            ':csrVerified': 'CSR_VERIFIED',
            ':inProgress': 'IN_PROGRESS',
            ':identityActive': 'OPERATIONAL_IDENTITY_ISSUED',
            ':now': now,
            ':empty': [],
            ':events': [{ state: 'OPERATIONAL_IDENTITY_ISSUED', at: now, detail: identityDetail }],
            ':identityStep': {
              key: 'identity',
              label: 'Permanent identity provisioned',
              status: 'complete',
              detail: identityDetail,
              timestamp: now,
            },
          },
        },
      },
      {
        Put: {
          TableName: TABLE_NAME,
          Item: {
            PK: tenantKey,
            SK: outboxSk(now, bootstrapDeactivationOutboxId),
            entityType: 'OUTBOX',
            outboxId: bootstrapDeactivationOutboxId,
            eventType: 'DEACTIVATE_BOOTSTRAP_CERTIFICATE',
            state: 'PENDING',
            tenantId,
            gatewayId,
            operationId,
            serialNumber,
            thingName: evidence.thingName,
            certificateId: operationalCertificateId,
            bootstrapCertificateId,
            createdAt: now,
            updatedAt: now,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
    ]);
  } catch (error) {
    // A duplicate first request can lose the transaction race. Accept it only
    // after consistent rereads prove that this exact identity won the CAS.
    const [freshGateway, freshManufacturing, freshBootstrapBinding] = await Promise.all([
      dependencies.getItem({ PK: tenantKey, SK: gatewaySk(gatewayId) }),
      dependencies.getItem(manufacturingKey),
      dependencies.getItem(bootstrapBindingKey),
    ]);
    if (freshManufacturing?.entityType === 'MANUFACTURING'
      && freshManufacturing.state === 'PROVISIONED'
      && freshManufacturing.tenantId === tenantId
      && freshManufacturing.gatewayId === gatewayId
      && freshManufacturing.operationId === operationId
      && freshManufacturing.claimMechanism === 'PRELOADED_UNIQUE_BOOTSTRAP'
      && freshManufacturing.certificateId === operationalCertificateId
      && freshManufacturing.thingName === evidence.thingName
      && freshManufacturing.bootstrapCertificateId === bootstrapCertificateId
      && retiredOrRetiring(freshManufacturing.bootstrapCertificateStatus)
      && freshBootstrapBinding?.entityType === 'BOOTSTRAP_CERTIFICATE_BINDING'
      && freshBootstrapBinding.bootstrapCertificateId === bootstrapCertificateId
      && freshBootstrapBinding.serialNumber === serialNumber
      && freshBootstrapBinding.tenantId === tenantId
      && retiredOrRetiring(freshBootstrapBinding.status)
      && freshGateway?.entityType === 'GATEWAY'
      && freshGateway.tenantId === tenantId
      && freshGateway.gatewayId === gatewayId
      && freshGateway.certificateStatus === 'ACTIVE'
      && freshGateway.certificateId === operationalCertificateId
      && freshGateway.certificatePrincipal === certificatePrincipal
      && freshGateway.thingName === evidence.thingName) {
      return freshGateway;
    }
    throw error;
  }

  return {
    ...gateway,
    state: 'PERMANENT_IDENTITY_ACTIVE',
    certificateStatus: 'ACTIVE',
    lastAuthenticatedAt: now,
    updatedAt: now,
  };
}

function retiredOrRetiring(value: unknown): boolean {
  return value === 'DEACTIVATING' || value === 'INACTIVE';
}

function requiredCertificateId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new PermanentIdentityFinalizationError(`${label} must be an AWS IoT certificate ID`);
  }
  return value;
}

function requiredStoredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) {
    throw new PermanentIdentityFinalizationError(`Missing ${label}`);
  }
  return value;
}

function requiredRequestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new PermanentIdentityFinalizationError('Missing or invalid finalization request ID');
  }
  return value;
}
