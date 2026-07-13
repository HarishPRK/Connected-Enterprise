# File inventory — qsr-failover-pack

Copy destinations assume the target repo root. `frontend/` can mount at any
path inside the target's `src/` (imports are folder-internal);
`src/connected-failover/` is the README's suggested name. **Shared** rows are
byte-identical to the same file in `qsr-devices-pack` — when composing both
packs, keep one copy (overwriting is safe in either direction, except
`types.ts`: use THIS pack's, it is the superset).

## frontend/ → `src/connected-failover/`

| File | Role | Provenance |
|---|---|---|
| `index.ts` | Public API barrel (`DynamicPathSelectionPage`, providers, `useIpsecMetrics`, …) | new |
| `types.ts` | Devices baseline types + full Ipsec/Cellular family + `PathThreshold`/`WanPath` | verbatim superset of `src/types.ts` extracts — **replaces** the devices pack's copy when composing |
| `pages/DynamicPathSelection.tsx` | The whole feature: tunnel cards, SLA charts, WAN/5G radio detail, Force Fiber/5G/Auto, AI readout | copy; only `../data/mock` → `../data/failoverMock` |
| `data/failoverMock.ts` | `pathThresholds` SLA bands + `BRANCH_TO_IPSEC_SOURCE` | carved verbatim from `src/data/mock.ts` |
| `ui/useIpsecMetrics.ts` | Live hook: `GET /api/ipsec/snapshot` + SSE `/api/ipsec/stream` (`snapshot`/`update`/`status`) | verbatim |
| `ui/useDevices.ts` | Device inventory hook (IT/OT tunnel tags) | **shared** |
| `ui/agentClient.ts` | `runIpsecInsightSSE` transport | **shared** |
| `ui/Theme.tsx`, `ui/Toast.tsx`, `ui/Modal.tsx`, `ui/markdown.tsx` | Providers + primitives | **shared** |
| `components/Card.tsx`, `components/PageHeader.tsx` | UI atoms | **shared** |
| `components/widgets/Sparkline.tsx` | Inline SVG trend line (zero deps) | verbatim |
| `styles/failover.css` | Token base + shared primitives + `.failover-page`/`.ipsec-*`/`.kpi-*` blocks | derived from devices.css base + App.css extracts |
| `tsconfig.check.json` | Standalone typecheck | **shared** |

## server/ → `server/`

| File | Role | Provenance |
|---|---|---|
| `ipsec-routes.ts` | `registerIpsecRoutes(app)`: `/api/ipsec/snapshot`, `/api/ipsec/stream` (SSE), `/api/gateway/path` (7 modes, ack-aware 200/202/502) | lifted verbatim from `server/index.ts` |
| `ipsec-insight-route.ts` | `registerIpsecInsightRoute(app)`: `/api/ipsec/insight` (dedicated SSE readout) | lifted verbatim from `server/index.ts` |
| `devices-routes.ts` | `/api/devices/*` (page's IT/OT tags need snapshot+stream) | **shared** |
| `ipsecSource.ts` | The single MQTT connection: metrics protobuf, path control publish/ack, inventory, Matter/Shelly | **shared** |
| `ipsecProto.ts`, `telemetryHistory.ts`, `deviceSource.ts`, `types.ts`, `llm.ts`, `bedrockBearer.ts` | Engine + LLM factory | **shared** |
| `index.example.ts` | Minimal server entry wiring all registrars + `ipsecSource.start()` | new |
| `tsconfig.check.json` | Standalone NodeNext typecheck | **shared** |

## Intentionally NOT included

- `FailoverTopology` widget — it *consumes* this page's exports (used by the
  Overview page), not the other way round.
- `AiInsightCard` — this page ships its own inline `IpsecAiInsightsCard`.
- ipsec-metrics simulator — none exists; live tunnel data requires a real
  gateway publishing on `rdk|prpl/ipsec/metrics`.
- `integration/` and `integration-bundle/` content — **stale** (pre-dates
  path-control over MQTT and the Cellular metrics family). Never source from
  them.
