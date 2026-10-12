# Dashboard timer and animation performance

The recurring Chrome `setInterval` and `requestAnimationFrame` violation messages came with unnecessary React and map work. The fix reduces that work rather than suppressing console messages.

- Projected atlas polygons are cached across telemetry and hover updates. Detailed device glyphs, KPI series and the bandwidth plot are isolated from unrelated status changes.
- Device consumers share one snapshot request and EventSource. Telemetry deliveries notify consumers in a bounded 32 ms batch while every accepted packet still contributes to rate calculations.
- Home subscribes to the selected IPsec topics and LAN observations. Unrelated telemetry and a one-second freshness loop no longer redraw the whole page. Fresh/stale and clock-skew transitions use boundary timers.
- Real branch KPIs do not start simulated four/five-second metric timers. Header status and incident triggers have separate subscriptions.
- Numeric animation updates its visual text node without a React state update on every frame. The accessible value remains current, and hidden/reduced-motion pages stop the animation.
- Toast notifications retain a stable context; relative-time formatting is cached. Hidden pages suspend avoidable work and update on return.
- Bandwidth and device dashboard charts use Recharts' native responsive sizing, avoiding the initial negative-size container warning while retaining their existing plot heights.
- Late HTTP snapshots cannot replace newer SSE observations, including equal-timestamp ties. Refresh applies before its promise resolves. Home does not display McKinney LAN measurements for another branch.

## Measurement and validation

Two isolated local development references used the same production read-only telemetry proxy, a 10-second warm-up and a 45-second measurement window. The baseline was commit `7d3ac85`; the optimized reference contained the rendering/subscription changes. Browser long tasks decreased from 182 to 5, animation callbacks from 320 to 10, and interval callbacks from 124 to 60. No measured timer or animation callback exceeded 50 ms in the optimized window. This is a local comparison, not a guarantee that no browser on any hardware can ever report a long task.

The map geometry microbenchmark generated 56 polygons (216,377 path characters). Repeating generation had a median cost of 24.29 ms; cached reads had a median cost of 0.0018 ms.

Production TypeScript/build and 91 UI tests pass. The tests cover shared connection lifecycle, per-topic batching, packet-rate preservation, freshness boundaries, stale/equal-timestamp hydration, manual refresh, visibility handling and simulated subscriber isolation. Changed-code lint introduces no new findings. Existing mixed provider/hook lint findings remain outside this performance change.

Measurement instrumentation lives only in the local `outputs/performance-warnings` references; it is excluded from the committed application and EC2 build. The release retains production environment files and existing runtime state.
