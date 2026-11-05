# Enterprise retail actors and story props

Original Blender-authored characters for the shared SME store. The four actors
use clothed human silhouettes, skin, hair, restrained faces and role-specific
accessories. They use rigid semantic joints with zero rest rotations, so stories
can pose them deterministically from the application's absolute timeline.

- `enterprise-actors.glb`: 974,616 bytes, 49,380 triangles, 209 meshes across all
  four actors and six props. No textures, armature, Draco or external dependencies.
- `enterprise-actors.manifest.json`: exact bounds, joint names and world pivots.
- `enterprise-actors-proof.png`: studio preview; display poses are not baked into GLB.
- Source: `scripts/blender/enterprise_actors.py`.

## Actor roots

`Customer`, `Staff`, `Technician`, and `Security` are independent roots at identity.
Coordinates are meters, +Y up, +Z forward. All four stand exactly 1.75 m tall, with
feet at Y=0. They share anatomical proportions and the same joint API.

| Root | Appearance | Width / height / depth |
|---|---|---|
| Customer | Tan casual jacket, jeans, light sneakers | .672 / 1.750 / .310 |
| Staff | Navy work shirt, slacks, ID, radio and held tablet | .706 / 1.750 / .310 |
| Technician | Teal service clothing, cargo pocket, knee patches, tablet and tool case | .930 / 1.750 / .310 |
| Security | Sober navy uniform, ID, badge and radio | .672 / 1.750 / .310 |

Clone roots without recentering them from a bounding box: held accessories make
the bounds asymmetric. Use uniform scale on the root if needed. Cached mesh and
material resources can be shared; clone a material only when recoloring a single
actor. Skin materials have zero emissive contribution.

## Joint API

Every joint is prefixed by its role, for example `Customer_LeftForearm` and
`Staff_Hips`. The hierarchy is:

```text
Role
  Role_ActorRoot
    Role_Hips
      Role_Torso
        Role_Head
        Role_LeftUpperArm
          Role_LeftForearm
            Role_TabletMount
              Role_Tablet
        Role_RightUpperArm
          Role_RightForearm
            Role_BagMount
      Role_LeftThigh
        Role_LeftShin
          Role_LeftAnkle
      Role_RightThigh
        Role_RightShin
          Role_RightAnkle
```

`Tablet` contains geometry for Staff and Technician; it is an empty optional
joint for Customer and Security. Technician's tool case is under `BagMount`.
The same complete joint tree exists on all four actors to simplify runtime code.

All 68 joint rest rotations are identity and all scales are one. Zeroing joint
rotations each frame is safe. Preserve the original local positions when adding
hip offsets, crouching or whole-body movement. Useful rest values:

| Joint | World pivot X / Y / Z | Local translation |
|---|---|---|
| Hips | 0 / .900 / 0 | 0 / .900 / 0 |
| Torso | 0 / 1.000 / 0 | 0 / .100 / 0 |
| Head | 0 / 1.490 / 0 | 0 / .490 / 0 |
| LeftUpperArm | -.235 / 1.380 / 0 | -.235 / .380 / 0 |
| LeftForearm | -.265 / 1.115 / 0 | -.030 / -.265 / 0 |
| LeftThigh | -.095 / .890 / 0 | -.095 / -.010 / 0 |
| LeftShin | -.095 / .470 / 0 | 0 / -.420 / 0 |
| LeftAnkle | -.095 / .075 / .055 | 0 / -.395 / .055 |
| TabletMount | -.265 / .790 / .090 | 0 / -.325 / .090 |
| Tablet | -.265 / .790 / .090 | 0 / 0 / 0 |

Right limb pivots mirror the X component. `ActorRoot` is at the feet and can own
whole-body falls or leaning. The role root can own world movement and heading.

Animation directions in Three.js:

- Negative arm/forearm `rotation.x` raises the hand forward toward +Z.
- Positive knee `rotation.x` bends the lower leg backward.
- Counter-rotate each ankle against its thigh+shin X rotation to keep shoes level.
- A useful tablet-reading pose is upper-arm X=-.30, forearm X=-1.12. The proof
  shows this pose with the tablet directly above the hand.
- Walking, reaching, kneeling and falling are runtime poses; no delta accumulation
  or baked animation is required. Apply a pose directly from the shared clock so
  pause/resume and seeking remain deterministic.

## Props

Every prop root is at identity with minimum Y=0; front faces +Z.

| Root | Width / height / depth | Interaction group |
|---|---|---|
| PaymentTerminal | .270 / .435 / .250 | `PaymentTerminal_Display`, `PaymentTerminal_TapZone` |
| ReceiptPrinter | .360 / .482 / .300 | `ReceiptPrinter_Receipt` |
| ShoppingBasket | .475 / .522 / .345 | `ShoppingBasket_Grip` |
| Tablet | .210 / .300 / .041 | `Tablet_Body` |
| Toolbox | .360 / .342 / .248 | `Toolbox_Body` |
| AlertBeacon | .240 / .260 / .240 | `AlertBeacon_Lens` |

The receipt pivot is at the printer outlet `(0,.222,.124)`. Its geometry extends
.26 m upward, so local `scale.y=0..1` reveals the paper from the outlet without
moving the printer. The printer's height without paper is about .244 m.

The basket grip is `(0,.51,0)`; attach a basket under a hand using an inverse grip
offset, rather than placing its floor origin at the wrist. The beacon's colored
lens is a separate group at `(0,.16,0)` and can be pulsed by its material or scale.

## Rebuild

```powershell
& 'C:/path/to/blender.exe' -b --factory-startup --python-exit-code 1 --python 'scripts/blender/enterprise_actors.py'
```

An optional output directory follows `--`. Neutral assets are exported before
studio poses, floor, camera or lights are added. The proof uses 40 denoised Cycles
samples at 1800 × 1200.
