import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  uiProfileSchemaVersion,
  validateUiProfileParameters,
} from '../lambda/shared/ui-profile.js';

const COMPLETE_DEFAULT_V2: Record<string, string | number | boolean> = {
  serviceOffering: 'ANIRA',
  internetAccess: true,
  usbPortsEnabled: false,
  lanIpAddress: '10.10.10.1',
  lanPrefixLength: 24,
  lanMtu: 1500,
  lanEthernetSpeed: 'AUTO',
  defaultVlanPortsEnabled: true,
  vrrpEnabled: false,
  dhcpServerEnabled: true,
  dhcpPoolStart: '10.10.10.100',
  dhcpPoolEnd: '10.10.10.199',
  dhcpLeaseSeconds: 86_400,
  wanMode: 'DHCP',
  wanStaticIpAddress: '',
  wanStaticPrefixLength: 24,
  wanStaticGateway: '',
  wanMtu: 1500,
  wanEthernetSpeed: 'AUTO',
  wanVlanId: 0,
  ipv4ForwardingEnabled: true,
  natMode: 'MASQUERADE',
  defaultRouteMetric: 100,
  reversePathFilter: 'STRICT',
  tcpTimestampsEnabled: true,
  dnsMode: 'WAN_DHCP',
  dnsPrimaryServer: '',
  dnsSecondaryServer: '',
  dnsSearchDomain: '',
  dnsCacheEnabled: true,
  dnsTcpEnabled: true,
  dnsCacheEntries: 1000,
  ntpPrimaryServer: 'time.cloudflare.com',
  ntpSecondaryServer: 'time.google.com',
  firewallMemoryMb: 8192,
  cryptoBufferCount: 512,
  directedBroadcastEnabled: false,
  vpnCredentialRef: '',
  wireGuardKeyRef: '',
  natTraversalEnabled: true,
  natKeepaliveSeconds: 20,
  tunnelReconnectSeconds: 30,
  maxInboundTunnels: 10,
  cellularBackupEnabled: true,
  cellularRefreshMinutes: 15,
  failbackHoldSeconds: 120,
  timezone: 'America/Chicago',
  daylightSavingEnabled: true,
  language: 'en-US',
  configurationWatchdogSeconds: 180,
  healthCheckIntervalSeconds: 30,
  rollbackOnManagementLoss: true,
  autoRebootAfterApply: false,
};

function v2(overrides: Record<string, string | number | boolean> = {}) {
  return { ...COMPLETE_DEFAULT_V2, ...overrides };
}

test('UI profile schema version is explicit while omitted legacy requests remain v1', () => {
  assert.equal(uiProfileSchemaVersion(undefined), 1);
  assert.equal(uiProfileSchemaVersion(1), 1);
  assert.equal(uiProfileSchemaVersion(2), 2);
  for (const invalid of [null, '2', 0, 3, 2.1, true]) {
    assert.throws(() => uiProfileSchemaVersion(invalid), /integer 1 or 2/);
  }
});

test('UI profile schema v1 remains backward compatible and rejects v2-only keys', () => {
  const legacy = {
    serviceOffering: 'ANIRA', lanIpAddress: '10.20.30.1', lanPrefixLength: 24,
    wanMtu: 1500, timezone: 'America/Chicago', rollbackOnManagementLoss: true,
  };
  assert.deepEqual(validateUiProfileParameters(legacy), legacy);
  assert.deepEqual(validateUiProfileParameters(legacy, 1), legacy);
  assert.throws(() => validateUiProfileParameters({ ...legacy, wanMode: 'DHCP' }, 1), /not part of profile schema v1/);
});

test('UI profile schema v2 accepts the exact complete canonical editor defaults', () => {
  assert.deepEqual(validateUiProfileParameters(COMPLETE_DEFAULT_V2, 2), COMPLETE_DEFAULT_V2);
  assert.deepEqual(validateUiProfileParameters(v2({ defaultRouteMetric: 0 }), 2).defaultRouteMetric, 0);
});

