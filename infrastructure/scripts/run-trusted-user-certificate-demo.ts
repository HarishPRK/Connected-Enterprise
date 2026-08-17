import { createPublicKey } from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { chmod, lstat, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CreateProvisioningClaimCommand, IoTClient } from '@aws-sdk/client-iot';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { requireSafeIdentifier } from '../lambda/shared/identifiers.js';
import {
  requireActivationCode,
  requireCanonicalSerial,
  requireHardwareId,
} from '../lambda/shared/manufacturing-credentials.js';

const TRUSTED_USER_PENDING = 'TRUSTED_USER_PENDING';
const CERTIFICATE_ID_PATTERN = /^[a-f0-9]{64}$/i;
const execFile = promisify(execFileCallback);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const args = process.argv.slice(2);

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Trusted-user certificate demo failed: ${message.replace(/[\r\n]+/g, ' ').slice(0, 500)}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const requestedStateDirectory = resolve(required('--state-dir'));
  const metadata = parseObject(await readFile(resolve(requestedStateDirectory, 'trusted-user-demo.json'), 'utf8'), 'demo metadata');
  if (metadata.version !== 2 || metadata.mechanism !== 'AWS_IOT_TRUSTED_USER_FIVE_MINUTE_CLAIM') {
    throw new Error('Demo metadata is not a trusted-user certificate-handoff contract');
  }
  const region = requireRegion(requireString(metadata.region, 'metadata region'));
  const tableName = requireSafeIdentifier(requireString(metadata.tableName, 'metadata tableName'), 'metadata tableName', 255);
  const tenantId = requireSafeIdentifier(requireString(metadata.tenantId, 'metadata tenantId'), 'metadata tenantId');
  const serialNumber = requireCanonicalSerial(requireString(metadata.serialNumber, 'metadata serialNumber'));
  const stateDirectory = await validateStateDirectory(requestedStateDirectory, serialNumber);
  const hardwareId = requireHardwareId(requireString(metadata.hardwareId, 'metadata hardwareId'));
  const modelId = requireSafeIdentifier(requireString(metadata.modelId, 'metadata modelId'), 'metadata modelId');
  const siteId = requireSafeIdentifier(requireString(metadata.siteId, 'metadata siteId'), 'metadata siteId');
  const profileVersionId = requireSafeIdentifier(
    requireString(metadata.profileVersionId, 'metadata profileVersionId'),
    'metadata profileVersionId',
  );
  const deliveryMode = requireDeliveryMode(metadata.deliveryMode);
  const endpoint = requireEndpoint(requireString(metadata.endpoint, 'metadata endpoint'));
  const templateName = requireSafeIdentifier(requireString(metadata.templateName, 'metadata templateName'), 'metadata templateName');
  const signingKeyId = requireString(metadata.signingKeyId, 'metadata signingKeyId');
  const generation = requirePositiveInteger(metadata.generation, 'metadata generation');
  if (generation !== 1) throw new Error('Certificate-handoff demo requires generation 1');

  const paths = {
    proof: resolve(stateDirectory, 'activation-code.txt'),
    signingPublicKey: resolve(stateDirectory, 'profile-signing-public-key.der'),
    claimCertificate: resolve(stateDirectory, 'claim-certificate.pem'),
    claimPrivateKey: resolve(stateDirectory, 'claim-private-key.pem'),
    identity: resolve(stateDirectory, 'identity.json'),
    deviceCertificate: resolve(stateDirectory, 'device-certificate.pem'),
    devicePrivateKey: resolve(stateDirectory, 'device-private-key.pem'),
  };
  await assertFreshLocalState(stateDirectory, paths);
  await makePrivateDirectory(stateDirectory);
  requireActivationCode(await readFile(paths.proof, 'utf8'));
  await validateSigningPublicKey(paths.signingPublicKey);

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const manufacturingResult = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `SERIAL#${serialNumber}`, SK: 'MANUFACTURING' },
    ConsistentRead: true,
  }));
  const record = manufacturingResult.Item;
  if (!record || record.entityType !== 'MANUFACTURING') throw new Error('Manufacturing record is unavailable');
  assertEqual(record.serialNumber, serialNumber, 'manufacturing serial');
  assertEqual(record.tenantId, tenantId, 'manufacturing tenant');
  assertEqual(record.hardwareId, hardwareId, 'manufacturing hardware ID');
  assertEqual(record.modelId, modelId, 'manufacturing model');
  assertEqual(record.siteId, siteId, 'selected site');
  assertEqual(record.profileVersionId, profileVersionId, 'selected profile version');
  assertEqual(record.deliveryMode, deliveryMode, 'selected delivery mode');
  assertEqual(record.demoExpectedProfileVersionId, profileVersionId, 'demo profile binding');
  assertEqual(record.demoExpectedDeliveryMode, deliveryMode, 'demo delivery binding');
  if (!Array.isArray(record.allowedSiteIds) || !record.allowedSiteIds.includes(siteId)) {
    throw new Error('Manufacturing record is not authorized for the selected site');
  }
  if (record.state !== 'ENROLLMENT_PENDING') {
    throw new Error('Finish Verify device and Start secure activation in the UI before issuing the five-minute claim');
  }
  if (record.claimMechanism !== 'TRUSTED_USER_FIVE_MINUTE') {
    throw new Error('Manufacturing record does not use the trusted-user five-minute claim mechanism');
  }
  if (record.certificateId !== undefined || record.certificatePrincipal !== undefined || record.verificationConsumedAt !== undefined) {
    throw new Error('A permanent certificate is already bound or provisioning has started');
  }

  const observedNowEpoch = Math.floor(Date.now() / 1000);
  const verificationId = requireSafeIdentifier(record.verificationId, 'verificationId');
  const verificationExpiry = requirePositiveInteger(record.verificationExpiresAtEpoch, 'verification expiry');
  if (verificationExpiry < observedNowEpoch + 420) {
    throw new Error('UI verification has less than seven minutes remaining; prepare a fresh demo identity');
  }
  const gatewayId = requireSafeIdentifier(record.gatewayId, 'gatewayId');
  const operationId = requireSafeIdentifier(record.operationId, 'operationId');
  const thingName = requireSafeIdentifier(record.thingName, 'thingName');
  const previousClaim = requireString(record.claimCertificateId, 'manufacturing claimCertificateId');
  let previousClaimExpiry: number | undefined;
  if (previousClaim === TRUSTED_USER_PENDING) {
    if (record.trustedClaimIssuedAt !== undefined || record.trustedClaimExpiresAtEpoch !== undefined) {
      throw new Error('Trusted-user claim sentinel has inconsistent prior-claim metadata');
    }
  } else {
    if (!CERTIFICATE_ID_PATTERN.test(previousClaim)) throw new Error('Prior trusted-user claim ID is invalid');
    previousClaimExpiry = requirePositiveInteger(record.trustedClaimExpiresAtEpoch, 'prior trusted-user claim expiry');
    if (previousClaimExpiry >= observedNowEpoch) {
      throw new Error('A trusted-user claim is still active; wait for its five-minute expiry before retrying');
    }
  }

  const tenantKey = `TENANT#${tenantId}`;
  const [gateway, operation, deployment, verification] = await Promise.all([
    ddb.send(new GetCommand({ TableName: tableName, Key: { PK: tenantKey, SK: `GATEWAY#${gatewayId}` }, ConsistentRead: true })),
    ddb.send(new GetCommand({ TableName: tableName, Key: { PK: tenantKey, SK: `OPERATION#${operationId}` }, ConsistentRead: true })),
    ddb.send(new GetCommand({
      TableName: tableName,
      Key: { PK: tenantKey, SK: `DEPLOYMENT#${gatewayId}#${String(generation).padStart(12, '0')}` },
      ConsistentRead: true,
    })),
    ddb.send(new GetCommand({ TableName: tableName, Key: { PK: tenantKey, SK: `VERIFICATION#${verificationId}` }, ConsistentRead: true })),
  ]);
  validateGateway(gateway.Item, { tenantId, gatewayId, serialNumber, thingName, siteId, operationId, profileVersionId, generation });
  validateOperation(operation.Item, {
    tenantId, gatewayId, operationId, serialNumber, siteId, profileVersionId, deliveryMode, generation,
  });
  validateDeployment(deployment.Item, { tenantId, gatewayId, operationId, profileVersionId, deliveryMode, generation });
  validateVerification(verification.Item, { tenantId, verificationId, serialNumber, verificationExpiry });

  let claimCertificateId: string | undefined;
  let claimExpiration: Date | undefined;
  try {
    console.log('Requesting an AWS IoT trusted-user provisioning claim (five-minute lifetime)...');
    const claim = await new IoTClient({ region }).send(new CreateProvisioningClaimCommand({ templateName }));
    claimCertificateId = requireCertificateId(claim.certificateId, 'temporary claim certificate ID');
    const claimCertificatePem = requireCertificatePem(claim.certificatePem);
    const claimPrivateKey = requirePrivateKeyPem(claim.keyPair?.PrivateKey);
    claimExpiration = claim.expiration instanceof Date ? claim.expiration : new Date(String(claim.expiration));
    const receivedNowEpoch = Math.floor(Date.now() / 1000);
    const claimExpiresAtEpoch = Math.floor(claimExpiration.getTime() / 1000);
    const remainingSeconds = claimExpiresAtEpoch - receivedNowEpoch;
    if (!Number.isFinite(claimExpiresAtEpoch) || remainingSeconds < 270 || remainingSeconds > 330) {
      throw new Error('AWS returned a provisioning claim outside the expected five-minute lifetime');
    }
    if (verificationExpiry < receivedNowEpoch + 180) throw new Error('UI verification became too short while issuing the claim');

    await writePrivate(paths.claimCertificate, claimCertificatePem);
    await writePrivate(paths.claimPrivateKey, claimPrivateKey);
    await bindClaimTransaction(ddb, {
      tableName,
      tenantId,
      serialNumber,
      hardwareId,
      modelId,
      siteId,
      profileVersionId,
      deliveryMode,
      verificationId,
      verificationExpiry,
      gatewayId,
      operationId,
      thingName,
      generation,
      previousClaim,
      ...(previousClaimExpiry !== undefined ? { previousClaimExpiry } : {}),
      claimCertificateId,
      claimExpiresAtEpoch,
      bindNowEpoch: receivedNowEpoch,
    });

    console.log(`Temporary claim issued; it expires at ${claimExpiration.toISOString()}.`);
    console.log('Launching the claim-to-permanent-certificate simulator immediately...');
    const exitCode = await spawnSimulator({
      endpoint,
      templateName,
      serialNumber,
      hardwareId,
      generation,
      stateDirectory,
      signingKeyId,
      thingName,
      paths,
    });
    if (exitCode !== 0) throw new Error(`Gateway simulator exited with code ${exitCode}`);

    const permanentCertificateId = await validatePermanentIdentity(paths, {
      endpoint, templateName, serialNumber, hardwareId, thingName, gatewayId, tenantId,
    });
    if (permanentCertificateId === claimCertificateId) throw new Error('Permanent certificate unexpectedly equals the temporary claim');
    await rm(paths.proof, { force: true });
    await markLocalCleanup(ddb, tableName, serialNumber, claimCertificateId, permanentCertificateId);
    console.log('Certificate handoff complete. Temporary claim files and one-time proof were removed locally.');
    console.log(`Permanent per-device identity ${permanentCertificateId} reconnected as ${thingName}.`);
  } finally {
    // These paths were required absent before CreateProvisioningClaim, so this
    // cleanup can remove only files created by this invocation.
    await Promise.all([
      rm(paths.claimCertificate, { force: true }),
      rm(paths.claimPrivateKey, { force: true }),
    ]);
    if (claimExpiration && process.exitCode) {
      console.error(`The AWS temporary claim expires automatically at ${claimExpiration.toISOString()}.`);
    }
  }
}

