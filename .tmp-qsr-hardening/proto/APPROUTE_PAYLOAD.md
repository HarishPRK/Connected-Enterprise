# `approute/control` — payload contract

Application → tunnel steering commands published by the **Connected Enterprise
dashboard** for a gateway to consume. This is the *inbound* direction for the
gateway (cloud → device). It is the mirror of the `routing/*` telemetry the AAR
plugin publishes outbound.

---

## 1. Transport

| | |
|---|---|
| **Topic** | `prpl/approute/control` (McKinney) · `rdk/approute/control` (Plano) |
| **Payload** | binary **proto3** `AppRouteCommand` (not JSON) |
| **QoS** | 1 |
| **Broker** | AWS IoT Core (same account/endpoint as `<prefix>/ipsec/metrics`) |
| **Published when** | an operator re-patches an application to another tunnel, applies an AI-advisor suggestion, or toggles a routing freeze on the dashboard |
| **Ack** | **none today** — fire-and-forget (see §7) |

The dashboard encodes the message in the browser and the server relays the exact
bytes to IoT Core; nothing is re-encoded in between.

### EC2 service and authorization

- Run the root TypeScript service on `127.0.0.1:3001` under the instance's
  service manager. `deploy/qsr-routing-api.service` is the checked-in example;
  adjust its working directory to the EC2 checkout before installing it.
- `qsr.conf.new` proxies the routing APIs, disables nginx buffering for the
  AAR/IPsec event streams, and protects `/api/approute/publish` with nginx Basic
  Auth. Create `/etc/nginx/.htpasswd-qsr-routing` during deployment; nginx
  injects the authenticated operator identity into the loopback-only service.
- Production route publishing is fail-closed. `APP_ROUTE_CONTROL_TOKEN` is an
  optional bearer credential for trusted localhost automation, never a value to
  put in the React bundle.
- Set `CORS_ORIGIN` only when a separate trusted web origin must call the local
  service. Same-origin nginx traffic requires no CORS allowance.
- Do not expose port 3001 publicly. In production the service binds to
  `127.0.0.1` by default; nginx is the public entry point.

---

## 2. Schema

Save as `app_route.proto` and generate a decoder, e.g.
`protoc --python_out=. app_route.proto` (or `--go_out`, `--java_out`, …).

```proto
syntax = "proto3";

package approute;

// One application riding one IPsec tunnel. `tunnel` is the tunnel ifname
// exactly as the gateway reports it on <prefix>/ipsec/metrics
// (e.g. "vti-fiber1", "vti-cell2").
message TunnelBinding {
  string application = 1;   // e.g. "Netflix", "Microsoft Teams"
  string tunnel      = 2;   // tunnel ifname from ipsec metrics
}

// Who chose the route.
enum RouteOrigin {
  ROUTE_ORIGIN_UNSPECIFIED       = 0;
  ROUTE_ORIGIN_OPERATOR          = 1;  // manual drag / click / keyboard
  ROUTE_ORIGIN_ADVISOR_AI        = 2;  // applied from the AI route advisor
  ROUTE_ORIGIN_ADVISOR_HEURISTIC = 3;  // advisor's deterministic fallback
}

// Move one client's application from `current` to `desired`.
message ClientRouteChange {
  string client_mac       = 1;
  string client_name      = 2;
  TunnelBinding current   = 3;  // what the client rides today
  TunnelBinding desired   = 4;  // what it should be moved to
  RouteOrigin origin      = 5;
  string advisor_reason   = 6;  // advisor origins only; free text
  double expected_gain_ms = 7;  // advisor's net latency gain estimate
  bool   freeze           = 8;  // freeze state at time of change (always sent)
}

// Routing lock for one client's application. While freeze=true the gateway
// SHOULD reject/ignore any steering for this client+application and hold it
// on `tunnel`, until a freeze=false for the same client+application arrives.
message ClientFreeze {
  string client_mac  = 1;
  string client_name = 2;
  string application = 3;
  bool   freeze      = 4;   // true = lock, false = release (always sent)
  string tunnel      = 5;   // tunnel to hold the application on
}

message AppRouteCommand {
  uint64 timestamp_ms                = 1;  // ms since epoch, publisher clock
  string source                      = 2;  // "prpl" | "rdk"
  string gateway                     = 3;  // gateway name from ipsec metrics
  repeated ClientRouteChange changes = 4;
  repeated ClientFreeze freezes      = 5;
  string type                        = 6;  // "user_initiated"
}
```

