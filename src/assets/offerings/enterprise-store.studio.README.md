# Enterprise store — Smart Kitchen visual family

This is the enterprise store with the material language used by Smart Kitchen:
charcoal terrazzo, cream walls, spruce glazed ceramic, honey oak, terracotta and satin bronze.
It remains a retail enterprise, with the same shelves, checkout counters,
network bench, equipment locations and open customer paths.

- `enterprise-store.studio.glb`: 3,998,452 bytes, 98,096 triangles, 74 meshes.
- `enterprise-store.studio.manifest.json`: bounds, preserved groups and equipment anchors.
- `enterprise-store.studio-proof.png`: Blender Cycles proof of the actual export.
- Authoring source: `scripts/blender/enterprise_store.py -- <output-directory> --studio`.
- Source surfaces: `scripts/blender/studio-surfaces/`.

The three packed JPEG maps are the original generated Smart Kitchen terrazzo,
oak and ceramic tile artwork from Project_QSR's `design/restaurant-studio/art`.
No remote texture service or sibling project is needed to regenerate or view it.
The three surface images total 85,815 bytes before GLB packaging.
The floor uses a dark graphite tint multiplied over the original terrazzo map;
the tint is exported as a glTF base-color factor so the browser and Blender
retain the same finish. The two floor tones preserve subtle aggregate variation.
The mineral floor and perimeter paving use roughness 0.9, no metallic response,
and `KHR_materials_specular` factor 0.14. This matte finish prevents the studio
environment from washing the charcoal floor into pale gray at grazing angles.
The main terrazzo's linear color factor is `[0.012, 0.016, 0.018, 1]`.

The edition adds two-segment manufactured bevels, fluted oak checkout battens,
bronze worktop and foot reveals, ceramic and timber wall finishes, terracotta
planters and two clay pendant lamps. The pendant supports sit at the perimeter;
the lamps remain above the occupied floor. Their diffusers belong to the existing
`LightingRig` group, so the application's automation dimmer controls them.

All 10 architectural group names, equipment anchors, site bounds and floor
heights match the original asset exactly. No equipment or people are baked into
the exported architecture. The original `enterprise-store.glb` is retained.

Build with Blender 4.5:

```sh
blender -b --factory-startup --python-exit-code 1 --python scripts/blender/enterprise_store.py -- src/assets/offerings --studio
```

Omit `--studio` to regenerate the original finish family and original filenames.