async function bindClaimTransaction(
  ddb: DynamoDBDocumentClient,
  input: {
    tableName: string;
    tenantId: string;
    serialNumber: string;
    hardwareId: string;
    modelId: string;
    siteId: string;
    profileVersionId: string;
    deliveryMode: 'SHADOW';
    verificationId: string;
    verificationExpiry: number;
    gatewayId: string;
    operationId: string;
    thingName: string;
    generation: number;
    previousClaim: string;
    previousClaimExpiry?: number;
    claimCertificateId: string;
    claimExpiresAtEpoch: number;
    bindNowEpoch: number;
  },
): Promise<void> {
  const tenantKey = `TENANT#${input.tenantId}`;
  const now = new Date().toISOString();
  const priorCondition = input.previousClaim === TRUSTED_USER_PENDING
    ? 'attribute_not_exists(trustedClaimIssuedAt) AND attribute_not_exists(trustedClaimExpiresAtEpoch)'
    : 'trustedClaimExpiresAtEpoch = :previousClaimExpiry AND trustedClaimExpiresAtEpoch < :bindNowEpoch';
  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      {
        Update: {
          TableName: input.tableName,
          Key: { PK: `SERIAL#${input.serialNumber}`, SK: 'MANUFACTURING' },
          UpdateExpression: 'SET claimCertificateId = :claim, trustedClaimExpiresAtEpoch = :claimExpiry, trustedClaimIssuedAt = :now, updatedAt = :now',
          ConditionExpression: [
            'entityType = :manufacturingEntity',
            'serialNumber = :serialNumber',
            'tenantId = :tenantId',
            'hardwareId = :hardwareId',
            'modelId = :modelId',
            'siteId = :siteId',
            'profileVersionId = :profileVersionId',
            'deliveryMode = :deliveryMode',
            'demoExpectedProfileVersionId = :profileVersionId',
            'demoExpectedDeliveryMode = :deliveryMode',
            '#state = :enrollmentPending',
            'claimMechanism = :mechanism',
            'claimCertificateId = :previousClaim',
            'verificationId = :verificationId',
            'verificationExpiresAtEpoch = :verificationExpiry',
            'verificationExpiresAtEpoch > :minimumVerificationExpiry',
            'gatewayId = :gatewayId',
            'operationId = :operationId',
            'thingName = :thingName',
            'attribute_not_exists(certificateId)',
            'attribute_not_exists(certificatePrincipal)',
            'attribute_not_exists(verificationConsumedAt)',
            priorCondition,
          ].join(' AND '),
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':manufacturingEntity': 'MANUFACTURING',
            ':serialNumber': input.serialNumber,
            ':tenantId': input.tenantId,
            ':hardwareId': input.hardwareId,
            ':modelId': input.modelId,
            ':siteId': input.siteId,
            ':profileVersionId': input.profileVersionId,
            ':deliveryMode': input.deliveryMode,
            ':enrollmentPending': 'ENROLLMENT_PENDING',
            ':mechanism': 'TRUSTED_USER_FIVE_MINUTE',
            ':previousClaim': input.previousClaim,
            ':previousClaimExpiry': input.previousClaimExpiry,
            ':claim': input.claimCertificateId,
            ':claimExpiry': input.claimExpiresAtEpoch,
            ':verificationId': input.verificationId,
            ':verificationExpiry': input.verificationExpiry,
            ':minimumVerificationExpiry': input.bindNowEpoch + 180,
            ':gatewayId': input.gatewayId,
            ':operationId': input.operationId,
            ':thingName': input.thingName,
            ':bindNowEpoch': input.bindNowEpoch,
            ':now': now,
          },
        },
      },
      {
        ConditionCheck: {
          TableName: input.tableName,
          Key: { PK: tenantKey, SK: `GATEWAY#${input.gatewayId}` },
          ConditionExpression: 'entityType = :entity AND tenantId = :tenantId AND gatewayId = :gatewayId AND serialNumber = :serialNumber AND thingName = :thingName AND siteId = :siteId AND operationId = :operationId AND desiredProfileVersionId = :profileVersionId AND #state = :pending AND certificateState = :certificatePending AND generation = :generation AND desiredGeneration = :generation AND attribute_not_exists(certificateId) AND attribute_not_exists(certificatePrincipal)',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':entity': 'GATEWAY', ':tenantId': input.tenantId, ':gatewayId': input.gatewayId,
            ':serialNumber': input.serialNumber, ':thingName': input.thingName, ':siteId': input.siteId,
            ':operationId': input.operationId, ':profileVersionId': input.profileVersionId,
            ':pending': 'PENDING', ':certificatePending': 'PENDING', ':generation': input.generation,
          },
        },
      },
      {
        ConditionCheck: {
          TableName: input.tableName,
          Key: { PK: tenantKey, SK: `OPERATION#${input.operationId}` },
          ConditionExpression: 'entityType = :entity AND #type = :type AND tenantId = :tenantId AND operationId = :operationId AND gatewayId = :gatewayId AND serialNumber = :serialNumber AND siteId = :siteId AND profileVersionId = :profileVersionId AND deliveryMode = :deliveryMode AND deploymentGeneration = :generation AND operationStatus = :inProgress AND #state = :claimAccepted AND #status = :waiting',
          ExpressionAttributeNames: { '#type': 'type', '#state': 'state', '#status': 'status' },
          ExpressionAttributeValues: {
            ':entity': 'OPERATION', ':type': 'ONBOARD', ':tenantId': input.tenantId,
            ':operationId': input.operationId, ':gatewayId': input.gatewayId, ':serialNumber': input.serialNumber,
            ':siteId': input.siteId, ':profileVersionId': input.profileVersionId, ':deliveryMode': input.deliveryMode,
            ':generation': input.generation, ':inProgress': 'IN_PROGRESS', ':claimAccepted': 'CLAIM_ACCEPTED',
            ':waiting': 'WAITING_FOR_DEVICE',
          },
        },
      },
      {
        ConditionCheck: {
          TableName: input.tableName,
          Key: { PK: tenantKey, SK: `DEPLOYMENT#${input.gatewayId}#${String(input.generation).padStart(12, '0')}` },
          ConditionExpression: 'entityType = :entity AND tenantId = :tenantId AND gatewayId = :gatewayId AND operationId = :operationId AND profileVersionId = :profileVersionId AND deliveryMode = :deliveryMode AND generation = :generation AND #status = :waiting',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':entity': 'DEPLOYMENT', ':tenantId': input.tenantId, ':gatewayId': input.gatewayId,
            ':operationId': input.operationId, ':profileVersionId': input.profileVersionId,
            ':deliveryMode': input.deliveryMode, ':generation': input.generation, ':waiting': 'WAITING_FOR_DEVICE',
          },
        },
      },
      {
        ConditionCheck: {
          TableName: input.tableName,
          Key: { PK: tenantKey, SK: `VERIFICATION#${input.verificationId}` },
          ConditionExpression: 'entityType = :entity AND tenantId = :tenantId AND verificationId = :verificationId AND serialNumber = :serialNumber AND expiresAtEpoch = :verificationExpiry AND #state = :consumed',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':entity': 'VERIFICATION', ':tenantId': input.tenantId, ':verificationId': input.verificationId,
            ':serialNumber': input.serialNumber, ':verificationExpiry': input.verificationExpiry, ':consumed': 'CONSUMED',
          },
        },
      },
    ],
  }));
}

