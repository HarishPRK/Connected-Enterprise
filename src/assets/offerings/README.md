# SME offerings equipment kit

Original procedural Blender models for the local Challenges / Offerings experience.
All geometry is authored by `scripts/blender/offerings_kit.py`; no external model,
texture, HDRI, or font download is needed. The equipment is illustrative rather
than a representation of a specific manufacturer's hardware.

- `offerings-kit.glb`: 18 reusable prefabs, 2.24 MB uncompressed, 75,380 triangles,
  129 meshes and 15 shared PBR materials. No Draco decoder is required.
- `offerings-kit.manifest.json`: exact local bounds, mesh/triangle counts and groups.
- `offerings-kit-proof.png`: Blender Cycles contact sheet of the exported geometry.

## Coordinate contract

The GLB contains **overlapping prefab roots**, not a complete presentation scene.
Clone the required named root, place it in the React Three Fiber scene, and hide
the loaded source scene. All roots have identity transforms at `(0, 0, 0)`.

- glTF coordinates: `+Y` up, front faces `+Z`.
- Minimum Y is exactly zero for every prefab, so scene objects sit on a common floor.
- X/Z extents are nearly centered but need not be symmetric: handles, connectors
  and camera lenses deliberately project forward.
- Bounds below are width X / height Y / depth Z, in illustrative meters.
- Shared geometry/materials can be reused across clones. Clone materials only
  when changing a single instance's finish; don't dispose a shared loaded asset.
- The GLB does not include the contact-sheet floor, labels, lights or camera.

| Root name | Width | Height | Depth |
|---|---:|---:|---:|
| Gateway | 1.860 | 1.410 | 1.102 |
| FiberTerminal | 0.861 | 1.120 | 0.715 |
| CellularTower | 0.900 | 2.165 | 0.900 |
| Cloud | 1.680 | 1.100 | 0.728 |
| ServerRack | 1.061 | 1.820 | 0.988 |
| Laptop | 1.230 | 0.877 | 0.880 |
| Sensor | 0.500 | 0.720 | 0.439 |
| Lock | 0.585 | 1.280 | 0.365 |
| Thermostat | 0.720 | 0.720 | 0.223 |
| Light | 0.460 | 1.350 | 0.460 |
| HVAC | 1.373 | 1.230 | 0.951 |
| Cooler | 1.290 | 2.000 | 0.943 |
| Meter | 0.720 | 1.060 | 0.371 |
| Camera | 0.500 | 0.775 | 0.926 |
| Person | 0.664 | 1.695 | 0.275 |
| FallenPerson | 1.695 | 0.275 | 0.664 |
| SolarPanel | 1.540 | 1.242 | 0.740 |
| DeskPhone | 1.166 | 0.503 | 0.820 |

## Gateway twin

The `Gateway` root has five direct child groups. Animate these groups along +Y
for an exploded view; their child meshes are baked in the common gateway origin.
Restore their original transforms before returning to an assembled view.

1. `GatewayHousing`: mounting plate, machined front face, shell and screws.
2. `GatewayBoard`: internal green PCB, chip packages and spreader.
3. `GatewayHeatsink`: aluminum lid and 20 cooling fins.
4. `GatewayPorts`: four ethernet sockets, brass contacts, status lights and USB.
5. `GatewayAntennae`: pair of antennas with nickel collars and inset details.

The `SolarPanel` also contains a `SolarArray` group, which holds the already
tilted panel, separate from its rear support. Retain its initial transform.

## Physical service articulation

The assembled dimensions and root transforms remain unchanged. These groups have
real local pivots so the same equipment can animate in place:

| Group | Parent | Pivot X / Y / Z | Motion |
|---|---|---|---|
| HVACFan | HVAC | -.180 / .710 / .478 | Rotate local Z; fixed grille stays still |
| CoolerLeftDoor | Cooler | -.578 / .260 / .450 | Local Y from 0 to -1.05 radians |
| CoolerRightDoor | Cooler | .578 / .260 / .450 | Local Y from 0 to +1.05 radians |

Each cooler door includes its glass, frame and handle. The doors export closed;
animate rotations from absolute story time and restore zero for the closed state.
The fan mesh is behind the static grille, so a slowed or stopped fan remains a
physical change to the same HVAC unit.

## Materials and lighting

Graphite powder coat, bead-blasted aluminum, brushed titanium, warm ceramic,
rubber gaskets and sky-blue status lamps use standard glTF metallic/roughness
materials. Add a studio environment or broad soft lights in the application so
the metallic edges have useful reflections. Avoid a strong blue light on every
surface, which loses the material distinction.

Only the cooler glazing is alpha blended. Its recessed interior, product rows,
door frames, handles and shelf edges remain real geometry. HVAC fan blades sit
behind a geometric grille; the tower has triangular bracing; the rack has drive
caddies and ethernet sockets. Neutral mannequin models are used for video
scenarios without skin, identity or biometric attributes.

## Rebuild

Using Blender 4.5 from the repository root:

```powershell
& 'C:/path/to/blender.exe' -b --factory-startup --python-exit-code 1 --python 'scripts/blender/offerings_kit.py'
```

Append `-- 'C:/output/directory'` to send all outputs to a different directory.
The script exports the origin-centered GLB before moving objects into the proof
layout. The proof uses 40-sample denoised Cycles rendering at 1600 × 1500.
