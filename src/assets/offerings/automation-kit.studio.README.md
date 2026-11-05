# Compact automation bay

The kit mounts to the existing Connected Enterprise service wall. It uses the
same warm polymer, spruce enamel, honey oak and brass family as the studio
architecture. The original store, equipment library and cast are unchanged.

Load `automation-kit.studio.glb` at an identity transform. Coordinates are
already store-world metres, with +Y up and equipment fronts facing +Z. Do not
normalize its size: the Wi-Fi plug is 72 mm high and the relay is only 42 mm wide.

## Animation contract

| Output | Switching device | Animatable surface |
| --- | --- | --- |
| Promotional display | `WiFiPlug` | `PromoDisplayFace` |
| Merchandising desk lamp | `ThreadPlug` | `LampDiffuser` |
| Illuminated sign | `ShellyRelay` | `IlluminatedSignFace` |

The three display meshes (`PromoDisplayFace`, `IlluminatedSignFace`,
`EdgeControllerScreen`) are independent front-facing planes with full 0–1 UVs.
They are deliberately blank for the application's canvas text and product art.
Their individual material names are `Automation / <node name>`.

Separate indicator meshes/materials are `WiFiPlugLED`, `ThreadPlugLED`,
`ShellyIndicator`, `ZigbeeSensorLED`, `WiFiAPLED`, `ThreadBorderRouterLED`,
`ZigbeeBridgeLED` and `ControllerStatusLED`. Initial emitter strength is 2 for
indicators and 1 for display/diffuser surfaces. Clone materials per scene before
changing their state. `RelayServiceCover` is a separate transparent mesh, while
`ShellyRelayContact` is a separate small contact/indicator detail inside it.

`WiFiAP`, `ThreadBorderRouter` and `ZigbeeBridge` are three different ledge-mounted
devices with engraved labels, cooling slots, rear ports and cable leads. The
Zigbee presence sensor and bridge illustrate a proposed adapter; the asset does
not claim the application has a Zigbee execution engine.

The lamp's downward diffuser centre is `[-10.2, 1.126, -1.14]`; place its light at
`[-10.2, 1.116, -1.14]`. All other surface centres, bounds and material names are
recorded in `automation-kit.studio.manifest.json`.

`StaffDoorHinge` pivots at `[-8.02, 0, -1.49]`. Animate its Y rotation from 0 to
1.42 radians. The leaf opens into the rear service area (negative Z) and clears
the walking path at x = -7.5. The frame, threshold and staff header stay fixed.
The door is context only; it has no Thread contact sensor. Lamp and network
device rubber feet sit on the existing ledge at y = 0.785.

Hide the previous oversized automation sensor, thermostat, lock and light
proxies in this scenario to prevent duplicated equipment. The store itself
does not need rebuilding.

## Authoring and provenance

The Wi-Fi plug is generic, using the 72 × 51 × 40 mm scale published for the
[Tapo P110M EU](https://www.tp-link.com/en/home-networking/smart-plug/tapo-p110m/).
It is not a P125M replica. The generic Thread plug uses a 56 × 56 mm European
face scale informed by [Eve Energy](https://www.evehome.com/en/eve-energy);
concealed rear pins are omitted from the installed model.

The red relay uses the 42 × 37 × 16 mm dimensions of
[Shelly Plus 1PM](https://www.shelly.com/blogs/documentation/shelly-plus-1pm).
It sits inside a transparent isolated service enclosure. Its visible harness
is an illustrative arrangement, not an installation diagram. The small ceiling
radar follows the 44.2 × 44.2 × 59 mm scale of the
[SONOFF SNZB-06P](https://support.sonoff.tech/snzb-06p-usermanual/).

Rebuild with Blender 4.5:

```sh
blender -b --factory-startup --python-exit-code 1 --python scripts/blender/automation_kit.py
```

The source writes the separate GLB and manifest, saves an editable
`scripts/blender/automation-kit.studio.blend`, then imports the existing store
only for proof rendering. The three proof PNGs show the mounted bay, plug detail
and relay detail. No imported architecture or proof lights enter the GLB.