async function spawnSimulator(input: {
  endpoint: string;
  templateName: string;
  serialNumber: string;
  hardwareId: string;
  generation: number;
  stateDirectory: string;
  signingKeyId: string;
  thingName: string;
  paths: {
    proof: string;
    signingPublicKey: string;
    claimCertificate: string;
    claimPrivateKey: string;
  };
}): Promise<number> {
  const tsxCli = resolve(repositoryRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const simulatorEntry = resolve(repositoryRoot, 'tools', 'gateway-simulator', 'src', 'index.ts');
  await Promise.all([requireExistingFile(tsxCli, 'tsx runtime'), requireExistingFile(simulatorEntry, 'simulator entry')]);
  const childArgs = [
    tsxCli,
    simulatorEntry,
    '--endpoint', input.endpoint,
    '--template', input.templateName,
    '--serial', input.serialNumber,
    '--hardware-id', input.hardwareId,
    '--generation', String(input.generation),
    '--state-dir', input.stateDirectory,
    '--claim-cert', input.paths.claimCertificate,
    '--claim-key', input.paths.claimPrivateKey,
    '--signing-public-key', input.paths.signingPublicKey,
    '--signing-key-id', input.signingKeyId,
    '--expected-thing-name', input.thingName,
    '--hardware-proof-file', input.paths.proof,
    '--stop-after-identity',
  ];
  return await new Promise<number>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: repositoryRoot,
      env: sanitizedDeviceEnvironment(),
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', rejectPromise);
    child.once('exit', (code) => resolvePromise(code ?? 1));
  });
}

function sanitizedDeviceEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA',
    'USERPROFILE', 'USERNAME', 'USERDOMAIN', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
    'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'HOME', 'TMPDIR', 'LD_LIBRARY_PATH',
  ]);
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allowed.has(key.toUpperCase())) result[key] = value;
  }
  return result;
}

async function validatePermanentIdentity(
  paths: { identity: string; deviceCertificate: string; devicePrivateKey: string },
  expected: {
    endpoint: string;
    templateName: string;
    serialNumber: string;
    hardwareId: string;
    thingName: string;
    gatewayId: string;
    tenantId: string;
  },
): Promise<string> {
  const identity = parseObject(await readFile(paths.identity, 'utf8'), 'permanent identity');
  for (const [key, value] of Object.entries(expected)) assertEqual(identity[key], value, `permanent identity ${key}`);
  const certificateId = requireCertificateId(identity.certificateId, 'permanent certificate ID');
  requireCertificatePem(await readFile(paths.deviceCertificate, 'utf8'));
  requirePrivateKeyPem(await readFile(paths.devicePrivateKey, 'utf8'));
  return certificateId;
}

async function markLocalCleanup(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  serialNumber: string,
  claimCertificateId: string,
  permanentCertificateId: string,
): Promise<void> {
  try {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SERIAL#${serialNumber}`, SK: 'MANUFACTURING' },
      UpdateExpression: 'SET trustedClaimLocalFilesDeletedAt = :now, updatedAt = :now',
      ConditionExpression: 'claimCertificateId = :claim AND certificateId = :permanentCertificateId',
      ExpressionAttributeValues: {
        ':claim': claimCertificateId,
        ':permanentCertificateId': permanentCertificateId,
        ':now': new Date().toISOString(),
      },
    }));
  } catch {
    console.warn('Certificate handoff succeeded, but the non-authoritative local-cleanup audit marker could not be recorded.');
  }
}

