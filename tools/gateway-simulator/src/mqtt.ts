import { randomUUID } from 'node:crypto';
import { iot, iotidentity, mqtt } from 'aws-iot-device-sdk-v2';
import type { AssignmentResponse } from './protocol.js';
import { modeledServiceErrorMessage, validateAssignmentResponse } from './protocol.js';

export interface MqttCredentialPaths {
  certificate: string;
  privateKey: string;
  rootCa?: string;
}

export interface FleetProvisioningInput {
  endpoint: string;
  templateName: string;
  serialNumber: string;
  hardwareId: string;
  hardwareProof: string;
  claimCredentials: MqttCredentialPaths;
  csrPem: string;
  persistIssuedCertificate: (certificatePem: string) => Promise<void>;
  onProgress?: (event: FleetProvisioningProgress) => void;
}

export type FleetProvisioningProgress =
  | { phase: 'BOOTSTRAP_CONNECTED'; clientId: string }
  | { phase: 'CSR_SUBMITTED' }
  | { phase: 'CERTIFICATE_ISSUED'; certificateId: string }
  | { phase: 'REGISTER_THING_ACCEPTED'; thingName: string }
  | { phase: 'BOOTSTRAP_DISCONNECTED' };

export interface FleetProvisioningResult {
  thingName: string;
  certificateId: string;
}

export async function fleetProvision(input: FleetProvisioningInput): Promise<FleetProvisioningResult> {
  const bootstrapClientId = `bootstrap-${randomUUID().replace(/-/g, '')}`;
  const connection = createConnection(input.endpoint, bootstrapClientId, input.claimCredentials);
  const identity = iotidentity.IotIdentityClientv2.newFromMqtt311(connection, {
    maxRequestResponseSubscriptions: 6,
    maxStreamingSubscriptions: 2,
    operationTimeoutInSeconds: 60,
  });
  let bootstrapConnected = false;
  try {
    await connection.connect();
    bootstrapConnected = true;
    input.onProgress?.({ phase: 'BOOTSTRAP_CONNECTED', clientId: bootstrapClientId });
    input.onProgress?.({ phase: 'CSR_SUBMITTED' });
    const certificate = await fleetOperation(
      () => identity.createCertificateFromCsr({ certificateSigningRequest: input.csrPem }),
      'CreateCertificateFromCsr',
    );
    const certificateId = requiredProvisioningValue(certificate.certificateId, 'certificate ID');
    const certificatePem = requiredProvisioningValue(certificate.certificatePem, 'certificate PEM');
    const ownershipToken = requiredProvisioningValue(certificate.certificateOwnershipToken, 'certificate ownership token');
    // Close the permanent-identity crash gap before RegisterThing can bind this
    // certificate. The short-lived ownership token remains memory-only.
    const registration = await persistBeforeRegisterThing(
      certificatePem,
      input.persistIssuedCertificate,
      async () => {
        input.onProgress?.({ phase: 'CERTIFICATE_ISSUED', certificateId });
        return await fleetOperation(() => identity.registerThing({
          templateName: input.templateName,
          certificateOwnershipToken: ownershipToken,
          parameters: {
            SerialNumber: input.serialNumber,
            HardwareId: input.hardwareId,
            HardwareProof: input.hardwareProof,
          },
        }), 'RegisterThing');
      },
    );
    const thingName = requiredThingName(registration.thingName);
    input.onProgress?.({ phase: 'REGISTER_THING_ACCEPTED', thingName });
    return { thingName, certificateId };
  } finally {
    identity.close();
    await disconnectQuietly(connection);
    if (bootstrapConnected) input.onProgress?.({ phase: 'BOOTSTRAP_DISCONNECTED' });
  }
}

/** Enforces the local-persistence barrier before RegisterThing can be invoked. */
export async function persistBeforeRegisterThing<T>(
  certificatePem: string,
  persistIssuedCertificate: (value: string) => Promise<void>,
  registerThing: () => Promise<T>,
): Promise<T> {
  await persistIssuedCertificate(certificatePem);
  return await registerThing();
}

export async function withOperationalConnection<T>(
  endpoint: string,
  thingName: string,
  credentials: MqttCredentialPaths,
  action: (connection: mqtt.MqttClientConnection) => Promise<T>,
): Promise<T> {
  const connection = createConnection(endpoint, thingName, credentials);
  try {
    await connection.connect();
    return await action(connection);
  } finally {
    await disconnectQuietly(connection);
  }
}

