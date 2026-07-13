# Dynamic Failover — Integration Pack for Project QSR

Self-contained port of the **Dynamic Failover / Dynamic Path Selection** feature
(live IPsec tunnel telemetry, per-tunnel latency/loss/MOS SLA view, WAN + 5G
radio detail, **Force Fiber / Force 5G / Auto path control with gateway ack**,
and an AI ops readout) from Connected Enterprise into another React + Vite app.

**This README is written to be handed to the coding agent doing the
integration. Follow it top to bottom; the checklist at the end verifies the
result.**

Like the devices pack, it is a **frontend page + Express backend** pair. The
frontend only talks to `/api/ipsec/*`, `/api/gateway/path`, and
`/api/devices/*` (for IT/OT tags on tunnel rows) — MQTT, protobuf decoding,
and path-command publishing stay inside the Express slice.

```
Browser ── /api/ipsec/* (REST+SSE) · /api/gateway/path ──> Express ── MQTT/WSS ──> AWS IoT ── gateways
   ▲                                                          │            (rdk/prpl ipsec metrics,
   └── <DynamicPathSelectionPage branchId> ───────────────────┘             <src>/path/control + ack)
```

---

## ⚠ Composing with `qsr-devices-pack`

The two packs share one engine. Every shared file is **byte-identical** across
packs, so order does not matter and overwriting is always safe:

- **If `qsr-devices-pack` is already integrated:** skip every file that already
  exists; add only the NEW ones — `pages/DynamicPathSelection.tsx`,
  `ui/useIpsecMetrics.ts`, `components/widgets/Sparkline.tsx`,
  `data/failoverMock.ts`, `styles/failover.css`, server `ipsec-routes.ts` +
  `ipsec-insight-route.ts` — and **replace `frontend/types.ts` with this
  pack's copy** (it is a strict superset: devices types + the Ipsec/Cellular
  family). Then add `registerIpsecRoutes(app)` + `registerIpsecInsightRoute(app)`
  next to the existing `registerDevicesRoutes(app)`.
- **If installing this pack alone:** copy everything; it is complete on its
  own (the devices routes/engine ship inside because the page's IT/OT tunnel
  tags read the live device inventory).
- **Never run two copies of `ipsecSource`** — one process, one MQTT connection,
  one `void ipsecSource.start()`.

---

## What's in this pack

| Folder | Contents | Where it goes in the target app |
|---|---|---|
| `frontend/` | `DynamicPathSelectionPage`, `useIpsecMetrics` hook, shared UI primitives, types, mock thresholds, one stylesheet | Copy the whole folder to `src/connected-failover/` (any name — imports are internal-relative). If the devices pack lives at `src/connected-devices/`, merge into that folder instead and keep one copy of shared files. |
| `server/` | `registerIpsecRoutes` + `registerIpsecInsightRoute` + the shared MQTT/inventory engine + devices routes | Copy to `server/` (or merge — identical files overwrite safely) |
| `inventory.md` | Exact file-by-file map with provenance | — |
| `package-deps.json` | npm deps with exact versions | — |
| `.env.example` | Every env var the server slice reads | Copy to target root as `.env` and fill in |

---

## Integration steps

### 1 — Install dependencies

Same set as the devices pack (recharts is genuinely used here for the SLA
charts):

```bash
npm install lucide-react recharts
npm install express cors dotenv aws-iot-device-sdk-v2
npm install @anthropic-ai/sdk @anthropic-ai/bedrock-sdk   # optional — AI readout card
npm install -D tsx typescript @types/express @types/cors @types/node
```

### 2 — Copy the frontend folder

Copy `frontend/` → `src/connected-failover/` (or merge into the devices-pack
folder). Do not rearrange its internal structure.

### 3 — Mount the page

```tsx
import { DynamicPathSelectionPage, ToastProvider, ThemeProvider } from './connected-failover';
import './connected-failover/styles/failover.css';   // once (skip shared-base duplication if the devices css is already loaded — see note)

<ThemeProvider>
  <ToastProvider>
    <DynamicPathSelectionPage branchId="b-mck-03" />
  </ToastProvider>
</ThemeProvider>
```

**The `branchId` contract (same hard rule as the devices pack):**

- `b-mck-03` → McKinney gateway (`prpl` feed) · `b-pln-01` → Plano (`rdk` feed).
- The page maps `branchId` through `BRANCH_TO_IPSEC_SOURCE` and shows ONLY that
  gateway's tunnels/devices — strict source separation, never mix the two.