async function assertFreshLocalState(
  stateDirectory: string,
  paths: {
    proof: string;
    signingPublicKey: string;
    claimCertificate: string;
    claimPrivateKey: string;
    identity: string;
    deviceCertificate: string;
    devicePrivateKey: string;
  },
): Promise<void> {
  await Promise.all([
    requireExistingFile(paths.proof, 'activation proof'),
    requireExistingFile(paths.signingPublicKey, 'profile signing public key'),
    requireAbsent(paths.claimCertificate, 'temporary claim certificate'),
    requireAbsent(paths.claimPrivateKey, 'temporary claim private key'),
    requireAbsent(paths.identity, 'permanent identity'),
    requireAbsent(paths.deviceCertificate, 'permanent device certificate'),
    requireAbsent(paths.devicePrivateKey, 'permanent device private key'),
  ]);
  const entries = await readdir(stateDirectory);
  if (entries.some((entry) => entry.startsWith('.provisioning-'))) {
    throw new Error('A provisioning recovery journal already exists; use the quarantine/recovery workflow');
  }
}

async function validateSigningPublicKey(path: string): Promise<void> {
  const value = await readFile(path);
  try {
    if (value.toString('utf8').includes('BEGIN PUBLIC KEY')) createPublicKey(value);
    else createPublicKey({ key: value, format: 'der', type: 'spki' });
  } catch {
    throw new Error('Profile signing public key is invalid');
  }
}