---

## 3. Field reference

### `AppRouteCommand` (top level)

| Field | # | Type | Notes |
|---|---|---|---|
| `timestamp_ms` | 1 | uint64 | Publisher clock. Use for ordering/dedup, not as a trusted time source. |
| `source` | 2 | string | `"prpl"` or `"rdk"`. Matches the topic prefix; useful as a sanity check. |
| `gateway` | 3 | string | Gateway name as reported in `<prefix>/ipsec/metrics`. |
| `changes` | 4 | repeated | Route moves. **May be empty.** |
| `freezes` | 5 | repeated | Freeze/unfreeze toggles. **May be empty.** |
| `type` | 6 | string | Currently always `"user_initiated"` — a person did this on the dashboard. Reserved for automated senders later. |

### `ClientRouteChange`

| Field | # | Type | Notes |
|---|---|---|---|
| `client_mac` | 1 | string | Stable client identifier. On live AAR data this may be a source **IP** rather than a MAC — treat it as an opaque key. |
| `client_name` | 2 | string | Human label, for logs. Do not key on it. |
| `current` | 3 | TunnelBinding | What the dashboard believed the client was on. Use to detect a stale command. |
| `desired` | 4 | TunnelBinding | **The instruction.** Move this application to this tunnel. |
| `origin` | 5 | enum | How the route was chosen. Informational — does not change what you apply. |
| `advisor_reason` | 6 | string | Free text from the advisor; empty for manual moves. Log it, don't parse it. |
| `expected_gain_ms` | 7 | double | Advisor's predicted improvement. Informational. |
| `freeze` | 8 | bool | The client's freeze state at the time. In practice always `false` — the UI blocks moving a frozen client (see §6). |

### `ClientFreeze`

| Field | # | Type | Notes |
|---|---|---|---|
| `client_mac` | 1 | string | Same opaque key as above. |
| `client_name` | 2 | string | Human label. |
| `application` | 3 | string | Which application on that client is locked. |
| `freeze` | 4 | bool | `true` = lock, `false` = release. |
| `tunnel` | 5 | string | The tunnel to hold the application on while locked. |

---

## 4. Sample payloads

These are **JSON views** of the decoded message — the wire format is binary
proto3. Enum values travel as integers; the name is shown for readability.

### 4.1 Manual re-patch (operator dragged the wire)

```json
{
  "timestamp_ms": 1784272693078,
  "source": "prpl",
  "gateway": "prpl-OSPv2-gateway",
  "type": "user_initiated",
  "changes": [
    {
      "client_mac": "aa:bb:cc:00:00:02",
      "client_name": "back-office",
      "current": { "application": "Netflix", "tunnel": "vti-fiber1" },
      "desired": { "application": "Netflix", "tunnel": "vti-cell1" },
      "origin": 1,
      "advisor_reason": "",
      "expected_gain_ms": 0,
      "freeze": false
    }
  ],
  "freezes": []
}
```

### 4.2 AI-advisor suggestion applied

```json
{
  "timestamp_ms": 1784272701432,
  "source": "prpl",
  "gateway": "prpl-OSPv2-gateway",
  "type": "user_initiated",
  "changes": [
    {
      "client_mac": "aa:bb:cc:00:00:02",
      "client_name": "back-office",
      "current": { "application": "Netflix", "tunnel": "vti-fiber1" },
      "desired": { "application": "Netflix", "tunnel": "vti-fiber2" },
      "origin": 2,
      "advisor_reason": "vti-fiber2 at 5.1 ms carries 1 app vs vti-fiber1 at 4.2 ms already carrying 3 — ~5 ms better once load is priced in.",
      "expected_gain_ms": 5.3,
      "freeze": false
    }
  ],
  "freezes": []
}
```

