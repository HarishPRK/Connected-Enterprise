# File inventory — qsr-devices-pack

Copy destinations assume the target repo root. The `frontend/` folder can be
mounted at ANY path inside the target's `src/` (all imports are
folder-internal); `src/connected-devices/` is the suggested name used by the
README examples.

## frontend/ → `src/connected-devices/`

| File | Role | Provenance |
|---|---|---|
| `index.ts` | Public API barrel — the only file the host app imports from | new |
| `types.ts` | `Status`, `Device`, `DeviceTelemetry`, `HealthSignal`, `DeviceHealth`, `FleetStat` | verbatim subset of `src/types.ts` |
| `pages/Devices.tsx` | `DevicesPage({ domain, branchId })` — table, filters, reclassify, power control, drawer, unlock modal | copy; only `../data/mock` → `../data/devicesMock` |
| `data/devicesMock.ts` | Demo fleets (Plano/McKinney), per-branch synth, deterministic mock health | carved from `src/data/mock.ts` (full transitive closure) |
| `ui/useDevices.ts` | Live hook: `GET /api/devices/snapshot` + SSE `/api/devices/stream`; `classifyDevice`/`controlMatterDevice`/`controlShellyDevice`/`refreshMatterDevices` | verbatim |
| `ui/deviceTelemetry.ts` | Pure telemetry→health/summary/tile functions | verbatim |
| `ui/DeviceDrawer.tsx` | Health drawer (badges, metering, diagnostics) | copy; mock import rewrite |
| `ui/Drawer.tsx`, `ui/Modal.tsx`, `ui/Toast.tsx`, `ui/Theme.tsx`, `ui/markdown.tsx` | Shared primitives (`ToastProvider`, `ThemeProvider`, `useThemeColors`) | verbatim |
| `ui/agentClient.ts` | `runInsightSSE` (AI card transport) | trimmed to the insight slice |
| `components/Card.tsx`, `PageHeader.tsx`, `StatusBadge.tsx` | Shared UI atoms | verbatim |
| `components/widgets/DevicesDashboard.tsx` | Analytics band (Recharts; polls `/api/devices/telemetry/history` every 10s) | verbatim |
| `components/widgets/AiInsightCard.tsx` | Optional Bedrock insight card | verbatim |
| `styles/devices.css` | Design tokens (light+dark) + every component style the feature uses — import once | design-tokens.css + curated App.css/index.css blocks |
| `tsconfig.check.json` | Standalone typecheck for this folder | new |

## server/ → `server/`

| File | Role | Provenance |
|---|---|---|
| `devices-routes.ts` | `registerDevicesRoutes(app)` — all 7 `/api/devices*` routes incl. SSE stream | lifted verbatim from `server/index.ts:577-722` |
| `insight-route.ts` | `registerInsightRoute(app)` — optional `/api/insight` | lifted from `server/index.ts:222-321` |
| `deviceSource.ts` | Inventory aggregator: merge/dedupe by MAC, IT/OT heuristics, override persistence | copy; `../src/types.js` → `./types.js` |
| `ipsecSource.ts` | The single MQTT/WSS connection: device topics, Matter list/control, Shelly RPC, ipsec metrics (Wi-Fi client feed) | copy; same import rewrite |
| `ipsecProto.ts` | Zero-dep proto3 decoder for the metrics topic | verbatim |
| `telemetryHistory.ts` | Rolling per-MAC buffers; rates from byte-counter deltas | copy; same import rewrite |
| `llm.ts`, `bedrockBearer.ts` | LLM client factory (only for insight-route) | verbatim |
| `types.ts` | Server-side type subset (`Device`, `DeviceTelemetry`, `Status`, `Ipsec*`) | verbatim subset of `src/types.ts` |
| `index.example.ts` | Minimum viable server entry (dotenv → cors/json → routes → `ipsecSource.start()` → listen) | new |
| `tsconfig.check.json` | Standalone NodeNext typecheck | new |

## scripts/ → `scripts/` (optional, dev only)

| File | Simulates |
|---|---|
| `sim-device-inventory.ts` | Gateway LAN discovery → `rdk/devices/inventory` every 8s (`--loop`) |
| `sim-matter-list.ts` | Matter hub list → `rdk/matter/devices/list` every 30s (`--loop`) |

## Intentionally NOT included

- `DeviceDonut.tsx`, `DeviceSummary.tsx` — dead widgets (imported nowhere), would add mock + router coupling.
- `LiveData`, `OpsIncidents`, `useIpsecMetrics`, `CommandPalette` — the feature has zero references to them.
- The DPS/Video integration-bundle content — different feature; note its `src/types.ts` is STALE for devices (old `Device` shape). Always source from this pack.
