import { ConflictError } from './ddb.js';

// Operator registration can precede credential installation. Fleet Provisioning
// still requires a unique bootstrap certificate before a device may connect.
export function isUnboundRegistration(record: Record<string, unknown>): boolean {
  return record.claimMechanism === 'OPERATOR_REGISTERED'
    && record.bootstrapCertificateId === undefined
    && record.bootstrapCertificateStatus === undefined;
}

export function registrationCredentialCondition(record: Record<string, unknown>): {
  expression: string;
  values: Record<string, string>;
} {
  if (isUnboundRegistration(record)) {
    return {
      expression: 'claimMechanism = :claimMechanism AND attribute_not_exists(bootstrapCertificateId) AND attribute_not_exists(bootstrapCertificateStatus)',
      values: { ':claimMechanism': 'OPERATOR_REGISTERED' },
    };
  }
  if (record.claimMechanism !== 'PRELOADED_UNIQUE_BOOTSTRAP'
    || record.bootstrapCertificateStatus !== 'ACTIVE'
    || typeof record.bootstrapCertificateId !== 'string'
    || !/^[a-f0-9]{64}$/i.test(record.bootstrapCertificateId)) {
    throw new ConflictError('Gateway bootstrap certificate binding is missing or inactive');
  }
  return {
    expression: 'claimMechanism = :claimMechanism AND bootstrapCertificateId = :bootstrapCertificateId AND bootstrapCertificateStatus = :bootstrapCertificateActive',
    values: {
      ':claimMechanism': 'PRELOADED_UNIQUE_BOOTSTRAP',
      ':bootstrapCertificateId': record.bootstrapCertificateId,
      ':bootstrapCertificateActive': 'ACTIVE',
    },
  };
}
