# Connected Enterprise

Cloud-ops dashboard for SD-WAN gateways across multiple branches — built around an
agentic-AI incident response workflow.

## Features at a glance

- **Overview / Fleet** — single-branch deep-dive plus a multi-branch fleet roll-up.
- **Connectivity** — LAN / WAN (Fiber + 5G) / PoE telemetry, dual-WAN failover view.
- **IT & OT Devices** — sortable inventories with row-click detail drawer; OT page
  has an emergency-unlock workflow with confirmation modal.
- **Dynamic Path Selection** — real-time SLA scoring with auto-failover thresholds.
- **Application-Aware Routing** — DPI categories → preferred path with backup.
- **Incidents (agentic)** — every alert becomes an incident assigned to a Claude
  agent. The agent investigates with read-only tools, diagnoses with a confidence
  score, and proposes remediation. OT-touching writes are gated behind explicit
  human approval.
- **Audit Log** — immutable record of every door unlock, policy change, firmware
  push, and agent decision.
- **Ask AI** — chat with the same agent stack for ad-hoc questions.
- **Live data** — KPI strip, bandwidth chart, and incident list update in real time;
  random toast events fire periodically; a fresh incident auto-appears ~50 s after
  page load to demo the end-to-end agentic flow.

## Quick start

```bash
npm install
npm run dev          # frontend only — Vite on :5174
```

## Gateway onboarding

`/onboarding` now uses a persistent local simulator during development and a separate, JWT-protected AWS control plane when the `VITE_ONBOARDING_*` variables are configured. Profiles are immutable and signed, assignments use monotonic generations, and a deployment is not successful until the gateway reports a healthy apply result.

See [Connected Enterprise onboarding on AWS](docs/AWS_ONBOARDING.md) for the architecture, security invariants, deployment commands, cloud outputs, manufacturing ledger, and gateway MQTT contract.

## Live IT/OT and Dynamic Failover telemetry

The Express server uses one AWS IoT connection for both pages. By default it
subscribes to `rdk/ipsec/metrics`, `prpl/ipsec/metrics`, and
`prplhome/ipsec/metrics`. For McKinney, `prpl/ipsec/metrics` is authoritative
for Dynamic Failover, WAN, and tunnel telemetry. `prplhome/ipsec/metrics` is
authoritative for IT/OT device inventory through its `wifi.clients[]` block.

Override the complete list only when needed:

```dotenv
IOT_IPSEC_TOPICS=rdk/ipsec/metrics,prpl/ipsec/metrics,prplhome/ipsec/metrics
IOT_IPSEC_DEVICE_TOPICS=rdk/ipsec/metrics,prplhome/ipsec/metrics
```

## Gateway Twin live bridge

The Gateway Twin consumes live gateway data through the Connected Enterprise
backend; it does not open a browser MQTT connection. `server/ipsecSource.ts`
reuses its existing AWS IoT WebSocket/SigV4 session and forwards these subscribed
topics to `server/gatewayTwinSource.ts`:

- Protobuf `LogBatch`: `gw/mygw/events`, `gw/mygw/status`
- prplOS DeviceInfo JSON: `prplos/deviceinfo/uptime`, `softwareversion`, `hardwareversion`, `serialnumber`, `memorystatus`, `cpuutilization`, `temperaturesensor`, and `processes` (each after the same `prplos/deviceinfo/` prefix)
- prplOS SoftwareModules JSON: `prplos/softwaremodules/executionunits` for live LCM container inventory and health
- prplOS Ethernet JSON: `prplos/ethernet/{eth1,eth0_1,eth0_4,eth0_3,eth0_2}`
- prplOS Wi-Fi JSON: subscribe to `prplos/wifi/#`, then forward only the
  supported `prplos/wifi/{wlan0,wlan2,wlan4}` radio reports to the twin

The twin connects to `/api/gateway-logs/stream`. That non-buffered SSE endpoint
replays bounded log history and the latest sample for each telemetry topic, then
streams `state`, `log-batch`, and `device-telemetry` events. Readiness is exposed
at `/api/gateway-logs/readyz`.

It uses the same `AWS_*`, `IOT_ENDPOINT`, `IOT_REGION`, and `IOT_CLIENT_ID`
configuration as the other live feeds—do not install a second certificate-based
bridge. Optional input aliases and retention can be set in `.env`:

```dotenv
IOT_GATEWAY_TWIN_EVENTS_TOPIC=gw/mygw/events
IOT_GATEWAY_TWIN_STATUS_TOPIC=gw/mygw/status
IOT_GATEWAY_TWIN_PRPLOS_PREFIX=prplos
IOT_GATEWAY_TWIN_HISTORY_SIZE=256
```

