# GW Operational Twin — Embeddable Widget

Portable export of the Gemtek OSPv2 3D operational digital twin. The widget
contains its complete procedural model and TR-181 simulator fallback, and can
overlay live AWS IoT DeviceInfo, Ethernet, Wi-Fi, and gateway-log data through
a same-origin SSE endpoint. It works in any web app
(React 18/19, Vite, CRA, Vue, plain HTML) via an iframe plus an optional
postMessage control API.

## Package contents

```
gw-twin-widget/
  app/                      built widget (static files, relative paths —
                            serve from any subpath)
  integration/
    GatewayTwinEmbed.tsx    typed React wrapper (React 18/19, no deps)
    GatewayTwinEmbed.jsx    plain-JSX React wrapper (CRA-friendly)
    gw-twin-embed.js        framework-agnostic ES-module loader
  twin-manifest.json        machine-readable descriptor: URL params,
                            postMessage protocol, scenarios, parts, TR-181 paths
  EMBED.md                  this file
```

Rebuild `app/` from the twin repo with `npm run build:embed`
(output: `export/gw-twin-widget/app/`).

## Install into a host app (2 steps)

1. Copy `app/` → `<host>/public/widgets/gw-twin/app/`
   (Vite and CRA both serve `public/` verbatim in dev and build.)
2. Copy the matching wrapper from `integration/` into the host's source tree
   and render it:

```tsx
import { useRef } from 'react'
import GatewayTwinEmbed, { type GatewayTwinHandle } from './GatewayTwinEmbed'

function GatewayPanel() {
  const twin = useRef<GatewayTwinHandle>(null)
  return (
    <div style={{ height: 600 }}>
      <GatewayTwinEmbed
        ref={twin}
        scenario="normal"
        nohud                 // hide the twin's own HUD inside a tile
        onState={(s) => console.log('CPU %', s.health.cpuPct)}
        onTwinEvent={(e) => console.log(e.severity, e.text)}
      />
      <button onClick={() => twin.current?.setScenario('overheat')}>
        Simulate overheat
      </button>
    </div>
  )
}
```

No React at all? Use the loader:

```html
<div id="twin" style="height: 600px"></div>
<script type="module">
  import GwTwinEmbed from './gw-twin-embed.js'
  const twin = new GwTwinEmbed(document.getElementById('twin'), { nohud: true })
  twin.on('event', (e) => console.log(e.text))
</script>
```

Or skip scripting entirely — everything is URL-drivable:

```html
<iframe src="/widgets/gw-twin/app/index.html?scenario=overheat&mode=xray&nohud=1"
        style="width:100%;height:600px;border:0"></iframe>
```

## Control API (postMessage)

Full schema in `twin-manifest.json`. Summary:

| Host → twin (`{ target: 'gw-twin', type, payload }`) | Effect |
|---|---|
| `set-scenario` `{ scenario }` | normal · boot · fwupdate · overheat · outage · cellular · voip |
| `set-explode` `{ value: 0..1 }` | exploded view |
| `set-mode` `{ mode }` | `solid` \| `xray` |
| `set-overlays` `{ rings?, hosts?, flow?, atmos? }` | RF rings, host constellation, port flow, atmosphere |
| `set-auto-rotate` `{ value }` / `set-hud` `{ hidden }` | stage behavior |
| `focus-part` `{ id }` | fly camera to a part (`mainboard`, `rfboard`, …) |
| `select-port` `{ port }` | open a rear-bay port (`lan1` … `fiveg`) |
| `get-state` | request an immediate `state` reply |

| Twin → host (`{ source: 'gw-twin', type, payload }`) | When |
|---|---|
| `ready` — scenarios + parts lists | once, after boot |
| `state` — scenario, LED, health, temps, optics, ports | every 2 s + on change |
| `event` — severity-coded feed entry | per event |

## Notes

- This build calls `/api/gateway-logs/stream` for live telemetry and logs. A
  host must implement the SSE contract or pass `live: false` (`?live=0`) to use
  the simulator baseline without opening the stream.
- Live fields override only the values actually received. Unreported domains
  continue to use the simulator, so the twin remains complete during outages.
- Needs WebGL2. On weak/software GL hosts add `lite: true` (`?lite=1`).
- postMessage pins to the parent referrer's origin when available; hosts should
  still serve the widget same-origin and restrict framing to trusted pages.
- Trademarks: device branding derives from public FCC exhibits; genericize
  before wider distribution (see the twin repo's README).
