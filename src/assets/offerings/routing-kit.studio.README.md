# Routing workstation kit

Blender-authored standing office furniture and small business communication
hardware for the Teams briefing, surveillance upload and VoIP routing stories.
The store's existing architecture and other scenarios are unchanged.

## Load and placement

Load `routing-kit.studio.glb` at identity transform and unit scale. The asset is
already in Connected Enterprise world coordinates, metres, +Y up and +Z fronts.
Hide the existing architecture group **CheckoutFixtures** only while routing is
active. Both original checkout counters and their fixed POS/conveyor geometry are
material-merged inside that group; there are no Counter_A or Counter_B nodes.

The Teams standing desk is 1.50 x 0.84 m at [8, 0, 4.5]; the phone counter is
1.40 x 0.70 m at [8, 0, 7]. Both work surfaces are 1.10 m above the floor. Existing
pendants remain overhead. Equipment rubber feet contact the actual desktop.

## Runtime surfaces

| Mesh | Centre | Width x height | Front |
| --- | --- | --- | --- |
| TeamsMonitorScreen | [8, 1.50, 4.511] | 0.60 x 0.3375 m | +Z |
| VoipPhoneScreen | [8.025, 1.238, 6.9525] | 0.145 x 0.076 m | +Z |

Both surfaces have full 0–1 UVs and independent materials. Hide each surface and
render its runtime canvas plane 0.5 mm toward +Z, or replace its existing material
map. Avoid drawing a second coplanar surface. Screens are upright, without tilt.

The webcam and monitor are one `TeamsWorkstation` device group. The handset is
independent `VoipHandset`, with pivot [7.912, 1.190, 7.0]. No pickup animation is
baked in. The phone is 270 x 220 mm and the speakerphone has a 128 mm diameter.
The speakerphone call touch key is [8.42, 1.1394, 7.041], with top normal +Y.

Independent lighting nodes are `WebcamStatusLED`, `MonitorStatusLED`,
`VoipStatusLED` and `SpeakerphoneStatusRing`. Each has an independently named
`Routing / <node name>` material. Full bounds and node positions are in the
manifest. Clone materials before changing per-instance state.

## Authoring

Source: `scripts/blender/routing_kit.py`; editable scene:
`scripts/blender/routing-kit.studio.blend`. Run with Blender 4.5 or later:

```text
blender -b --factory-startup --python-exit-code 1 --python scripts/blender/routing_kit.py
```

The script exports only the workstation kit, then imports the unchanged store
for three proof renders. Its studio materials follow the existing warm mineral,
honey oak, spruce enamel, graphite and terracotta design language. No downloaded
models, branded device replicas, third-party textures, embedded lighting or
camera objects are included in the GLB. All geometry was authored here in bpy.