export async function requestAssignment(
  connection: mqtt.MqttClientConnection,
  input: {
    thingName: string;
    generation: number;
    signingKeyId: string;
    signingPublicKeyPem: string;
    timeoutMs: number;
  },
): Promise<AssignmentResponse> {
  const requestTopic = `ce/v1/gateways/${input.thingName}/config/request`;
  const responseTopic = `ce/v1/gateways/${input.thingName}/config/response`;
  const requestId = `sim-${randomUUID()}`;
  const waiter = messageWaiter(responseTopic, requestId, input.timeoutMs);
  let raw: unknown;
  try {
    await connection.subscribe(responseTopic, mqtt.QoS.AtLeastOnce, waiter.handler);
    await connection.publish(
      requestTopic,
      JSON.stringify({ generation: input.generation, requestId }),
      mqtt.QoS.AtLeastOnce,
      false,
    );
    raw = await waiter.promise;
  } finally {
    waiter.cancel();
  }
  return validateAssignmentResponse(raw, {
    thingName: input.thingName,
    generation: input.generation,
    requestId,
    signingKeyId: input.signingKeyId,
  }, input.signingPublicKeyPem);
}

export async function publishDeviceStatus(
  connection: mqtt.MqttClientConnection,
  thingName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await connection.publish(
    `ce/v1/gateways/${thingName}/status`,
    JSON.stringify(payload),
    mqtt.QoS.AtLeastOnce,
    false,
  );
}

function createConnection(
  endpoint: string,
  clientId: string,
  credentials: MqttCredentialPaths,
): mqtt.MqttClientConnection {
  const builder = iot.AwsIotMqttConnectionConfigBuilder.new_mtls_builder_from_path(
    credentials.certificate,
    credentials.privateKey,
  )
    .with_endpoint(endpoint)
    .with_client_id(clientId)
    .with_clean_session(true)
    .with_keep_alive_seconds(30)
    .with_ping_timeout_ms(10_000)
    .with_protocol_operation_timeout_ms(30_000)
    .with_reconnect_min_sec(1)
    .with_reconnect_max_sec(8);
  if (credentials.rootCa) builder.with_certificate_authority_from_path(undefined, credentials.rootCa);
  return new mqtt.MqttClient().new_connection(builder.build());
}

function messageWaiter(
  topic: string,
  requestId: string,
  timeoutMs: number,
): { promise: Promise<unknown>; handler: (receivedTopic: string, payload: ArrayBuffer) => void; cancel: () => void } {
  let timeout: NodeJS.Timeout | undefined;
  let settled = false;
  let resolvePromise: (value: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((resolve, reject) => {
    resolvePromise = resolve;
    timeout = setTimeout(() => {
      settled = true;
      reject(new Error(`Timed out waiting for ${topic}`));
    }, timeoutMs);
  });
  const handler = (receivedTopic: string, payload: ArrayBuffer): void => {
      if (settled) return;
      if (receivedTopic !== topic) return;
      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.from(payload).toString('utf8')) as unknown;
      } catch {
        return;
      }
      if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)
        || (decoded as Record<string, unknown>).requestId !== requestId) return;
      if (timeout) clearTimeout(timeout);
      settled = true;
      resolvePromise(decoded);
  };
  const cancel = (): void => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    resolvePromise(undefined);
  };
  return { promise, handler, cancel };
}

async function disconnectQuietly(connection: mqtt.MqttClientConnection): Promise<void> {
  try {
    await connection.disconnect();
  } catch {
    // Preserve the original provisioning/apply error when teardown also fails.
  }
}

function requiredProvisioningValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Fleet Provisioning returned no ${label}`);
  return value;
}

function requiredThingName(value: unknown): string {
  const thingName = requiredProvisioningValue(value, 'Thing name');
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(thingName)) throw new Error('Fleet Provisioning returned an invalid Thing name');
  return thingName;
}

async function fleetOperation<T>(operation: () => Promise<T>, name: string): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const modeled = modeledServiceErrorMessage(error, name);
    if (modeled) throw new Error(modeled, { cause: error });
    throw error;
  }
}