Input aliases are normalized back to the canonical topic names above before SSE
delivery, preserving the embedded twin's strict event contract. The AWS IoT
policy attached to the server credentials must allow subscribe access to the
`<IOT_GATEWAY_TWIN_PRPLOS_PREFIX>/wifi/#` topic filter and receive access to the
supported concrete Wi-Fi topics. It must also allow subscribe and receive access
to `<IOT_GATEWAY_TWIN_PRPLOS_PREFIX>/softwaremodules/executionunits`, along with
the other configured topics.

## Running the live Claude agent (Phase 2)

The Incidents page has a **"Run live Claude agent"** button. It hits `/api/agent/run`,
which is served by a small Express backend in [`server/`](server/) that talks to
Claude. The backend supports two providers, switchable with one env var:

### Option A — Direct Anthropic API
```bash
cp .env.example .env
# in .env:
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

npm run dev:full     # web on :5173, agent server on :3001
```

### Option B — AWS Bedrock
Use this if your org bills through AWS or needs IAM auth / VPC isolation.

```bash
cp .env.example .env
# in .env:
LLM_PROVIDER=bedrock
AWS_REGION=us-east-1                  # or wherever you enabled Claude in Bedrock
AWS_ACCESS_KEY_ID=AKIA...             # (or leave blank to use AWS default chain)
AWS_SECRET_ACCESS_KEY=...
# AGENT_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0   # override if needed

npm run dev:full
```

Bedrock notes:
- The default credential chain is honored, so on EC2 / ECS / Lambda you can drop
  the explicit keys and the IAM role will be picked up automatically.
- Model IDs differ from the direct API. Cross-region inference profiles
  (`us.anthropic....`) are the safe default for Claude 4.x in `us-east-1` /
  `us-west-2`. Check the Bedrock console under "Model access" for what's
  enabled in your account.
- Same Messages API surface — the agent loop, tools, and prompt caching all
  work identically.

`/api/health` reports the active provider + model + whether the client is
configured, so you can sanity-check before clicking the button.

Without a configured client the button still renders, but `/api/agent/run`
returns 503 with a clear message. The mocked agent timelines in
[`src/data/mock.ts`](src/data/mock.ts) keep working either way.

### Architecture

```
React (Vite)                 Express                 Anthropic
─────────────────┐           ──────────┐             ──────────┐
  Incidents UI   │  fetch    /api/      │  client     Claude    │
  + SSE consumer │ ──────►   agent/run  │ ────────►   Sonnet    │
  (agentClient)  │           (SSE)      │             4.6       │
                 │ ◄──────              │ ◄────────             │
   live steps    │  text/event-stream   │  tool_use loop        │
                 │                       │                       │
                 │           tools/      │  read-only mocks      │
                 │           prompts     │  + write gate         │
```

- **Streaming**: server-sent events (`event: thought | tool_call | tool_result | proposal | done | error`).
- **Tools**: `get_device`, `query_alerts`, `check_probe`, `get_dhcp_leases`,
  `get_wan_status`, `get_wifi_client`, `request_human_approval`, `force_dhcp_renew`.
- **Safety gate**: `force_dhcp_renew` returns `BLOCKED` unless `request_human_approval`
  was invoked first. The system prompt also enforces this verbally.
- **Prompt caching** is enabled on the system prompt so per-incident cost stays
  well under ~$0.05 (Haiku) or ~$0.10 (Sonnet) even with multi-turn tool loops.
- **Provider + model are env-configurable** via `LLM_PROVIDER` (`anthropic` |
  `bedrock`) and `AGENT_MODEL`. Sensible defaults pick Haiku 4.5 for whichever
  provider you choose.

## Scripts

| Script              | What it does                                |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | Vite dev server (frontend only)             |
| `npm run dev:server`| Agent server only (tsx watch on port 3001)  |
| `npm run dev:full`  | Both, side-by-side with concurrently        |
| `npm run build`     | Type-check + production frontend build      |
| `npm run preview`   | Preview the production build                |

## Demo script (60 seconds)

1. Open `/incidents` and click **INC-2026-0142** (Door lock DL-2 offline).
2. The mocked agent timeline shows how a Claude agent investigated.
3. Click **Approve & execute** on the pending action — watch 9 follow-up steps stream.
4. Click **Run live Claude agent** on a different incident — real Claude streams
   responses with tool calls and tool results.
5. Wait ~50 s on the page — a fresh incident (INC-2026-0143) appears with toast.

## Layout

```
src/
  App.tsx, main.tsx
  ui/             # ThemeProvider, ToastProvider, LiveDataProvider, agentClient (SSE)
  pages/          # Overview, Fleet, Incidents, AuditLog, ...
  components/     # TopBar, Sidebar, widgets/...
  data/mock.ts    # Branches, devices, incidents, audit, fleet stats
  types.ts
server/
  index.ts        # Express + SSE endpoint
  gatewayTwinSource.ts # Twin LogBatch/prplOS decoding, state, and bounded replay
  agent.ts        # Agent loop (Anthropic Messages API + tool use)
  tools.ts        # Tool defs + mocked impls + write-gate
  prompts.ts      # Personas (OT, WAN, IT, Fleet)
```
