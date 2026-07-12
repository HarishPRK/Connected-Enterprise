# IT/OT Devices — Integration Pack for Project QSR

Self-contained port of the **IT/OT Devices** feature (live LAN device inventory,
IT/OT classification with operator overrides, Matter/Shelly power control,
per-device telemetry charts, health drawer) from Connected Enterprise into
another React + Vite app.

**This README is written to be handed to the coding agent doing the
integration. Follow it top to bottom; the checklist at the end verifies the
result.**

The feature is a **frontend page + Express backend** pair. The frontend only
ever talks to `/api/devices/*` (same-origin; Vite dev proxy or static-served) —
the host app never touches MQTT, AWS, classification logic, or persistence.
The Express slice holds the AWS credentials and talks to the gateways.

```
Browser ── /api/devices/* (REST + SSE) ──> Express slice ── MQTT/WSS (SigV4) ──> AWS IoT Core ── gateways
   ▲                                          │
   └── <DevicesPage domain branchId> ─────────┘  (snapshot pushed on every change)
```

---

## What's in this pack

| Folder | Contents | Where it goes in the target app |
|---|---|---|
| `frontend/` | The complete UI feature: `DevicesPage`, hooks, drawer, dashboard widgets, types, mock/demo data, one stylesheet | Copy the whole folder to `src/connected-devices/` (any name works — imports are internal-relative) |
| `server/` | Express slice: route registrars + MQTT/inventory/telemetry engine | Copy to `server/` (or merge into an existing Express server) |
| `scripts/` | MQTT simulators — run the feature with **no physical gateway** | Copy to `scripts/` (optional but recommended for dev) |
| `inventory.md` | Exact file-by-file map | — |
| `package-deps.json` | npm deps with the exact versions this pack was built against | — |
| `.env.example` | Every env var the server slice reads | Copy to target root as `.env` and fill in |

---

## Integration steps

### 1 — Install dependencies

From the target project root:

```bash
# Frontend
npm install lucide-react recharts

# Server
npm install express cors dotenv aws-iot-device-sdk-v2

# Optional — only if you keep the AI Insight card (/api/insight)
npm install @anthropic-ai/sdk @anthropic-ai/bedrock-sdk

# Dev
npm install -D tsx typescript @types/express @types/cors @types/node
```

React 18+ required (pack built against React 19). Exact versions in
[`package-deps.json`](./package-deps.json).

### 2 — Copy the frontend folder

Copy `frontend/` → `src/connected-devices/` in the target app. Do not
rearrange its internal structure (all imports are relative within the folder).

### 3 — Mount the page

```tsx
import { DevicesPage, ToastProvider, ThemeProvider } from './connected-devices';
import './connected-devices/styles/devices.css';   // once, e.g. in main.tsx

// Providers must wrap the page (Toast for action feedback, Theme for charts):
<ThemeProvider>
  <ToastProvider>
    <DevicesPage domain="IT" branchId="b-mck-03" />
    {/* and/or a second mount with domain="OT" */}
  </ToastProvider>
</ThemeProvider>
```

**The `branchId` contract (important):**

- `branchId="b-mck-03"` → shows the **McKinney fleet** (gateway feed tagged `prpl`).
- `branchId="b-pln-01"` → shows the **Plano fleet** (tagged `rdk`).
- Any other string → demo/mock devices only, never live data.

The page filters live devices by `device.locationSource === (branch's source)`
with strict equality. **The two fleets must never be shown mixed** — this is a
hard product rule. Do not "improve" the filter to show both; if QSR needs both
sites, mount the page twice with the two branch ids.

For QSR (the McKinney kitchen site) `b-mck-03` is almost certainly the one you
want. Until the gateway feed connects, the page shows seeded demo devices with
a "Demo data · no gateway feed" pill — that is expected, not a bug.