async function requireExistingFile(path: string, label: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') throw new Error(`${label} file is missing`, { cause: error });
    throw error;
  }
}

async function requireAbsent(path: string, label: string): Promise<void> {
  try {
    await lstat(path);
    throw new Error(`${label} already exists; this mode requires fresh device state`);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
}

async function writePrivate(path: string, value: string): Promise<void> {
  await writeFile(path, value, { flag: 'wx', mode: 0o600 });
  await chmod(path, 0o600).catch((error: unknown) => {
    if (process.platform !== 'win32') throw error;
  });
  if (process.platform === 'win32') await protectWindowsPath(path, false);
}

async function makePrivateDirectory(path: string): Promise<void> {
  await chmod(path, 0o700).catch((error: unknown) => {
    if (process.platform !== 'win32') throw error;
  });
  if (process.platform === 'win32') await protectWindowsTree(path);
}

async function protectWindowsTree(directory: string): Promise<void> {
  await protectWindowsPath(directory, true);
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error('Demo credential directory must not contain symbolic links');
    const child = resolve(directory, entry.name);
    if (entry.isDirectory()) await protectWindowsTree(child);
    else await protectWindowsPath(child, false);
  }
}

async function protectWindowsPath(path: string, directory: boolean): Promise<void> {
  const principal = await currentWindowsPrincipal();
  const grant = directory ? `${principal}:(OI)(CI)F` : `${principal}:F`;
  const result = await execFile('icacls.exe', [path, '/inheritance:r', '/grant:r', grant], { windowsHide: true });
  if (/failed processing\s+[1-9]/i.test(`${result.stdout}\n${result.stderr}`)) throw new Error('Failed to protect demo credential files');
  const verification = await execFile('icacls.exe', [path], { windowsHide: true });
  if (!verification.stdout.toLowerCase().includes(principal.toLowerCase())) throw new Error('Demo credential ACL verification failed');
}

