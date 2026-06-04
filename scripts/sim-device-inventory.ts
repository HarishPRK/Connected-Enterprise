/**
 * Device-inventory simulator.
 *
 * Stands in for the future `com.rdk.devicediscovery` Greengrass component by
 * publishing a sample LAN inventory to `rdk/devices/inventory` over AWS IoT
 * Core — the exact topic + JSON shape the real gateway will use. This exercises
 * the whole live path (IoT → ipsecSource → deviceSource → /api/devices/stream →
 * UI) so you can see real-looking devices, IT/OT auto-classification, and the
 * seed→gateway switch before any gateway work is done.
 *
 *   npm run sim:devices          # publish once and exit
 *   npm run sim:devices -- --loop  # republish every 8s, flipping one device
 *                                  # online/offline so you can watch live SSE
 *
 * Env: reuses IOT_ENDPOINT / IOT_REGION / AWS creds from .env, same as the
 * server. Override the topic with SIM_DEVICE_TOPIC (default rdk/devices/inventory).
 */

import { config as loadDotenv } from 'dotenv';
loadDotenv({ override: true });
import { mqtt, iot, auth } from 'aws-iot-device-sdk-v2';

const ENDPOINT = process.env.IOT_ENDPOINT ?? 'alht1i2bx8tzt-ats.iot.us-east-1.amazonaws.com';
const REGION = process.env.IOT_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
const TOPIC = process.env.SIM_DEVICE_TOPIC ?? 'rdk/devices/inventory';
const LOOP = process.argv.includes('--loop');

/** Sample devices the Banana Pi would discover on its LAN. Mirrors the wire
 *  contract in deviceSource.ts — only `mac` is strictly required; the cloud
 *  auto-classifies kind + IT/OT from hostname / vendor / mDNS services. */
function buildInventory(tick: number) {
  // Flip the Shelly offline every other loop tick to show online/offline + SSE.
  const shellyOnline = tick % 2 === 0;
  return {
    gateway: 'rdk-bpi4-gateway',
    ts: Date.now(),
    devices: [
      // ── IT (auto) ──
      { mac: '3C:22:FB:11:22:01', ip: '192.168.10.21', hostname: 'Harish-MacBook-Pro', vendor: 'Apple, Inc.', conn: 'wifi', online: true, connectedForHours: 27 },
      { mac: '3C:22:FB:11:22:02', ip: '192.168.10.22', hostname: 'Harishs-iPhone', vendor: 'Apple, Inc.', conn: 'wifi', online: true, connectedForHours: 9, services: ['_apple-mobdev2._tcp'] },
      { mac: 'A4:50:46:11:22:03', ip: '192.168.10.23', hostname: 'Galaxy-Tab-S9', vendor: 'Samsung Electronics', conn: 'wifi', online: true, connectedForHours: 3 },
      // ── OT (auto, via mDNS service / vendor) ──
      { mac: 'F0:08:D1:11:22:04', ip: '192.168.10.51', hostname: 'matter-a1b2c3', vendor: 'Nordic Semiconductor', conn: 'wifi', online: true, connectedForHours: 120, services: ['_matter._tcp', '_matterc._udp'] },
      { mac: '8C:AA:B5:11:22:05', ip: '192.168.10.52', hostname: 'shellyplus1-7c87ce', vendor: 'Espressif Inc.', conn: 'wifi', online: shellyOnline, connectedForHours: shellyOnline ? 64 : 0, services: ['_http._tcp', '_shelly._tcp'] },
      // ── Unknown vendor → 'generic', auto IT ──
      { mac: 'DE:AD:BE:11:22:06', ip: '192.168.10.80', hostname: 'esp32-kitchen', conn: 'wifi', online: true, connectedForHours: 5 },
    ],
  };
}

async function main() {
  const credentialsProvider = auth.AwsCredentialsProvider.newDefault();
  const builder = iot.AwsIotMqttConnectionConfigBuilder.new_with_websockets({
    region: REGION,
    credentials_provider: credentialsProvider,
  });
  builder.with_endpoint(ENDPOINT);
  builder.with_client_id(`ce-sim-devices-${Math.random().toString(36).slice(2, 10)}`);
  builder.with_clean_session(true);
  builder.with_keep_alive_seconds(30);

  const connection = new mqtt.MqttClient().new_connection(builder.build());
  await connection.connect();
  console.log(`[sim] connected to ${ENDPOINT}; publishing to "${TOPIC}"${LOOP ? ' every 8s (--loop)' : ' once'}`);

  let tick = 0;
  const publishOnce = async () => {
    const inv = buildInventory(tick++);
    await connection.publish(TOPIC, JSON.stringify(inv), mqtt.QoS.AtLeastOnce);
    const online = inv.devices.filter((d) => d.online !== false).length;
    console.log(`[sim] published ${inv.devices.length} devices (${online} online) — tick ${tick}`);
  };

  await publishOnce();

  if (!LOOP) {
    await connection.disconnect();
    return;
  }

  const timer = setInterval(() => {
    publishOnce().catch((e) => console.error('[sim] publish failed:', e));
  }, 8000);

  // Clean shutdown on Ctrl+C.
  process.on('SIGINT', async () => {
    clearInterval(timer);
    console.log('\n[sim] disconnecting…');
    await connection.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[sim] fatal:', err);
  process.exit(1);
});