**CSS note:** `failover.css` and `devices.css` share the same token/base
section. Loading both is harmless (identical rules), but if both packs are
installed you can keep just one of the two base sections — simplest is to load
both files and not worry.

### 4 — Wire the Express routes

```ts
import { config as loadDotenv } from 'dotenv';
loadDotenv({ override: true });

import express from 'express';
import cors from 'cors';
import { registerIpsecRoutes } from './ipsec-routes.js';
import { registerIpsecInsightRoute } from './ipsec-insight-route.js';   // optional (AI card)
import { registerDevicesRoutes } from './devices-routes.js';            // used by the page's IT/OT tags
import { ipsecSource } from './ipsecSource.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

registerIpsecRoutes(app);          // /api/ipsec/snapshot, /api/ipsec/stream, /api/gateway/path
registerIpsecInsightRoute(app);    // /api/ipsec/insight — remove if no Bedrock/Anthropic key
registerDevicesRoutes(app);        // /api/devices/* — skip if the devices pack already registered it

void ipsecSource.start();          // ← REQUIRED, exactly once per process

app.listen(Number(process.env.PORT ?? 3001));
```

Or use `server/index.example.ts` verbatim. ESM/NodeNext, same as the devices
pack (`"type": "module"`, run with `npx tsx watch server/index.ts`).

### 5 — Environment

`.env.example` here is a superset-compatible copy of the devices pack's — the
same AWS/IoT variables drive both features. Nothing new is required for
failover beyond `IOT_IPSEC_TOPICS` (default already correct) and
`IOT_PATH_PREFIXES` (default `rdk,prpl` — the topics path commands publish to).

### 6 — Vite dev proxy

```ts
proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true, ws: false } }
```

---

## Behavior notes (do not "fix")

- **Force Fiber / Force 5G / Auto / per-tunnel force** buttons POST
  `/api/gateway/path` and wait for a real gateway ack over MQTT. A **202**
  response means "published, no ack within 6 s" — the UI already treats that
  as pending, not failure.
- With **no gateway feed**, the page shows its waiting/sample state — that is
  expected without hardware. There is no simulator for ipsec metrics (the
  devices-pack sims cover inventory topics only); real tunnel data needs a
  live gateway on `rdk/ipsec/metrics` or `prpl/ipsec/metrics`.
- The AI readout card calls the **dedicated** `POST /api/ipsec/insight` (empty
  body; the server reads its own live snapshot). 503 = LLM not configured,
  409 = no gateway data yet. Both render as a friendly message in the card.
- The page exports `LiveIpsecCard` and `SAMPLE_IPSEC_GATEWAY` — other views
  (e.g. an overview topology) may embed them; keep the exports.
- `pathThresholds` (warn/fail bands for latency/jitter/loss/MOS) is seed data
  in `data/failoverMock.ts` — edit there to tune the SLA bands.

## API surface (all the host app may know)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/ipsec/snapshot` | Current state of all gateways |
| GET | `/api/ipsec/stream` | SSE — `snapshot` / `update` / `status` events, `: hb` 15s |
| POST | `/api/gateway/path` | `{ mode: auto\|fiber\|5g\|tunnel1..4, source: rdk\|prpl }` → 200 acked · 202 pending · 502 rejected |
| POST | `/api/ipsec/insight` *(optional)* | SSE `chunk`/`done`/`error` — 3-bullet ops readout |
| GET | `/api/devices/snapshot` + `/api/devices/stream` | Device inventory for IT/OT tunnel tags |

---

## Verification checklist

- [ ] `npx tsc -p src/connected-failover/tsconfig.check.json` passes
- [ ] `npx tsc --noEmit -p server/tsconfig.check.json` passes
- [ ] Page renders in light AND dark with `failover.css` loaded
- [ ] `<ToastProvider>` + `<ThemeProvider>` above the page (missing Toast throws at mount)
- [ ] Server logs MQTT connected; `GET /api/health` → `connected: true`
- [ ] `GET /api/ipsec/snapshot` returns `{ gateways: ... }` (empty until a gateway publishes — fine)
- [ ] With a live gateway: tunnels appear, active path highlighted, SLA chart ticks
- [ ] Force 5G on the test gateway → button shows pending/ack, gateway flips, UI follows via SSE
- [ ] Only ONE `ipsecSource.start()` in the process (check when composing with the devices pack)
