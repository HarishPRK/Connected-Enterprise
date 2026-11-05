# Connected Enterprise anatomical cast

This is the same fitted, textured human library used by Smart Kitchen, retargeted
to Connected Enterprise's existing story coordinates and semantic joint API.
It replaces the earlier rigid body-part people. It does not change the store,
scenario timings, customer paths, equipment anchors or business responses.

## Inputs and provenance

`library/fitted_cast.npz` contains the anatomical meshes, garment meshes, UV
loops and four skin weights per vertex. The adjacent JPEG/PNG files contain the
same complexion, clothing, footwear, eyes and hair maps as Smart Kitchen. These
inputs are included here: rebuilding does not require Project_QSR or a download.

The source base mesh, fitted clothing, hair, eyebrows, eyelashes, eyes, skin
artwork and original skin weights are from the MakeHuman system library,
released under CC0 1.0 Universal by Data Collection AB, Joel Palmius, Jonas
Hauquier and the MakeHuman contributors. The license is [CC0.txt](CC0.txt).
[Pinned upstream license](https://github.com/makehumancommunity/makehuman/blob/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/LICENSE.md)
and [system asset catalog](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html).

The initial reduced rig fitting and wardrobe preparation come from
`Project_QSR/design/restaurant-studio/people/prepare_library.py`. CE's bind-space
retarget, short-sleeve coverage, shoulder fit, semantic skin-joint mapping,
tablet contact calibration and runtime clone adapter are authored for this app.
There are no restaurant apron, restaurant cap or food props in this cast.

## Rebuild and inspect

From the repository root, with Python, NumPy and Pillow:

```sh
python scripts/blender/enterprise_people/build_cast.py
```

Then use Blender 4.5 LTS to import the actual exported GLB, save the packed,
editable armatures/materials, and render the proof:

```sh
blender -b --factory-startup --python-exit-code 1 --python scripts/blender/enterprise_people/proof.py
```

Outputs:

- `src/assets/offerings/enterprise-actors.studio.glb` — 7.99 MB, 28 anatomical
  skin meshes plus the preserved enterprise props. Textures are embedded.
- `src/assets/offerings/enterprise-actors.studio.manifest.json` — measured bounds,
  triangle counts, roles, semantic skin-joint names, anatomical finger centre
  lines and sampled thumb/index pad contact coordinates.
- `src/assets/offerings/enterprise-actors.studio-proof.png` — Blender Cycles proof.
- `scripts/blender/enterprise_people/enterprise-cast.blend` — packed Blender scene.

The original `enterprise-actors.glb` remains unchanged as the base prop library
and placement contract. `build_cast.py` removes its rigid actor surfaces from
the scene and attaches the anatomical meshes as genuine glTF skins. Existing
joint translations are retained exactly. Two hand joints per actor add wrist
pronation independently of elbow rotation. Staff and technicians support the
tablet with a supinated palm; the tablet underside is calibrated to that palm.

Each actor also has 30 genuine finger joints: left/right thumb, index, middle,
ring and little fingers, each with `Proximal`, `Intermediate`, and `Distal`
phalanges. Names use the existing `Role_RightIndexDistal` convention. Bind
rotations are identity in CE axes, with the original anatomical mesh and UVs.
The 1,552 vertices in each hand are assigned by nearest anatomical phalanx
centre line, with continuous knuckle blends and retained wrist influence in
the webbing. No hand bounding-box bins or replacement finger shapes are used.

The manifest's `hands.Right/Left.chains` and `pads` are in wrist-local CE metres.
`Role_RightThumbPad` and `Role_RightIndexPad` nodes sit on actual distal skin
vertices. The wrist-local pinch centre is right `[-.021,-.079,.0295]` or left
`[.021,-.079,.0295]`. This small adjustment to Smart Kitchen's morph contact
keeps the thumb within its rigid link lengths, so the pinch needs no stretching.

Inspect the actual exported skin at card scale:

```sh
blender -b --factory-startup --python-exit-code 1 --python scripts/blender/enterprise_people/proof_hands.py
```

This checks all bind matrices and 70,022 skinned vertices, solves the three-link
sheet grip on both hands for every role, and renders the actual deformed GLB
with a standard-size card. Outputs are `enterprise-actors.hands-proof.png` and
`enterprise-actors.hands-proof.json`. The runtime GLB is never posed or changed
by the proof script.

## Runtime ownership and verification

`OfferingSkinnedActor.ts` clones skeletons with Three's `SkeletonUtils`, so
performers share geometry/textures but never bone state. Customer jackets, hair
and complexion maps vary independently without modifying the cached asset.
Skinned surfaces reconstruct from the absolute timeline, including backwards
seeks. Source textures and shared geometries are not disposed by an actor.

Run the actual-GLB regression checks:

```sh
node --import tsx --test test/frontend/offering-skinned-cast.test.ts
```

The tests load the exported skin and inverse bind matrices through Three's real
GLTFLoader. They verify independent skeletons, the retained CE elbow pivot,
upper-arm coverage beneath short sleeves, finite/deterministic skin deformation
through walking/kneeling/reader IK, and tablet-to-palm support contact.