test('UI profile schema v2 accepts complete static WAN and DNS configuration', () => {
  const parameters = v2({
    wanMode: 'STATIC',
    wanStaticIpAddress: '198.51.100.10',
    wanStaticPrefixLength: 24,
    wanStaticGateway: '198.51.100.1',
    dnsMode: 'STATIC',
    dnsPrimaryServer: '1.1.1.1',
    dnsSecondaryServer: '9.9.9.9',
    dnsSearchDomain: 'branch.example.com',
  });
  assert.deepEqual(validateUiProfileParameters(parameters, 2), parameters);
});

test('UI profile schema v2 treats valid dormant editor values as inactive', () => {
  const prunedEditorDefaults = v2();
  delete prunedEditorDefaults.wanStaticIpAddress;
  delete prunedEditorDefaults.wanStaticPrefixLength;
  delete prunedEditorDefaults.wanStaticGateway;
  delete prunedEditorDefaults.dnsPrimaryServer;
  delete prunedEditorDefaults.dnsSecondaryServer;
  delete prunedEditorDefaults.dnsSearchDomain;
  assert.doesNotThrow(() => validateUiProfileParameters(prunedEditorDefaults, 2));
  assert.doesNotThrow(() => validateUiProfileParameters(v2({ dhcpServerEnabled: false }), 2));
  assert.doesNotThrow(() => validateUiProfileParameters(v2({
    dhcpServerEnabled: false,
    dhcpPoolStart: '',
    dhcpPoolEnd: '',
  }), 2));
  assert.doesNotThrow(() => validateUiProfileParameters(v2({
    ntpPrimaryServer: '192.0.2.123',
    ntpSecondaryServer: '198.51.100.123',
  }), 2));
  assert.throws(() => validateUiProfileParameters(v2({ wanStaticIpAddress: '198.51.100.10' }), 2), /must be empty or omitted/);
  assert.throws(() => validateUiProfileParameters(v2({ dnsPrimaryServer: '1.1.1.1' }), 2), /must be empty or omitted/);
});

test('UI profile schema v2 enforces required fields and safe scalar ranges', () => {
  const missingMtu = v2();
  delete missingMtu.lanMtu;
  assert.throws(() => validateUiProfileParameters(missingMtu, 2), /lanMtu is required/);
  const missingWanMtu = v2();
  delete missingWanMtu.wanMtu;
  assert.throws(() => validateUiProfileParameters(missingWanMtu, 2), /wanMtu is required/);
  assert.throws(() => validateUiProfileParameters(v2({ lanMtu: 575 }), 2), /between 576 and 9216/);
  assert.throws(() => validateUiProfileParameters(v2({ wanVlanId: 4095 }), 2), /between 0 and 4094/);
  assert.throws(() => validateUiProfileParameters(v2({ defaultRouteMetric: -1 }), 2), /between 0 and 65535/);
  assert.throws(() => validateUiProfileParameters(v2({ unsupportedSetting: true }), 2), /not part of profile schema v2/);
  assert.throws(() => validateUiProfileParameters(v2({ toString: true }), 2), /not part of profile schema v2/);
  assert.throws(
    () => validateUiProfileParameters(JSON.parse('{"__proto__":true}') as Record<string, unknown>, 2),
    /not part of profile schema v2/,
  );
  assert.throws(
    () => validateUiProfileParameters({ vpnCredentialRef: `secretsmanager://${'x'.repeat(66_000)}` }, 2),
    /must not exceed 64 KiB/,
  );
});

