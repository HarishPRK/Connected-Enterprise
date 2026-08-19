const AMAZON_ROOT_CA_1_PEM = `-----BEGIN CERTIFICATE-----
MIIDQTCCAimgAwIBAgITBmyfz5m/jAo54vB4ikPmljZbyjANBgkqhkiG9w0BAQsF
ADA5MQswCQYDVQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6
b24gUm9vdCBDQSAxMB4XDTE1MDUyNjAwMDAwMFoXDTM4MDExNzAwMDAwMFowOTEL
MAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpvbjEZMBcGA1UEAxMQQW1hem9uIFJv
b3QgQ0EgMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALJ4gHHKeNXj
ca9HgFB0fW7Y14h29Jlo91ghYPl0hAEvrAIthtOgQ3pOsqTQNroBvo3bSMgHFzZM
9O6II8c+6zf1tRn4SWiw3te5djgdYZ6k/oI2peVKVuRF4fn9tBb6dNqcmzU5L/qw
IFAGbHrQgLKm+a/sRxmPUDgH3KKHOVj4utWp+UhnMJbulHheb4mjUcAwhmahRWa6
VOujw5H5SNz/0egwLX0tdHA114gk957EWW67c4cX8jJGKLhD+rcdqsq08p8kDi1L
93FcXmn/6pUCyziKrlA4b9v7LWIbxcceVOF34GfID5yHI9Y/QCB/IIDEgEw+OyQm
jgSubJrIqg0CAwEAAaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMC
AYYwHQYDVR0OBBYEFIQYzIU07LwMlJQuCFmcx7IQTgoIMA0GCSqGSIb3DQEBCwUA
A4IBAQCY8jdaQZChGsV2USggNiMOruYou6r4lK5IpDB/G/wkjUu0yKGX9rbxenDI
U5PMCCjjmCXPI6T53iHTfIUJrU6adTrCC2qJeHZERxhlbI1Bjjt/msv0tadQ1wUs
N+gDS63pYaACbvXy8MWy7Vu33PqUXHeeE6V/Uq2V8viTO96LXFvKWlJbYK8U90vv
o/ufQJVtMVT8QtPHRh8jrdkPSHCa2XV4cdFyQzR1bldZwgJcJmApzyMZFo6IQ6XU
5MsI+yMRQ+hDKXJioaldXgjUkK642M4UwtBV8ob2xJNDd2ZhwLnoQdeXeGADbkpy
rqXRfboQnoZsG4q5WTP468SQvvG5
-----END CERTIFICATE-----
`;

export interface BootstrapPackageMetadata {
  formatVersion: 1;
  issuedAt: string;
  serialNumber: string;
  certificateId: string;
  certificateArn: string;
  tenantId: string;
  modelId: string;
  siteId: string;
  profileVersionId: string;
  region: string;
  bootstrapPolicyName: string;
  iotDataEndpoint: string;
  iotCredentialProviderEndpoint: string;
  fleetProvisioningTemplateName: string;
  gatewayConfigRoleAliasName: string;
  claimClientIdPrefix: 'claim-';
  configurationUrlTemplate: string;
  statusUrlTemplate: string;
}

interface BootstrapPackageInput {
  certificatePem: string;
  privateKey: string;
  metadata: BootstrapPackageMetadata;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

export function createBootstrapPackageArchive(input: BootstrapPackageInput): Buffer {
  const readme = [
    'CONNECTED ENTERPRISE — ONE-TIME GATEWAY BOOTSTRAP PACKAGE',
    '',
    `Serial: ${input.metadata.serialNumber}`,
    `AWS IoT certificate ID: ${input.metadata.certificateId}`,
    '',
    'This archive contains the only exported copy of the bootstrap private key.',
    'Move it directly into protected storage on the gateway identified above.',
    'Do not reuse this credential on another gateway or commit these files to source control.',
    'After permanent identity is finalized, the bootstrap certificate is deactivated automatically.',
    '',
    'Files:',
    '- bootstrap-certificate.pem — AWS IoT bootstrap client certificate',
    '- bootstrap-private-key.pem — sensitive private key; restrict to the gateway service account',
    '- AmazonRootCA1.pem — Amazon Trust Services root CA',
    '- bootstrap-metadata.json — endpoints and immutable serial binding metadata',
    '',
  ].join('\n');

  return createStoredZip([
    textEntry('bootstrap-certificate.pem', ensureTrailingNewline(input.certificatePem)),
    textEntry('bootstrap-private-key.pem', ensureTrailingNewline(input.privateKey)),
    textEntry('AmazonRootCA1.pem', AMAZON_ROOT_CA_1_PEM),
    textEntry('bootstrap-metadata.json', `${JSON.stringify(input.metadata, null, 2)}\n`),
    textEntry('README.txt', readme),
  ], new Date(input.metadata.issuedAt));
}

function textEntry(name: string, value: string): ZipEntry {
  return { name, data: Buffer.from(value, 'utf8') };
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function createStoredZip(entries: ZipEntry[], modifiedAt: Date): Buffer {
  if (entries.length === 0 || entries.length > 0xffff) throw new Error('ZIP entry count is invalid');
  const { dosDate, dosTime } = dosTimestamp(modifiedAt);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(entry.name)) throw new Error('ZIP entry name is invalid');
    const name = Buffer.from(entry.name, 'utf8');
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);

    localOffset += local.length + name.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function dosTimestamp(value: Date): { dosDate: number; dosTime: number } {
  const year = Math.min(2107, Math.max(1980, value.getUTCFullYear()));
  return {
    dosDate: ((year - 1980) << 9) | ((value.getUTCMonth() + 1) << 5) | value.getUTCDate(),
    dosTime: (value.getUTCHours() << 11) | (value.getUTCMinutes() << 5) | Math.floor(value.getUTCSeconds() / 2),
  };
}

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
