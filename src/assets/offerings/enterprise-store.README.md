# Unified enterprise store

An original Blender-authored retail cutaway for showing all seven SME offerings
in one shared physical location. It borrows architectural detailing principles
from the Smart Factory reference—exposed bracing, service trays, manufactured
fixtures and material variation—without copying its plant or machine models.

## Files

- `enterprise-store.glb`: architecture and fixed retail fixtures, 2.95 MB,
  60,304 triangles, 69 meshes, one embedded original oak-grain texture and no
  decoder or network dependencies.
- `enterprise-store.manifest.json`: group names, bounds and equipment anchors.
- `enterprise-store-proof.png`: transparent studio proof with optional equipment
  from the existing offerings kit, included only in the proof.
- Source: `scripts/blender/enterprise_store.py`.

## Placement contract

Load the `EnterpriseStore` root at identity. All design coordinates are glTF /
Three.js: +Y up and the front entrance faces +Z. The interior is 26 × 20 meters;
the continuous paved site extends to 32 × 24 meters. Floor surfaces sit at Y=0;
the architectural slab extends below that plane to -0.32. There is no roof over
the main floor and no equipment pedestals.

The interior tile finish is warm slate `#343d40`, with a restrained second tone.
Tile, subfloor and foundation faces have separate heights to avoid self-shadowing.
Do not add another scene floor at Y=0; a shadow catcher belongs below Y=-0.32.

The material polish adds a small, original 192 × 512 oak map with UVs following
the manufactured panel faces. It is packed into the GLB. Dark steel shelf-ticket
channels, separate paper labels and print, satin bottle closures, carton folds,
counter-corner trims and distinct payment/service fascia signs provide close-view
detail. Paper-ticket and carton micro-bevels are omitted to keep the asset below
3 MB. Geometry and shadows establish the detail; the source contains no baked
lighting, ambient-occlusion overlay or copied photographic texture.

The building contains no CPE, router, rack, HVAC unit, cooler, solar panel,
camera, person or sensor. These are composed and controlled in React Three Fiber
using `offerings-kit.glb`, so changing an offering can highlight and animate the
same shared devices without replacing the store.

| Placement | X | Y | Z |
|---|---:|---:|---:|
| CPE on network workbench | 7 | 1.10 | -3 |
| IT rack | 10 | 0 | -6 |
| HVAC | -9 | 0 | -6 |
| Cooler | 0 | 0 | -7.5 |
| Exterior fiber terminal | 14.5 | 0 | -6 |
| Exterior 5G tower | 14.5 | 0 | 2 |
| Exterior solar zone | -15 | 0 | -6 |
| Automation wall center | -10 | 1.5 | -1.49 |
| Customer path | 1 | 0 | 6 |
| Entrance | 1 | 0 | 9.86 |
| Checkout 1 countertop | 8 | 1.15 | 4.5 |
| Checkout 2 countertop | 8 | 1.15 | 7 |

Automation devices face +Z. The wall front plane is Z=-1.49; put the device back
surface just in front of it (for example thermostat root Z=-1.35). The three
stocked gondolas are centered at X=-6,-1,4 and span Z=-1.43..3.43, leaving the
front customer path at Z=6 open. The checkout architectural fixtures include
blank POS displays and terminal stands; these are not live monitoring devices.

## Preserved groups

The root contains ten named children, each joined by material for efficient
rendering:

- `FloorShell`: limestone modules, charcoal pavement, entry mat and joints.
- `RearElevation`: mineral plaster, steel framing, clerestory glazing, retail signage.
- `CutawayWalls`: lowered side walls and network closet partition.
- `Storefront`: partial glazing, entry portal, oak fascia and threshold.
- `RetailAisles`: three double-sided stocked gondolas with bottles, cartons and labels.
- `CheckoutFixtures`: oak millwork, stone tops, belts, terminal mounts and bagging shelves.
- `ServiceArchitecture`: network workbench, automation wallboard, conduit and cable trays.
- `LightingRig`: open rear truss, bracing, suspended diffusers and side lights.
- `Planting`: original lightweight foliage in tapered mineral planters.
- `Wayfinding`: entry welcome sign and floor inlays.

All child groups have identity transforms. Window glass is the only alpha-blended
material. Lighting diffusers use standard emissive PBR materials; real studio
lighting or an environment must be supplied by the application.

The measured root bounds are `[-16, -0.32, -12]` to `[16, 5.105, 12]`.
The refinement keeps every fixture position, counter height, entry opening and
walking clearance unchanged from the first unified-store asset.

## Rebuild

From the repository root, using Blender 4.5:

```powershell
& 'C:/path/to/blender.exe' -b --factory-startup --python-exit-code 1 --python 'scripts/blender/enterprise_store.py'
```

An optional directory follows `--`. The GLB is exported before optional proof
equipment, camera or lights are added. The render uses 40 denoised Cycles samples
at 1800 × 1400; it does not affect the runtime GLB.
