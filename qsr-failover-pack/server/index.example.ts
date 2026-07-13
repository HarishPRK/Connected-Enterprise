/**
 * Example host server for the Dynamic Failover (Dynamic Path Selection) pack.
 *
 * Mirrors the main app's server/index.ts bootstrap: dotenv FIRST (so the MQTT
 * and LLM modules see the right env when they load), then Express + the pack's
 * route registrars. Copy this into your app or use it as-is.
 */

import { config as loadDotenv } from 'dotenv';
// `override: true` — the project's .env is the source of truth. Without this,
// dotenv won't replace pre-set shell vars (incl. an *empty* AWS_ACCESS_KEY_ID
// left behind by `aws configure`, or a stale AWS_BEARER_TOKEN_BEDROCK from a
// previous shell session). Both have bitten us in dev.
loadDotenv({ override: true });
import express from 'express';
import cors from 'cors';
import { ipsecSource } from './ipsecSource.js';
import { registerIpsecRoutes } from './ipsec-routes.js';
import { registerIpsecInsightRoute } from './ipsec-insight-route.js';
import { registerDevicesRoutes } from './devices-routes.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, connected: ipsecSource.isConnected() });
});

registerIpsecRoutes(app);

// optional — remove if no LLM key
registerIpsecInsightRoute(app);

// required by the page's IT/OT device tagging (useDevices hook)
registerDevicesRoutes(app);

// Connect to AWS IoT Core MQTT (gateway metrics + path control + devices).
void ipsecSource.start();

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[qsr-failover-pack] API listening on http://localhost:${port}`);
});
