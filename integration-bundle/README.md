# Dynamic Path Selection + Video Analytics — Integration Pack

Self-contained instructions for porting the **Dynamic Path Selection** (DPS)
and **Video Analytics** features into another React + Vite app.

Both features are **frontend page + Express endpoint** pairs. Frontend talks
to the Express server same-origin (Vite dev proxy or static-served). The
server is the thing that holds AWS credentials and talks to the LAN.

---

## What you're porting

| Feature | Frontend | Backend | Live data source |
|---|---|---|---|
| Dynamic Path Selection | `DynamicPathSelection.tsx` (~1800 lines) + `useIpsecMetrics` hook + Bedrock insight card | MQTT subscriber (AWS IoT Core) + proto decoder + 4 endpoints | `rdk/ipsec/metrics` topic on AWS IoT Core |
| Video Analytics | `VideoAnalytics.tsx` (~2100 lines) | 2 MJPEG-passthrough endpoints | MJPEG inference nodes on private LAN |

Both features depend on a small set of **shared** components (Card, PageHeader,
useThemeColors, Toast, RichText markdown renderer).

---

## Integration in 5 steps

### Step 1 — Install dependencies

Both features add new npm packages. Run from the **target project's** root:

```bash
# Common (UI)
npm install lucide-react recharts react-router-dom

# DPS server
npm install express cors dotenv aws-iot-device-sdk-v2

# DPS AI insight (optional — drop if you don't need the AI card)
npm install @anthropic-ai/bedrock-sdk @anthropic-ai/sdk

# Dev (shared with this project)
npm install -D tsx concurrently
```

Full list with versions in [`package-deps.json`](./package-deps.json).

### Step 2 — Copy files verbatim

See [`inventory.md`](./inventory.md) for the exact source-→-destination map.
Roughly:

- **Shared UI** → copy `src/components/Card.tsx`, `PageHeader.tsx`,
  `src/ui/Theme.tsx`, `Toast.tsx`, `markdown.tsx`, plus the
  `design-tokens.css` from project root.
- **DPS** → copy `src/pages/DynamicPathSelection.tsx`,
  `src/ui/useIpsecMetrics.ts`, the IPsec types from `src/types.ts`,
  `server/ipsecProto.ts`, `server/ipsecSource.ts`.
- **Video** → copy `src/pages/VideoAnalytics.tsx`.
- **AI insight** (optional) → copy `server/llm.ts`, `server/bedrockBearer.ts`,
  `src/components/widgets/AiInsightCard.tsx`, the `runIpsecInsightSSE` helper
  from `src/ui/agentClient.ts`.

### Step 3 — Wire the Express routes

If the target project doesn't already have an Express server, create one.
See [`server-snippets/`](./server-snippets/) for **standalone** route files
you can drop in:

- [`ipsec-routes.ts`](./server-snippets/ipsec-routes.ts) — registers
  `/api/ipsec/snapshot`, `/api/ipsec/stream`, `/api/gateway/path`
- [`ipsec-insight-route.ts`](./server-snippets/ipsec-insight-route.ts) —
  registers `/api/ipsec/insight` (optional, Bedrock-powered)
- [`video-routes.ts`](./server-snippets/video-routes.ts) — registers
  `/api/video` and `/api/video/:id`

Each file exports a `registerXxxRoutes(app)` function. In your server entry:

```ts
import express from 'express';
import cors from 'cors';
import { registerIpsecRoutes }        from './ipsec-routes.js';
import { registerIpsecInsightRoute }  from './ipsec-insight-route.js';  // optional
import { registerVideoRoutes }        from './video-routes.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

registerIpsecRoutes(app);
registerIpsecInsightRoute(app);   // optional
registerVideoRoutes(app);

app.listen(3001);
```

### Step 4 — Configure environment

Copy [`.env.example`](./.env.example) to the target project's root, rename to
`.env`, and fill in real values. The critical ones:

```
# DPS — AWS IoT Core
AWS_IOT_ENDPOINT=alht1i2bx8tzt-ats.iot.us-east-1.amazonaws.com
AWS_IOT_TOPIC=rdk/ipsec/metrics
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# DPS — gateway path-control API (Force Fiber / Force 5G / Auto buttons)
GATEWAY_PATH_HOST=http://192.168.1.201:8090

# DPS — Bedrock (optional; for the AI Insight card)
AWS_BEARER_TOKEN_BEDROCK=ABSK...

# Video — MJPEG upstreams
VIDEO_BASE_NVIDIA=http://192.168.10.100:5000
VIDEO_BASE_HAILO=http://192.168.10.160:5000
```

Load these at the very top of your server entry (must beat shell env):

```ts
import { config as loadDotenv } from 'dotenv';
loadDotenv({ override: true });
```

### Step 5 — Wire the routes + dev proxy

In your Vite config (the target app's `vite.config.ts`):

```ts
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true, ws: false },
    },
  },
});
```

In your router (`react-router-dom`):

```tsx
import { DynamicPathSelectionPage } from './pages/DynamicPathSelection';
import { VideoAnalyticsPage }       from './pages/VideoAnalytics';

<Routes>
  <Route path="/dps"   element={<DynamicPathSelectionPage />} />
  <Route path="/video" element={<VideoAnalyticsPage />} />
</Routes>
```

Both pages assume `<ToastProvider>` is mounted somewhere above them in the
tree (for the path-change success/error toasts and any future notifications).
Wrap your `<App />`:

```tsx
import { ToastProvider } from './ui/Toast';

<ToastProvider>
  <App />
</ToastProvider>
```

---

## Run order on first try

```bash
# Terminal 1 — Express server
npx tsx watch server/index.ts

# Terminal 2 — Vite dev
npm run dev
```

Visit `http://localhost:5173/dps` — within ~2 s you should see the live
topology diagram populate with tunnels (assuming the gateway is publishing).
If it shows "No payload received yet," check the server logs for MQTT
subscription status — almost always an AWS creds issue.

Visit `http://localhost:5173/video` — the inference streams should appear if
your `VIDEO_BASE_*` env vars resolve to reachable MJPEG endpoints.

---

## Common pitfalls

- **AWS creds blocked by empty shell vars.** If `AWS_ACCESS_KEY_ID` is exported
  as an empty string in your shell, dotenv will think it's set and skip the
  `.env` value. Always use `loadDotenv({ override: true })`.
- **Browser can't reach `127.0.0.1:8090`** (the gateway's path-control API).
  That's by design — the browser hits `/api/gateway/path` (same-origin via
  Express), and Express forwards to `GATEWAY_PATH_HOST`. Set that env var to
  whatever IP the gateway is reachable at from the server.
- **MJPEG stream stutters / breaks.** Make sure no nginx/CloudFront sits
  between Vite and the server with buffering enabled. The route sets
  `X-Accel-Buffering: no` for nginx — your CDN may need its own config.
- **MQTT keeps disconnecting on WAN switch.** Tune Greengrass Nucleus
  `keepAliveTimeoutSeconds: 20` via a cloud deployment (see the discussion
  thread in the source project for the full reasoning).

---

## File-by-file reference

See [`inventory.md`](./inventory.md) for the master list of every file you
need to copy and where it goes in the target project.