test('UI profile schema v2 constrains LAN and active DHCP pools', () => {
  assert.throws(() => validateUiProfileParameters(v2({ lanIpAddress: '127.0.0.1' }), 2), /safe unicast/);
  assert.throws(() => validateUiProfileParameters(v2({ lanIpAddress: '10.10.10.0' }), 2), /usable host/);
  assert.throws(() => validateUiProfileParameters(v2({ dhcpPoolStart: '10.10.10.200', dhcpPoolEnd: '10.10.10.100' }), 2), /must not be greater/);
  assert.throws(() => validateUiProfileParameters(v2({ dhcpPoolEnd: '10.10.11.10' }), 2), /inside the usable LAN subnet/);
  assert.throws(() => validateUiProfileParameters(v2({ dhcpPoolStart: '10.10.10.1' }), 2), /must not include the LAN gateway/);

  const missingPool = v2();
  delete missingPool.dhcpPoolEnd;
  assert.throws(() => validateUiProfileParameters(missingPool, 2), /dhcpPoolEnd is required when DHCP is enabled/);
});

test('UI profile schema v2 constrains static WAN addressing and subnet overlap', () => {
  assert.throws(() => validateUiProfileParameters(v2({ wanMode: 'STATIC' }), 2), /wanStaticIpAddress must be a valid IPv4/);
  assert.throws(() => validateUiProfileParameters(v2({
    wanMode: 'STATIC', wanStaticIpAddress: '198.51.100.10', wanStaticGateway: '203.0.113.1', dnsMode: 'STATIC', dnsPrimaryServer: '1.1.1.1',
  }), 2), /inside the usable static WAN subnet/);
  assert.throws(() => validateUiProfileParameters(v2({
    wanMode: 'STATIC', wanStaticIpAddress: '10.10.10.10', wanStaticGateway: '10.10.10.254', dnsMode: 'STATIC', dnsPrimaryServer: '1.1.1.1',
  }), 2), /must not overlap/);
  assert.throws(() => validateUiProfileParameters(v2({
    wanMode: 'STATIC', wanStaticIpAddress: '198.51.100.10', wanStaticGateway: '198.51.100.1',
  }), 2), /WAN_DHCP requires parameters.wanMode DHCP/);
});

test('UI profile schema v2 constrains DNS, time, and forwarding relationships', () => {
  assert.throws(() => validateUiProfileParameters(v2({
    dnsMode: 'STATIC', dnsPrimaryServer: '', dnsSecondaryServer: '',
  }), 2), /dnsPrimaryServer must be a valid IPv4/);
  assert.throws(() => validateUiProfileParameters(v2({
    dnsMode: 'STATIC', dnsPrimaryServer: '127.0.0.1', dnsSecondaryServer: '',
  }), 2), /safe unicast/);
  assert.throws(() => validateUiProfileParameters(v2({
    dnsMode: 'STATIC', dnsPrimaryServer: '1.1.1.1', dnsSecondaryServer: '1.1.1.1',
  }), 2), /must be different/);
  assert.throws(() => validateUiProfileParameters(v2({ dnsSearchDomain: '-bad.example' }), 2), /valid ASCII hostname/);
  assert.throws(() => validateUiProfileParameters(v2({ timezone: 'Mars/Olympus_Mons' }), 2), /valid IANA time zone/);
  assert.throws(() => validateUiProfileParameters(v2({ ntpSecondaryServer: 'TIME.CLOUDFLARE.COM' }), 2), /must be different/);
  assert.throws(() => validateUiProfileParameters(v2({ ntpPrimaryServer: '169.254.1.1' }), 2), /safe unicast/);
  assert.throws(() => validateUiProfileParameters(v2({ ipv4ForwardingEnabled: false }), 2), /must be true.*MASQUERADE/);
});

test('UI profile creation wires numeric schema version into validation, hashing, documents, and manifests', () => {
  const source = fs.readFileSync(new URL('../lambda/api-handler.ts', import.meta.url), 'utf8');
  assert.match(source, /const schemaVersion = uiProfileSchemaVersion\(body\.schemaVersion\)/);
  assert.match(source, /validateUiProfileParameters\(body\.parameters, schemaVersion\)/);
  assert.match(source, /baseProfileVersionId, schemaVersion, parameters/);
  assert.match(source, /const document = \{ schemaVersion, modelId, parameters \}/);
  assert.match(source, /kind: 'gateway-profile', schemaVersion, tenantId/);
  assert.match(source, /version, schemaVersion, parameters/);
});
