# Cooler asset source

The shipped `public/models/cooler.glb` is authored and exported by **Blender 4.5.13 LTS**. It is not a runtime primitive placeholder. The source includes beveled insulated cabinet panels, a hollow lined cavity, a hinged frame and low-E glass pane, a separate handle, recessed condenser louvers, five welded wire shelves with eight product lanes each, contoured bottles/cans, shelf price rails, adjustable shelf tracks, an electronic controller and recessed LED diffusers.

```powershell
blender -b -t 8 -P assets/build_cooler.py
python assets/validate_asset.py
blender -b -t 8 assets/cooler.blend -P assets/render_preview.py
```

The source script discovers Windows Brush Script/Arial when available and falls back to Blender's built-in font. These system fonts are not redistributed. The GLB contains converted lettering meshes. No font is needed at runtime.

Coordinates use **+Y up / +Z front**, meters, with the origin on the floor. `DoorPivot` is at `[-0.355, 1.065, 0.397]`. Animate its local Y rotation from `0` to `-1.919862` to swing the left-hinged door open. Rows run **bottom to top**, with `Shelf_0` through `Shelf_4` and `Stock_0_0` through `Stock_4_7`. Each stock node contains the visible front product and a second product behind it. A slot therefore represents a product lane's availability, not a calibrated count of physical items.

Multi-material Blender objects export as semantic groups with mesh children. Use `scene.getObjectByName('Stock_0_0')` to toggle a lane, and walk event target ancestors to identify interactive components. Full node names, sensor anchor positions and scene statistics are in `public/models/cooler.metadata.json`.

The 1024 × 1024 atlas is genuinely baked with Cycles AO (12 samples, 0.16 m occlusion distance). A shared, non-overlapping smart UV atlas covers cabinet/liner/shelves/grille. The recognized `glTF Material Output` node connects the image to exported `occlusionTexture` channels. It remains a separate PBR channel, not a painted shadow approximation. `cooler-ao.png` is also included separately for inspection. Closed-door glass is hidden only during AO baking, to avoid treating the glass as an opaque occluder.

The export uses `KHR_draco_mesh_compression` for all geometry. It also preserves transmission, clearcoat, IOR and emissive-strength extensions. The asset works with `useGLTF` and is ready for optional `npx gltfjsx public/models/cooler.glb` conversion. Preserve semantic node names if running additional optimizers.

`studio.hdr` is the 1K [Studio Small 09](https://polyhaven.com/a/studio_small_09) HDRI by Sergej Majboroda, distributed by Poly Haven under CC0. It is bundled locally so the rendered scene does not depend on a third-party environment CDN.

The model is an illustrative Imbera/Coca-Cola inspired twin. Dimensions approximate the Imbera G319's commercial proportions; it is not manufacturer CAD, a refrigeration service schematic, or an assertion of product certification. Imbera's [G319 specification sheet](https://us.imberacooling.com/wp-content/uploads/2020/12/1020373_SPEC-SHEET_G319-1.pdf) informed the five shelves and approximately 2.01 × 0.75 × 0.71 m cabinet dimensions.