Apply this **exactly like 4.1**. `origin`, `advisor_reason` and
`expected_gain_ms` are provenance for logging/audit only.

### 4.3 Freeze (lock an application to its tunnel)

```json
{
  "timestamp_ms": 1784272715901,
  "source": "prpl",
  "gateway": "prpl-OSPv2-gateway",
  "type": "user_initiated",
  "changes": [],
  "freezes": [
    {
      "client_mac": "aa:bb:cc:00:00:05",
      "client_name": "dock-door",
      "application": "OT Telemetry",
      "freeze": true,
      "tunnel": "vti-cell2"
    }
  ]
}
```

Read as: *hold `OT Telemetry` on `vti-cell2` and reject steering for it until
released.*

### 4.4 Unfreeze (release the lock)

```json
{
  "timestamp_ms": 1784272740117,
  "source": "prpl",
  "gateway": "prpl-OSPv2-gateway",
  "type": "user_initiated",
  "changes": [],
  "freezes": [
    {
      "client_mac": "aa:bb:cc:00:00:05",
      "client_name": "dock-door",
      "application": "OT Telemetry",
      "freeze": false,
      "tunnel": "vti-cell2"
    }
  ]
}
```

---

## 5. Decoding notes

- **`changes` and `freezes` are independent.** A route change sends
  `freezes: []`; a freeze toggle sends `changes: []`. Handle each list on its
  own — never assume one implies the other. A future message may carry both.
- **Both booleans are always written**, including `false`. proto3 normally
  drops default values, which would make an unfreeze indistinguishable from
  "field not sent"; the encoder emits them explicitly. This is valid proto3
  (just non-canonical) and needs no special handling on your side.
- **Everything else follows normal proto3 defaults**: unset string → `""`,
  unset number → `0`, unset enum → `0` (`UNSPECIFIED`), unset submessage →
  all-defaults. Never treat "absent" as meaningful except where stated.
- **The schema is append-only.** Fields 6–8 and `ClientFreeze.tunnel` were
  added after the first draft. Keep unknown-field skipping on (generated
  decoders do this by default) and older/newer versions stay compatible.
- **`tunnel` strings match the ifnames from `<prefix>/ipsec/metrics` exactly**,
  so they can be used directly as a lookup key.

---

## 6. Suggested gateway behaviour

1. **Validate `desired.tunnel`** against the tunnels you actually have. Reject
   unknown or unreachable ifnames rather than applying blindly.
2. **Check `current` against reality.** If the client is not on
   `current.tunnel`, the dashboard's view was stale. Applying `desired` anyway
   is usually right; log the mismatch either way.
3. **Enforce freeze on your side.** The dashboard blocks moving a frozen client
   in its own UI, but that is a UI guard only — anything else publishing to
   this topic could still try. Keep a `(client, application) → {frozen, tunnel}`
   map and reject changes for a frozen pair. This is why `changes[].freeze` is
   always `false`: a change and a freeze never coexist for the same client
   *from the dashboard*.
4. **Treat `client_mac` as an opaque key.** It is a MAC for inventory-backed
   clients and a source IP for AAR-decision-backed ones.
5. **Be idempotent.** QoS 1 is at-least-once; the same command may arrive twice.
   Dedup on `(timestamp_ms, client_mac)` if it matters.

---

## 7. Open items

- **No ack topic yet.** Publishing `<prefix>/approute/control/result` with
  `{ id?, ok, error?, ts }` — same correlation pattern as
  `com.rdk.pathcontrol` uses on `<prefix>/path/control/result` — would let the
  dashboard show *applied* / *failed* instead of just *published*. Requested.
- **No gateway component subscribes to this topic yet**, so these messages
  currently publish into the void. The equivalent for path control is the
  `com.rdk.pathcontrol` Greengrass component; an `approute` counterpart is the
  missing piece.
- If the payload structure needs to change, say so and we will version it
  together — the dashboard side is one file
  (`src/proto/appRoute.ts`) plus this schema.
