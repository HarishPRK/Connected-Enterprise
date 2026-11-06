# Application traffic routing: client placement

The offerings sequence illustrates the existing application steering patchboard in a store. It runs for 20 seconds (24 internal story units), uses five sample clients and four online IPsec tunnels, and sends no live routing commands. It replaces the earlier checkout/payment story. Dynamic Failover is a separate, unchanged offering.

## Scenarios

| Variant | Client/application | Initial binding | Selected binding | Physical action |
| --- | --- | --- | --- | --- |
| `teams` | front-desk / Microsoft Teams | vti-cell1 | vti-fiber1 | A colleague pauses a choppy briefing, then rejoins with a new illustrated connection. |
| `archive` | back-office / Surveillance | vti-fiber1 | vti-fiber2 | A colleague selects recorded footage; the next segment advances while local recording continues. |
| `voice` | meeting-room / VoIP | vti-cell2, initially locked | vti-fiber2 | The operator releases the client lock before selection; the colleague places a new call afterward. |

The kitchen-pos / POS Payments and dock-door / OT Telemetry clients remain locked. All nonselected clients retain their bindings. No physical cable is replugged, uplink is failed, in-flight session is migrated, payment is attempted, or bandwidth cap is applied.

## Timeline and evidence

The voice variant demonstrates a blocked selection at 6, then releases that client's lock at 7. The route preview begins at 9, publication is requested at 11, and broker acceptance appears at 12. The illustrative new flow begins at 14 and its visible business activity at 17. The sampler is the timing authority if these values change.

Broker acceptance remains distinct from gateway application throughout the outcome. Status copy keeps gateway evidence pending. Subsequent packet placement, video quality, upload progress and call activity are explicitly illustrative. A fresh independent AAR route observation would be evidence of an observed binding, but it is not currently correlated to this command.

## Current implementation boundaries

- `src/components/widgets/AppSteeringPatchboard.tsx`: its exact front-desk, back-office, meeting-room, kitchen-pos and dock-door definitions are sample clients. Inventory-backed names for applications are assigned examples; they are not evidence of application identification. AAR-backed clients instead use source/destination IP information.
- The patchboard updates a local desired binding optimistically. Simulated clients or tunnels produce an encoded preview without publication. Live publication requires a recognized branch source and nonsimulated client/tunnel data. A broker failure rolls back the optimistic override.
- Manual drag, click, keyboard and advisor Apply all respect the per-client UI freeze. Locked clients are excluded from advisor candidates but still contribute to its modeled tunnel load. Gateway-side freeze enforcement is a suggested contract, not implemented enforcement in this repository.
- `proto/app_route.proto` and `proto/APPROUTE_PAYLOAD.md`: a user-initiated `AppRouteCommand` carries current/desired bindings and optional freeze changes. The client identifier can be a MAC address or an AAR source IP.
- `server/index.ts` and `server/ipsecSource.ts`: `/api/approute/publish` relays binary proto3 to `<source>/approute/control` with MQTT QoS1. HTTP 200 means broker acceptance only. The repository documents no corresponding gateway subscriber or result/acknowledgement topic. There is no durable route-command queue exposed here.
- `src/ui/useAarRouting.ts` and `proto/aar.proto`: independent `routing/decision` telemetry reports source IP, destination IP, tunnel and latencies, without a command ID. The UI associates the unprefixed AAR feed with the prpl/McKinney branch. It must not present independent telemetry as a command acknowledgement.
- The advisor compares reported latency with a simple modeled load penalty (`latency_ms + 2 * application weight`). Its predicted benefit is not a measured throughput improvement. Applying a suggestion remains an operator action.
- `server/routingConfigRoutes.ts`: policy and threshold edits persist branch configuration as JSON. This does not establish deployed bandwidth shaping, application identification or automated gateway policy enforcement.

Reviewed against repository source on 2026-11-05. No device mutation requests were sent during this review.