`ThemeProvider` stamps `data-theme="light|dark"` on `<html>` and persists to
localStorage key `ce-theme`. If the host app has its own theming, mount the
provider anyway (the stylesheet's tokens key off `[data-theme]`).

### 4 — Wire the Express routes

If the target has no Express server, use `server/index.example.ts` as the
entry verbatim. If it has one, register the routes:

```ts
import { config as loadDotenv } from 'dotenv';
loadDotenv({ override: true });          // MUST run before anything else

import express from 'express';
import cors from 'cors';
import { registerDevicesRoutes } from './devices-routes.js';
import { registerInsightRoute }  from './insight-route.js';   // optional (AI card)
import { ipsecSource } from './ipsecSource.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

registerDevicesRoutes(app);
registerInsightRoute(app);   // remove if no Bedrock/Anthropic key

void ipsecSource.start();    // ← REQUIRED. No start() = seed data forever.

app.listen(Number(process.env.PORT ?? 3001));
```

Notes:
- The server slice is **ESM** (NodeNext, `.js` import suffixes,
  `import.meta.url`). Run with `npx tsx watch server/index.ts` or compile with
  a NodeNext tsconfig. Target `"type": "module"` in package.json.
- Do NOT strip the ipsec-metrics subscription out of `ipsecSource.ts` even
  though QSR doesn't use the ipsec UI — the Wi-Fi client blocks inside those
  messages are the main source of live device discovery and telemetry
  (RSSI, byte counters → throughput charts).

### 5 — Environment

Copy `.env.example` → target root `.env` and fill in AWS credentials. The
defaults already point at the shared IoT endpoint and the production topics.
Two that deserve attention:

- `DEVICE_OVERRIDES_PATH` — IT/OT reclassifications persist to this JSON file.
  Default is `server/.data/device-overrides.json` **relative to the compiled
  file**; on a deployed box set it to an absolute, writable, persistent path.
- Credentials: either `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, or
  `AWS_PROFILE`, or `AWS_USE_INSTANCE_ROLE=1` on EC2.

### 6 — Vite dev proxy

```ts
// vite.config.ts
server: {
  proxy: {
    '/api': { target: 'http://localhost:3001', changeOrigin: true, ws: false },
  },
},
```

---

## Running without a gateway (simulators)

```bash
# Terminal 1 — server
npx tsx watch server/index.ts

# Terminal 2 — fake LAN inventory every 8s (flips a Shelly online/offline)
npx tsx scripts/sim-device-inventory.ts --loop

# Terminal 3 (optional) — fake Matter hub list every 30s
npx tsx scripts/sim-matter-list.ts --loop
```

The sims publish to the real MQTT topics through AWS IoT Core, so they need
the same AWS creds as the server. Sim devices carry no `telemetry` field, so
the history charts stay on simulated data under the sims — live charts light
up only with a real gateway (or after extending the sim payloads with
`telemetry: { rxBytes, txBytes, rssiDbm }`).

Sim inventory arrives on `rdk/...` topics → tagged as the **Plano** fleet →
use `branchId="b-pln-01"` when testing with sims (or set
`SIM_DEVICE_TOPIC=prpl/devices/inventory` to feed the McKinney side).

---

## Behavior notes (so nobody "fixes" working demo behavior)

- **Add device / Export** buttons are intentional no-ops (demo chrome).
- **Emergency Unlock / Reboot / Disable** in the drawer are toast-only stubs —
  no backend calls. Emergency Unlock only appears for `door_lock` devices.
- The page scrolls its container to top when the drawer opens via
  `document.querySelector('.main')` — if the host's scroll container doesn't
  have class `main`, that line silently no-ops (harmless) or adapt the
  selector in `pages/Devices.tsx`.
- Matter/Shelly power toggles are optimistic with automatic revert on failure;
  every other mutation waits for the server to push a fresh snapshot over SSE.
- Matter control publishes `queryCmd: UPDATE_DEVICE` deliberately
  (`IOT_MATTER_QUERY_CMD`) — a workaround for a hub firmware bug. Don't
  "correct" it to `CONTROL_DEVICE` until the hub is fixed.

## API surface (what the host app is allowed to know)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/devices/snapshot` | Full inventory snapshot |
| GET | `/api/devices/stream` | SSE — `snapshot` events, `: hb` every 15s |
| POST | `/api/devices/classify` | `{ mac, domain: 'IT'\|'OT' }` — persist override |
| GET | `/api/devices/telemetry/history` | Per-MAC series for the dashboard |
| POST | `/api/devices/matter/refresh` | Ask gateway to re-publish Matter list |
| POST | `/api/devices/matter/control` | `{ nodeId, action: 'On'\|'Off' }` |
| POST | `/api/devices/shelly/control` | `{ deviceId, action: 'On'\|'Off' }` |
| POST | `/api/insight` *(optional)* | SSE `chunk`/`done`/`error` — AI card |

Everything else (MQTT topics, merge/dedupe, classification heuristics,
override persistence, telemetry buffering) is internal to the server slice.

---

## Verification checklist

- [ ] `npm install` resolves cleanly
- [ ] `npx tsc -p src/connected-devices/tsconfig.check.json --noEmit` passes
      (or the app's own typecheck covers the folder)
- [ ] `npx tsc --noEmit -p server/tsconfig.check.json` passes
- [ ] `devices.css` imported once; page renders with correct styling in
      light AND dark (`document.documentElement.dataset.theme = 'dark'`)
- [ ] `<ToastProvider>` + `<ThemeProvider>` above `DevicesPage` (missing Toast
      provider throws at mount: "useToast must be inside ToastProvider")
- [ ] Server logs show MQTT connected; `GET /api/health` → `connected: true`
- [ ] With `sim-device-inventory.ts --loop` running and
      `branchId="b-pln-01"`: pill flips to "Live · gateway feed" within ~10s,
      6 sim devices appear, one Shelly flips online/offline every other tick
- [ ] Reclassify a device IT→OT: "moved" chip appears, survives server
      restart (check `DEVICE_OVERRIDES_PATH` file)
- [ ] SSE reconnects after killing/restarting the server (pill goes
      "Gateway offline · last known" → back to live)
