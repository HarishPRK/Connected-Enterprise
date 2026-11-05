# Cinematic network hardware

## Gateway

`gemtek-gateway.glb` is the actual **Gemtek WGRTD-159BE-B OSPv2** model from
https://studio.connectedenterprise.app/, exported November 5, 2026. This replaces
the older local BGW620 model in the offerings scene. The export retains the
source enclosure, vented crown, rear sockets, circuit boards and antenna carrier.

The read-only export harness is in `outputs/cinematic-hardware-export/`:
`build-gemtek-exporter.cjs` and `export-gemtek.cjs`. It captures the assembled
model from the public studio, names inspectable groups, removes story overlays,
indexes vertices and exports embedded textures with Three's GLTFExporter.
Run `python scripts/blender/dedupe_gateway_glb.py` after exporting to losslessly
share duplicate buffers and materials: 15.50 MB becomes 10.55 MB. No runtime
CDN, mesh decoder, or texture decoder is required.

`gemtek-gateway.manifest.json` preserves the exact source bounds after its root
X scale of 1.64/1.83. The original rear-facing axis is +X, with +Y up. Cable
anchors use those actual socket centers followed by the same normalization,
size and yaw as the model. The socket frame remains fixed during explosion;
antenna links follow their carrier. The separate inspection mode offers an
unrestricted azimuth and wide vertical orbit, with independent camera framing
for assembled and exploded models.

## Analytics appliance

`analytics-server.glb` is an original **illustrative Dell-style edge server**,
not a dimensionally accurate model of a particular Dell SKU. It includes drive
carriers, latch hardware, vent perforations, activity indicators, and three
modeled NIC recesses: Camera A, Camera B and LAN uplink.

Rebuild with Blender 4.5:

```powershell
blender -b --factory-startup --python-exit-code 1 --python scripts/blender/offerings_analytics.py
```

`analytics-server.manifest.json` contains model bounds and socket positions in
glTF coordinates (+Y up, +Z front). Camera traffic travels toward this server;
its LAN connection reaches the shared CPE. The existing IT rack is a separate
network asset. All story activity remains illustrative, not measured telemetry.

## Lighting asset

`studio-small-03-1k.hdr` — **Studio Small 03**, Greg Zaal / Poly Haven, **CC0**.
Source: https://polyhaven.com/a/studio_small_03
File: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_03_1k.hdr
MD5 from the provider API: `74e6ef69ea9024c2cc25b3a7de8ec2f7`.
The 1K texture is bundled locally rather than fetched from a CDN at runtime.

## Rendering contract

`OfferingCinematicCanvas.tsx` owns Canvas setup, shared GLB preloading and cloned
physical material overrides, local HDR IBL, neutral key/cool fill/rim lighting and soft PCSS shadows, and
exactly four effects: Bloom, DepthOfField, Vignette, ACES ToneMapping. Shading
uses Three's linear working space; sRGB is applied at display output. The
composer temporarily disables renderer tone mapping to prevent double ACES.
Exposure is 1.15. The current postprocessing API expresses focus distance and
range in world units; shot-aware focus keeps radio links and packets readable.

Animation follows the existing absolute story clock and pauses with reduced
motion or a hidden viewport. Render density targets 1.5–2 physical pixels per
display pixel, compensates for application CSS zoom, and respects a 4K pixel
budget. Postprocessing uses 4x MSAA on both layouts. DOF runs at full resolution
only for close shots; wide shots stay sharp. Mobile shadows use 2048 maps.

## Operator diagnostic story

The Digital Twin sequence uses an illustrative LAN 1 link-flap fault. A service
cart laptop displays a live render of the same Gemtek model beside its interface
log. The selected socket is highlighted in both views. The operator walks around
the cart, checks that physical port, reseats its plug, and returns to the laptop
after link-stability and checkout-reachability verification. Only the laptop's
virtual model separates in the exploded variant; the physical gateway remains
assembled. The separate 360-degree inspector still supports both configurations.
All movements, log states and cable geometry derive from absolute story time so
pause, replay and reverse scrubbing remain deterministic. No device command or
live repair is performed.