let cachedWindowsPrincipal: string | undefined;
async function currentWindowsPrincipal(): Promise<string> {
  if (cachedWindowsPrincipal) return cachedWindowsPrincipal;
  const result = await execFile('whoami.exe', [], { windowsHide: true });
  const principal = result.stdout.trim();
  if (!principal || !principal.includes('\\')) throw new Error('Unable to resolve the current Windows principal');
  cachedWindowsPrincipal = principal;
  return principal;
}

async function validateStateDirectory(value: string, serialNumber: string): Promise<string> {
  const target = await realpath(resolve(value));
  if (basename(target).toLowerCase() !== serialNumber.toLowerCase()) {
    throw new Error(`State directory must end with the lowercase or canonical serial ${serialNumber}`);
  }
  const repositoryRealPath = await realpath(repositoryRoot);
  if (isContainedBy(repositoryRealPath, target)) throw new Error('Trusted-user demo state must be stored outside the repository');
  return target;
}

function isContainedBy(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate);
  return fromParent === '' || (fromParent !== '..' && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent));
}

function validateGateway(item: Record<string, unknown> | undefined, expected: Record<string, unknown>): void {
  if (!item || item.entityType !== 'GATEWAY' || item.state !== 'PENDING' || item.certificateState !== 'PENDING') {
    throw new Error('Gateway is not in the fresh pending identity state');
  }
  if (item.certificateId !== undefined || item.certificatePrincipal !== undefined) throw new Error('Gateway already has certificate material');
  for (const [key, value] of Object.entries(expected)) {
    const field = key === 'profileVersionId' ? 'desiredProfileVersionId' : key;
    assertEqual(item[field], value, `gateway ${field}`);
  }
  assertEqual(item.desiredGeneration, expected.generation, 'gateway desiredGeneration');
}

