import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GATEWAY_TWIN_DEVICE_INFO_TOPICS,
  GATEWAY_TWIN_ETHERNET_TOPICS,
  GATEWAY_TWIN_EVENTS_TOPIC,
  GATEWAY_TWIN_SOFTWARE_MODULE_TOPICS,
  GATEWAY_TWIN_STATUS_TOPIC,
  GatewayTwinSource,
  type GatewayTwinTelemetry,
} from './gatewayTwinSource.js';

const encodeJson = (value: unknown): ArrayBuffer => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return bytes.buffer as ArrayBuffer;
};

function withPrplosPrefix<T>(prefix: string | undefined, run: () => T): T {
  const previousPrefix = process.env.IOT_GATEWAY_TWIN_PRPLOS_PREFIX;
  if (prefix === undefined) {
    delete process.env.IOT_GATEWAY_TWIN_PRPLOS_PREFIX;
  } else {
    process.env.IOT_GATEWAY_TWIN_PRPLOS_PREFIX = prefix;
  }

  try {
    return run();
  } finally {
    if (previousPrefix === undefined) {
      delete process.env.IOT_GATEWAY_TWIN_PRPLOS_PREFIX;
    } else {
      process.env.IOT_GATEWAY_TWIN_PRPLOS_PREFIX = previousPrefix;
    }
  }
}

test('Gateway Twin subscribes to the Wi-Fi namespace while retaining exact radio mappings', () => {
  withPrplosPrefix(undefined, () => {
    const source = new GatewayTwinSource();

    assert.deepEqual(source.getSubscriptionTopics(), [
      GATEWAY_TWIN_EVENTS_TOPIC,
      GATEWAY_TWIN_STATUS_TOPIC,
      ...GATEWAY_TWIN_DEVICE_INFO_TOPICS,
      ...GATEWAY_TWIN_SOFTWARE_MODULE_TOPICS,
      ...GATEWAY_TWIN_ETHERNET_TOPICS,
      'prplos/wifi/#',
    ]);
  });
});

test('execution-unit telemetry is subscribed and forwarded without reshaping the report', () => {
  withPrplosPrefix(undefined, () => {
    const source = new GatewayTwinSource();
    const telemetry: GatewayTwinTelemetry[] = [];
    const unsubscribe = source.onTelemetry((sample) => telemetry.push(sample));
    const payload = {
      Report: [{
        EU5_Name: 'image-netmon',
        EU3_Uptime: '437283',
        EU4_Status: 'Active',
        EU6_EUID: 'f648163b-0d54-5116-8011-94648c9392a0',
        EU1_DiskSpaceInUse: '1218',
        EU4_DiskSpaceInUse: '1218',
        EU7_DiskSpaceInUse: '1218',
        EU1_Uptime: '437283',
        EU4_Name: 'image-opc',
        EU2_Status: 'Active',
        EU2_MemoryInUse: '45924',
        EU5_EUID: 'e57b16e3-84c7-56a6-bebf-a5826a612ea1',
        EU4_MemoryInUse: '1368',
        EU8_Uptime: '0',
        EU3_Name: 'nodered',
        EU3_DiskSpaceInUse: '1218',
        EU6_DiskSpaceInUse: '1218',
        EU4_EUID: 'e3245e65-a141-51d0-82b3-8ed545d4c365',
        EU6_Uptime: '1241',
        EU7_Status: 'Idle',
        EU2_Name: 'matter-prpl-prod',
        EU6_MemoryInUse: '26412',
        EU2_Uptime: '437282',
        EU8_MemoryInUse: '0',
        EU8_Name: 'greengrass',
        EU4_Uptime: '437283',
        EU3_EUID: 'cd1d3946-d703-52d2-b260-752c5edd80e7',
        EU5_Status: 'Active',
        EU1_MemoryInUse: '419424',
        EU3_MemoryInUse: '116648',
        EU1_Name: 'greengrass',
        EU2_DiskSpaceInUse: '1218',
        EU7_Name: 'matter-prpl-prod',
        EU5_DiskSpaceInUse: '1218',
        EU8_DiskSpaceInUse: '1218',
        EU3_Status: 'Active',
        CollectionTime: '1787241369640',
        EU2_EUID: '41dde619-19be-51e0-be1c-96bed68490de',
        EU8_EUID: '4d26bd10-ead0-5c44-af89-3272eb651d18',
        EU7_Uptime: '0',
        EU8_Status: 'Idle',
        EU6_Name: 'image-thread',
        EU1_Status: 'Active',
        EU5_MemoryInUse: '41892',
        EU1_EUID: '1863a901-60f4-5ed5-96f1-5963699a2799',
        EU7_MemoryInUse: '0',
        EU5_Uptime: '437283',
        EU6_Status: 'Active',
        EU7_EUID: 'cb795388-06f5-5eca-b035-f76e634602d1',
      }],
    };

    try {
      assert.ok(source.getSubscriptionTopics().includes(
        'prplos/softwaremodules/executionunits',
      ));
      assert.equal(source.ingest(
        'prplos/softwaremodules/executionunits',
        encodeJson(payload),
      ), true);

      assert.equal(telemetry.length, 1);
      assert.equal(telemetry[0]?.topic, 'prplos/softwaremodules/executionunits');
      assert.deepEqual(telemetry[0]?.payload, payload);
      assert.deepEqual(source.getLatestTelemetry(), telemetry);
    } finally {
      unsubscribe();
    }
  });
});

