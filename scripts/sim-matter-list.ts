/**
 * Matter device-list simulator.
 *
 * Stands in for the `com.rdk.matter.devicelist` Greengrass component by
 * publishing a real Matter hub GET_DEVICES_LIST reply (captured from the Plano
 * Filogic gateway) to `rdk/matter/devices/list` over AWS IoT Core — the exact
 * topic + JSON shape the gateway publishes verbatim. This exercises the whole
 * live path (IoT → ipsecSource → deviceSource → /api/devices/stream → UI) so
 * the OT Devices page shows the Tapo plug before the gateway component is up.
 *
 *   npm run sim:matter           # publish once and exit
 *   npm run sim:matter -- --loop # republish every 30s like the real component
 *
 * Env: reuses IOT_ENDPOINT / IOT_REGION / AWS creds from .env, same as the
 * server. Override the topic with SIM_MATTER_TOPIC (default rdk/matter/devices/list).
 */

import { config as loadDotenv } from 'dotenv';
loadDotenv({ override: true });
import { mqtt, iot, auth } from 'aws-iot-device-sdk-v2';

const ENDPOINT = process.env.IOT_ENDPOINT ?? 'alht1i2bx8tzt-ats.iot.us-east-1.amazonaws.com';
const REGION = process.env.IOT_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
const TOPIC = process.env.SIM_MATTER_TOPIC ?? 'rdk/matter/devices/list';
const LOOP = process.argv.includes('--loop');

/** Verbatim shape of the hub's reply — `mc_response.Devices[]` is what
 *  deviceSource's `fromMatterList` maps into the inventory contract. */
function buildHubReply() {
  return {
    result: 'true',
    mc_response: {
      Devices: [
        {
          deviceName: 'Tapo_RDK_1',
          endPointCount: 1,
          endPoints: [
            {
              clusters: [{ onOff: { onOff: 'ON' } }],
              deviceType: '0',
              endPointId: 1,
            },
          ],
          manualCode: 'NULL',
          nodeId: 32768,
          onboardingTime: Math.floor(Date.now() / 1000) - 3600,
          radioType: 1,
        },
      ],
    },
  };
}

async function main() {
  const credentialsProvider = auth.AwsCredentialsProvider.newDefault();
  const builder = iot.AwsIotMqttConnectionConfigBuilder.new_with_websockets({
    region: REGION,
    credentials_provider: credentialsProvider,
  });
  builder.with_endpoint(ENDPOINT);
  builder.with_client_id(`ce-sim-matter-${Math.random().toString(36).slice(2, 10)}`);
  builder.with_clean_session(true);
  builder.with_keep_alive_seconds(30);

  const connection = new mqtt.MqttClient().new_connection(builder.build());
  await connection.connect();
  console.log(`[sim] connected to ${ENDPOINT}; publishing to "${TOPIC}"${LOOP ? ' every 30s (--loop)' : ' once'}`);

  const publishOnce = async () => {
    const reply = buildHubReply();
    await connection.publish(TOPIC, JSON.stringify(reply), mqtt.QoS.AtLeastOnce);
    console.log(`[sim] published ${reply.mc_response.Devices.length} matter device(s)`);
  };

  await publishOnce();

  if (!LOOP) {
    await connection.disconnect();
    return;
  }

  const timer = setInterval(() => {
    publishOnce().catch((e) => console.error('[sim] publish failed:', e));
  }, 30_000);

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