function validateOperation(item: Record<string, unknown> | undefined, expected: Record<string, unknown>): void {
  if (!item || item.entityType !== 'OPERATION' || item.type !== 'ONBOARD' || item.operationStatus !== 'IN_PROGRESS'
    || item.state !== 'CLAIM_ACCEPTED' || item.status !== 'WAITING_FOR_DEVICE') {
    throw new Error('Operation is not waiting for the device claim');
  }
  for (const [key, value] of Object.entries(expected)) {
    const field = key === 'generation' ? 'deploymentGeneration' : key;
    assertEqual(item[field], value, `operation ${field}`);
  }
}

function validateDeployment(item: Record<string, unknown> | undefined, expected: Record<string, unknown>): void {
  if (!item || item.entityType !== 'DEPLOYMENT' || item.status !== 'WAITING_FOR_DEVICE') {
    throw new Error('Deployment is not waiting for the device claim');
  }
  for (const [key, value] of Object.entries(expected)) assertEqual(item[key], value, `deployment ${key}`);
}

function validateVerification(item: Record<string, unknown> | undefined, expected: Record<string, unknown>): void {
  if (!item || item.entityType !== 'VERIFICATION' || item.state !== 'CONSUMED') {
    throw new Error('Verification record is not consumed by the activation operation');
  }
  for (const [key, value] of Object.entries(expected)) {
    const field = key === 'verificationExpiry' ? 'expiresAtEpoch' : key;
    assertEqual(item[field], value, `verification ${field}`);
  }
}

function parseObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must be an object`);
  return parsed as Record<string, unknown>;
}

function required(name: string): string {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${label}`);
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`Missing or invalid ${label}`);
  return result;
}

function requireRegion(value: string): string {
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(value)) throw new Error('metadata region is invalid');
  return value;
}

function requireEndpoint(value: string): string {
  const endpointName = value.trim().replace(/^https:\/\//i, '').replace(/\/$/, '');
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(endpointName)) throw new Error('metadata endpoint must be a DNS hostname');
  return endpointName;
}

function requireDeliveryMode(value: unknown): 'SHADOW' {
  if (value !== 'SHADOW') throw new Error('Demo delivery mode must be SHADOW');
  return value;
}

function requireCertificateId(value: unknown, label: string): string {
  const certificateId = requireString(value, label);
  if (!CERTIFICATE_ID_PATTERN.test(certificateId)) throw new Error(`${label} must be a 64-character hexadecimal ID`);
  return certificateId;
}

function requireCertificatePem(value: unknown): string {
  const pem = requireString(value, 'temporary claim certificate PEM');
  if (!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(pem)) throw new Error('Temporary claim certificate PEM is invalid');
  return pem;
}

function requirePrivateKeyPem(value: unknown): string {
  const pem = requireString(value, 'temporary claim private key');
  if (!/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+-----END (?:RSA )?PRIVATE KEY-----/.test(pem)) {
    throw new Error('Temporary claim private key PEM is invalid');
  }
  return pem;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label} does not match the trusted-user demo contract`);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}