test('a custom prplOS prefix canonicalizes execution-unit deliveries', () => {
  withPrplosPrefix('fleet/mckinney/prplos///', () => {
    const source = new GatewayTwinSource();

    assert.ok(source.getSubscriptionTopics().includes(
      'fleet/mckinney/prplos/softwaremodules/executionunits',
    ));
    assert.ok(!source.getSubscriptionTopics().includes(
      'prplos/softwaremodules/executionunits',
    ));
    assert.equal(source.ingest(
      'fleet/mckinney/prplos/softwaremodules/executionunits',
      encodeJson({ Report: [{ EU1_Name: 'greengrass', EU1_Status: 'Active' }] }),
    ), true);
    assert.equal(
      source.getLatestTelemetry()[0]?.topic,
      'prplos/softwaremodules/executionunits',
    );
  });
});

test('Wi-Fi wildcard deliveries forward only the three radio topics understood by the twin', () => {
  withPrplosPrefix(undefined, () => {
    const source = new GatewayTwinSource();
    const telemetry: GatewayTwinTelemetry[] = [];
    const unsubscribe = source.onTelemetry((sample) => telemetry.push(sample));
    const payload = { Report: [{ Channel: 149, PacketsReceived: '744' }] };

    try {
      assert.equal(source.ingest('prplos/wifi/wlan2', encodeJson(payload)), true);
      assert.equal(source.ingest('prplos/wifi/wlan1', encodeJson(payload)), false);
      assert.equal(source.ingest('prplos/wifi/#', encodeJson(payload)), false);

      assert.equal(telemetry.length, 1);
      assert.equal(telemetry[0]?.topic, 'prplos/wifi/wlan2');
      assert.deepEqual(telemetry[0]?.payload, payload);
      assert.deepEqual(source.getLatestTelemetry(), telemetry);
    } finally {
      unsubscribe();
    }
  });
});

test('a custom prplOS prefix applies to the Wi-Fi filter and canonicalizes child deliveries', () => {
  withPrplosPrefix('fleet/mckinney/prplos///', () => {
    const source = new GatewayTwinSource();
    const topics = source.getSubscriptionTopics();

    assert.ok(topics.includes('fleet/mckinney/prplos/wifi/#'));
    assert.ok(!topics.includes('prplos/wifi/#'));
    assert.ok(!topics.includes('fleet/mckinney/prplos/wifi/wlan2'));

    assert.equal(source.ingest(
      'fleet/mckinney/prplos/wifi/wlan4',
      encodeJson({ Report: [{ Channel: 37 }] }),
    ), true);
    assert.equal(source.getLatestTelemetry()[0]?.topic, 'prplos/wifi/wlan4');
  });
});
