import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GATEWAY_TWIN_DEVICE_INFO_TOPICS,
  GATEWAY_TWIN_ETHERNET_TOPICS,
  GATEWAY_TWIN_EVENTS_TOPIC,
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
      ...GATEWAY_TWIN_ETHERNET_TOPICS,
      'prplos/wifi/#',
    ]);
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
