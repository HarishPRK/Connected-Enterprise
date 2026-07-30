/**
 * Example host server for the IT/OT devices pack.
 *
 * Mirrors the main app's server/index.ts bootstrap: dotenv FIRST (so the MQTT
 * and LLM modules see the right env when they load), then Express + the pack's
 * route registrars. Copy this into your app or use it as-is.
 */

import { config as loadDotenv } from 'dotenv';
// A service-manager production declaration must win over .env. Development
// keeps the existing override behavior so local profiles remain convenient.
const developmentInvocation = process.env.npm_lifecycle_event === 'dev'
  || process.env.QSR_DEV_MODE === '1';
loadDotenv({ override: developmentInvocation });
import express from 'express';
import cors from 'cors';
import { ipsecSource } from './ipsecSource.js';
import { registerDevicesRoutes } from './devices-routes.js';
import { registerInsightRoute } from './insight-route.js';
// Dynamic Failover pack (qsr-failover-pack) — same shared engine, new routes.
import { registerIpsecRoutes } from './ipsec-routes.js';
import { registerIpsecInsightRoute } from './ipsec-insight-route.js';
import { registerAppRouteRoutes } from './app-route-routes.js';

const app = express();
app.disable('x-powered-by');

const isDevelopment = process.env.npm_lifecycle_event === 'dev'
  || process.env.QSR_DEV_MODE === '1';
const isProduction = !isDevelopment;
const configuredOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const developmentOrigins = isProduction
  ? []
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];
const allowedOrigins = new Set([...configuredOrigins, ...developmentOrigins]);

app.use(cors({
  origin(origin, callback) {
    // Requests without Origin are server-to-server. Same-origin browser calls
    // do not need CORS response headers; only configured/dev origins receive
    // cross-origin access.
    callback(null, origin ? allowedOrigins.has(origin) : true);
  },
}));
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, connected: ipsecSource.isConnected() });
});

registerDevicesRoutes(app);
registerIpsecRoutes(app);          // /api/ipsec/snapshot, /api/ipsec/stream, /api/gateway/path
registerAppRouteRoutes(app);       // /api/approute/publish, /api/approute/suggest

// optional — remove if no LLM key
registerInsightRoute(app);
registerIpsecInsightRoute(app);    // /api/ipsec/insight

// Connect to AWS IoT Core MQTT (device inventory + gateway metrics + control).
void ipsecSource.start();

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? (isProduction ? '127.0.0.1' : '0.0.0.0');
app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`[qsr-devices-pack] API listening on http://${host}:${port}`);
});
