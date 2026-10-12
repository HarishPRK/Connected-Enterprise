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

## First paint and initial layout

A follow-up production audit reported a 644 ms text LCP, including 545 ms of render delay, and a 134.8 ms task with 41 ms of layout. The existing Google Fonts query already specified `display=swap`; adding it again would not remove the CSS import's request chain.

- Space Grotesk and JetBrains Mono now use the exact, licensed Latin WOFF2 files served from the application. The body/subtitle face is preloaded, both families retain swap, and their original weight declarations and fallbacks are preserved. The files total 53,720 bytes; sources, hashes and licenses are in `public/fonts`.
- React, JSX runtime and scheduler have explicit chunk ownership. Geography and shared D3 utilities are separate from Recharts. The app entry no longer preloads or evaluates the chart bundle, and the static chunk graph has no execution cycles.
- Initial Home visits resolve their route component before the first React commit. This avoids a loading-fallback commit and its Suspense retry delay; other entry routes retain lazy loading. The route wrapper no longer hides text for an entrance animation. Card entry motion retains translation without scaling the dimensions responsive charts measure.
- The bandwidth card, history state and range controls remain present with the existing 260/240 px plot reservation. Its Recharts plot loads on first viewport intersection and then stays mounted. This keeps below-fold chart DOM measurements out of the initial Home render while preserving chart interaction after scrolling.

The full stylesheet remains an early stylesheet link so the app receives correct theme, grid and responsive styles before painting. This change removes the font import chain and chart/startup rendering work instead of introducing a second, manually maintained critical-CSS override. Production references and their startup measurements are retained under `outputs/startup-performance`; instrumentation is excluded from the released application.

Three runs of each production reference used the same browser viewport and read-only production API proxy. Median LCP decreased from 452 ms to 196 ms; rounded CLS stayed at 0.00. Median FCP changed from 108 ms (the loading shell) to 196 ms (the resolved Home page). Observed maximum startup tasks were 69 ms before and 70 ms after, so this sample does not establish a reduction in the worst long task. It confirms that chart code is absent before scrolling and that the loading-fallback render delay is removed. These local measurements are not directly comparable to the supplied public-host audit or a cold-cache Lighthouse run.
