"""Original architectural retail cutaway for the unified SME offerings scene.

Blender 4.5: blender -b --factory-startup --python-exit-code 1 --python scripts/blender/enterprise_store.py
Design coordinates throughout are glTF/Three.js X,Y,Z, with +Y up and front +Z.
The GLB contains architecture and fixtures only. Optional equipment in the proof
is loaded from offerings-kit.glb AFTER the architectural export.
"""
import json
import math
import random
import sys
from array import array
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Vector

OUT = (Path(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else
       Path(__file__).resolve().parents[2] / "src/assets/offerings")
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
PARTS = []
BOXES = {}
GROUPS = {}
random.seed(42)


def V(p):
    return Vector((p[0], -p[2], p[1]))


def material(name, color, metal=0, rough=.5, emission=0, alpha=1):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    rgb = [v / 255 for v in bytes.fromhex(color)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, alpha)
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*rgb, alpha)
    bs.inputs["Metallic"].default_value = metal
    bs.inputs["Roughness"].default_value = rough
    if emission:
        bs.inputs["Emission Color"].default_value = (*rgb, 1)
        bs.inputs["Emission Strength"].default_value = emission
    if alpha < 1:
        bs.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "DITHERED"
    return m


plaster = material("Warm mineral plaster", "b8bbb4", .02, .82)
tile = material("Warm limestone tile", "343d40", .08, .61)
tile2 = material("Limestone tone variation", "394346", .08, .62)
grout = material("Recessed tile grout", "242d31", .02, .9)
concrete = material("Board formed concrete", "7c8887", .08, .77)
paving = material("Exterior charcoal paving", "4e6066", .05, .8)
powder = material("Graphite architectural steel", "20323b", .52, .32)
steel = material("Satin stainless steel", "8d9ea4", .82, .29)
wood = material("Natural smoked oak", "a77b4c", .02, .47)
woodedge = material("Oak end grain", "745941", .01, .65)
stone = material("Pale terrazzo countertop", "c6c9bd", .04, .32)
teal = material("Retail blue green enamel", "387a82", .28, .36)
navy = material("Slate navy panels", "284b60", .2, .43)
sky = material("Sky blue wayfinding", "63c9ee", .16, .34, .12)
ink = material("Soft white signage", "e3e7dc", .02, .5)
warm = material("Warm suspended diffuser", "fff0ce", .02, .4, 2)
screen = material("Blank terminal display", "0e2935", .25, .18)
glass = material("Architectural clear blue glazing", "a9d5db", .15, .16, alpha=.16)
soil = material("Dark potting soil", "393b2d", .02, .9)
leaf = material("Deep green leaves", "3c735b", .02, .75)
leaf2 = material("Leaf highlights", "70946b", .02, .7)
goods = [material("Product " + name, code, .02, .52) for name, code in (
    ("amber", "ce9739"), ("terracotta", "b65b3d"), ("cornflower", "497897"),
    ("sage", "608267"), ("cream", "d9c9a6"), ("berry", "77516c"))]
paper = material("Uncoated product paper", "eee4cf", .0, .86)
label_ink = material("Printed charcoal ink", "233b40", .0, .85)
foil = material("Satin package foil", "c6b184", .52, .43)


def surface_texture(name, width, height, sample):
    """Small original surface maps; packed in GLB, no network/image dependency."""
    image = bpy.data.images.new(name, width=width, height=height, alpha=False)
    image.colorspace_settings.name = "sRGB"
    pixels = array("f")
    for y in range(height):
        for x in range(width):
            rgb = sample(x, y)
            pixels.extend((*rgb, 1.0))
    image.pixels.foreach_set(pixels)
    image.pack()
    return image


grain_random = random.Random(902)
def oak_sample(x, y):
    # Long fibers with a slow meander and a few pores, rather than zebra stripes.
    bend = 2.7 * math.sin(y * .018) + 1.2 * math.sin(y * .053 + x * .013)
    fibers = math.sin((x + bend) * .29) * .028 + math.sin((x + bend) * .83) * .013
    pores = -.035 if math.sin((x + bend) * 1.63) > .94 else 0
    tone = fibers + pores + grain_random.uniform(-.009, .009)
    return (.62 + tone, .435 + tone * .79, .266 + tone * .51)


oak_map = surface_texture("Original smoked oak grain", 192, 512, oak_sample)
oak_node = wood.node_tree.nodes.new("ShaderNodeTexImage")
oak_node.image, oak_node.extension = oak_map, "REPEAT"
wood.node_tree.links.new(oak_node.outputs["Color"], wood.node_tree.nodes.get("Principled BSDF").inputs["Base Color"])


def map_material_uv(obj, mat):
    if mat != wood:
        return
    uv = obj.data.uv_layers.active or obj.data.uv_layers.new(name="Surface UV")
    for face in obj.data.polygons:
        normal = face.normal
        for loop_index in face.loop_indices:
            p = obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
            # Grain follows the vertical fronts and runs along horizontal caps.
            if abs(normal.z) > .65:
                coord = (p.x * 2.0, p.y * .8)
            elif abs(normal.x) > .65:
                coord = (p.y * 2.0, p.z * .8)
            else:
                coord = (p.x * 2.0, p.z * .8)
            uv.data[loop_index].uv = coord


def register(obj, mat):
    obj.data.materials.append(mat)
    PARTS.append(obj)
    return obj


def soften(obj, width, segments=1):
    if width <= 0:
        return
    m = obj.modifiers.new("Manufactured edge", "BEVEL")
    m.width, m.segments = width, segments
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)
    for p in obj.data.polygons:
        p.use_smooth = True
    n = obj.modifiers.new("Panel normals", "WEIGHTED_NORMAL")
    n.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=n.name)


def box(name, p, size, mat=powder, bevel=.015, yaw=0):
    key = (tuple(size), mat.name, bevel)
    data = BOXES.get(key)
    if data is None:
        bpy.ops.mesh.primitive_cube_add(size=1)
        obj = bpy.context.object
        obj.scale = (size[0], size[2], size[1])
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        register(obj, mat)
        soften(obj, min(bevel, min(size) * .25))
        map_material_uv(obj, mat)
        BOXES[key] = obj.data
        obj.data.use_fake_user = True
    else:
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        PARTS.append(obj)
    obj.name, obj.location = name, V(p)
    obj.rotation_euler.z = -yaw
    return obj


def cylinder(name, p, radius, depth, mat=steel, axis=(0, 1, 0), vertices=12, top=None):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius,
                                    radius2=radius if top is None else top,
                                    depth=depth, location=V(p))
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(V(axis).normalized())
    register(obj, mat)
    for p in obj.data.polygons:
        p.use_smooth = len(p.vertices) == 4
    return obj


def beam(name, a, b, width=.06, mat=steel):
    delta = V(b) - V(a)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(V(a) + V(b)) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (width, width, delta.length)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(delta.normalized())
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return register(obj, mat)


def text(word, p, size=.2, mat=ink, yaw=0):
    bpy.ops.object.text_add(location=V(p), rotation=(math.pi / 2, 0, -yaw))
    obj = bpy.context.object
    obj.data.body, obj.data.size = word, size
    obj.data.align_x = "CENTER"
    obj.data.extrude = .001
    obj.data.resolution_u = 1
    bpy.ops.object.convert(target="MESH")
    obj.name = "Sign " + word
    register(obj, mat)
    return obj


root = bpy.data.objects.new("EnterpriseStore", None)
scene.collection.objects.link(root)


def finish(name):
    group = bpy.data.objects.new(name, None)
    scene.collection.objects.link(group)
    group.parent = root
    GROUPS[name] = group
    by_material = defaultdict(list)
    for obj in PARTS:
        by_material[obj.data.materials[0]].append(obj)
    for mat, objs in by_material.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objs:
            obj.select_set(True)
        active = objs[0]
        if active.data.users > 1:
            active.data = active.data.copy()
        bpy.context.view_layer.objects.active = active
        if len(objs) > 1:
            bpy.ops.object.join()
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        active.name = name + "_" + mat.name.replace(" ", "")
        active.parent = group
    PARTS.clear()
    return group


# Continuous floor, front apron and external service access. No object pedestals.
box("Continuous site foundation", (0, -.18, 0), (32, .28, 24), paving, .05)
# Separate top layers have real vertical clearance: no coplanar slab faces.
for x in (-14.5, 14.5):
    box("Exterior side paving", (x, -.02, 0), (3, .04, 24), paving, .008)
for z in (-11, 11):
    box("Exterior front rear paving", (0, -.02, z), (26, .04, 2), paving, .008)
box("Interior structural slab", (0, -.11, 0), (26.1, .16, 20.1), grout, .02)
for i in range(13):
    for j in range(10):
        box("Limestone floor module", (-12 + i * 2, -.008, -9 + j * 2),
            (1.985, .016, 1.985), tile2 if (i + j) % 5 == 0 else tile, .005)
for x in (-15, -14, 14, 15):
    box("Paving expansion joint", (x, .002, 0), (.012, .006, 23.8), powder, 0)
for z in (-11, 11):
    box("Paving expansion joint", (0, .002, z), (31.8, .006, .012), powder, 0)
box("Entry mat", (1, .012, 8.8), (3.0, .024, 1.7), powder, .025)
for x in range(13):
    box("Entry mat rib", (-.37 + x * .225, .027, 8.8), (.04, .008, 1.55), grout, 0)
finish("FloorShell")

# Rear elevation: clerestory windows, plaster returns, warm millwork and network room.
box("Rear plaster wall", (0, 1.75, -9.9), (26, 3.5, .22), plaster, .04)
box("Rear steel skirting", (0, .12, -9.76), (25.8, .24, .045), powder, .008)
box("Rear upper lintel", (0, 4.42, -9.9), (26.2, .24, .3), powder, .025)
for x in (-12.9, -8.6, -4.3, 0, 4.3, 8.6, 12.9):
    box("Window vertical mullion", (x, 3.92, -9.89), (.085, 1.02, .15), powder, .008)
for y in (3.47, 4.34):
    box("Clerestory transom", (0, y, -9.89), (26, .075, .15), powder, .008)
for x in (-10.75, -6.45, -2.15, 2.15, 6.45, 10.75):
    box("Clerestory glazing", (x, 3.91, -9.9), (4.2, .78, .025), glass, .004)
for x in (-12.6, -7.4, 5.6, 12.5):
    box("Rear structural column", (x, 2.2, -9.65), (.16, 4.4, .18), steel, .012)
box("Fresh wall blue enamel", (-.5, 1.53, -9.73), (8.2, 2.66, .09), teal, .02)
box("Rear brand strip", (-.5, 3.05, -9.70), (9.4, .65, .12), powder, .025)
text("CONNECTED MARKET", (-.5, 2.94, -9.615), .37)
text("FRESH  /  EVERYDAY  /  CONNECTED", (-.5, 2.48, -9.66), .13)
for x in (-11.5, -10.75, -10, -9.25, -8.5):
    box("Climate bay wall panel", (x, 1.55, -9.72), (.68, 2.75, .06), concrete, .01)
text("BUILDING SERVICES", (-10, 3.0, -9.64), .18, ink)
box("Network bay rear panel", (9.35, 1.8, -9.72), (5.2, 3.15, .07), navy, .01)
text("NETWORK & OPERATIONS", (9.25, 3.15, -9.64), .18, ink)
for y in (.4, 2.8):
    box("Network horizontal trunking", (9.2, y, -9.6), (4.9, .10, .1), steel, .012)
finish("RearElevation")

# Low cutaway side wall rises only behind automation and the climate service zone.
box("Left cutaway wall", (-12.9, .26, 0), (.25, .52, 19.8), plaster, .025)
box("Left rear wall", (-12.9, 1.53, -6.0), (.25, 3.06, 7.8), plaster, .03)
box("Left oak wall cap", (-12.9, .55, 4.1), (.31, .065, 11.6), wood, .012)
for z in (-9.65, -6, -2.2):
    box("Left structural post", (-12.8, 2.2, z), (.17, 4.4, .17), powder, .012)
box("Right cutaway curb", (12.92, .16, 0), (.22, .32, 20), concrete, .025)
box("Right rear return", (12.92, 1.5, -7.8), (.22, 3, 4.2), plaster, .025)
box("Network room partition", (6.2, .68, -7.8), (.13, 1.36, 3.8), navy, .02)
box("Network room partition trim", (6.2, 1.39, -7.8), (.17, .07, 3.8), steel, .008)
finish("CutawayWalls")

# A partial glazed storefront signals an entrance without hiding the people view.
for x, width in ((-7.4, 10.8), (8.25, 9.3)):
    box("Front low sill", (x, .17, 9.85), (width, .34, .19), concrete, .02)
    box("Front glass low screen", (x, .72, 9.85), (width, .72, .025), glass, .003)
    box("Front screen cap", (x, 1.11, 9.85), (width, .045, .075), steel, .006)
    for dx in (-width / 2, 0, width / 2):
        box("Front narrow mullion", (x + dx, .73, 9.85), (.06, .82, .08), powder, .007)
for x in (-1.2, 3.2):
    box("Entrance steel jamb", (x, 1.65, 9.86), (.10, 3.3, .14), powder, .008)
box("Entrance header", (1, 3.3, 9.86), (4.5, .14, .24), powder, .012)
box("Entrance oak fascia", (1, 3.51, 9.86), (4.65, .28, .28), wood, .015)
text("MARKET", (1, 3.44, 10.015), .20, ink)
for x in (-.9, 2.9):
    box("Fixed sidelight", (x, 1.65, 9.86), (.43, 3.1, .025), glass, .005)
    box("Sidelight stile", (x + (.22 if x < 0 else -.22), 1.65, 9.86), (.045, 3.1, .08), steel, .005)
box("Open entrance threshold", (1, .023, 9.86), (3.7, .046, .25), steel, .008)
finish("Storefront")

# Three double-sided gondolas. Lower proportions preserve visual access across store.
for aisle, cx in enumerate((-6, -1, 4)):
    cz = 1.0
    box("Aisle kickboard", (cx, .14, cz), (1.2, .28, 4.8), powder, .025)
    box("Oak end panels", (cx, .88, cz - 2.43), (1.18, 1.76, .085), wood, .025)
    box("Oak end panels", (cx, .88, cz + 2.43), (1.18, 1.76, .085), wood, .025)
    box("Aisle central screen", (cx, .94, cz), (.08, 1.65, 4.72), powder, .012)
    for z in (cz - 2.25, cz, cz + 2.25):
        box("Gondola upright", (cx, .91, z), (.11, 1.7, .055), powder, .008)
        for y in (.44, .63, .90, 1.09, 1.36, 1.55):
            for side in (-1, 1):
                box("Shelf upright slot", (cx + side * .058, y, z), (.005, .05, .017), label_ink, 0)
    for y in (.32, .78, 1.24, 1.69):
        box("Folded shelf deck", (cx, y, cz), (1.16, .045, 4.72), stone if y == 1.69 else steel, .009)
        for side in (-1, 1):
            box("Shelf ticket channel", (cx + side * .585, y + .035, cz), (.035, .09, 4.65), powder, .005)
            if y < 1.5:
                for j in range(6):
                    price_z = cz - 1.92 + j * .77
                    box("Shelf paper ticket", (cx + side * .605, y + .035, price_z), (.008, .068, .24), paper, 0)
                    box("Ticket price rule", (cx + side * .610, y + .042, price_z + .032), (.002, .012, .10), label_ink, 0)
    for level, y in enumerate((.35, .81, 1.27)):
        for side in (-1, 1):
            for j in range(11):
                z = cz - 2.1 + j * .415
                x = cx + side * .30
                col = goods[(aisle * 2 + level + j // 3) % len(goods)]
                if (j + aisle + level) % 3 == 0:
                    # Bottles: opaque colored product, separate cap and label band.
                    cylinder("Product bottle", (x, y + .14, z), .115, .28, col, vertices=10, top=.09)
                    cylinder("Bottle neck", (x, y + .305, z), .045, .05, col, vertices=10)
                    cylinder("Bottle closure", (x, y + .34, z), .048, .026, foil, vertices=12)
                    cylinder("Bottle cap seam", (x, y + .328, z), .049, .007, label_ink, vertices=12)
                    cylinder("Bottle paper band", (x, y + .16, z), .117, .11, paper, vertices=12)
                    cylinder("Bottle printed medallion", (x + side * .119, y + .17, z), .032, .003, col, axis=(side, 0, 0), vertices=12)
                    box("Bottle print baseline", (x + side * .120, y + .13, z), (.003, .009, .055), label_ink, 0)
                else:
                    h = .23 + (j % 3) * .035
                    box("Packaged grocery", (x, y + h / 2, z), (.25, h, .29), col, .009)
                    box("Package paper label", (x + side * .128, y + h * .58, z), (.006, h * .54, .22), paper, 0)
                    box("Package brand rule", (x + side * .132, y + h * .72, z), (.002, .013, .16), col, 0)
                    box("Package title rule", (x + side * .132, y + h * .59, z), (.002, .009, .105), label_ink, 0)
                    box("Package detail rule", (x + side * .132, y + h * .49, z), (.002, .006, .071), label_ink, 0)
                    box("Carton folded top", (x, y + h + .003, z), (.237, .006, .278), foil if (j + level) % 4 == 0 else col, 0)
    box("Aisle category header", (cx, 1.82, cz + 2.46), (1.15, .25, .055), navy, .012)
    text(("PANTRY", "EVERYDAY", "WELLNESS")[aisle], (cx, 1.75, cz + 2.495), .12)
    box("Category accent rule", (cx, 1.66, cz + 2.497), (.88, .018, .008), goods[(aisle * 2) % len(goods)], .001)
    # Edge grain lines and tiny stock labels give useful close-view detail.
    for dx in (-.38, -.13, .12, .37):
        box("Oak end grain groove", (cx + dx, .89, cz + 2.48), (.008, 1.61, .003), woodedge, 0)
finish("RetailAisles")

# Warm wood checkout millwork, recessed toe-kicks and explicit terminal mounts.
for index, cz in enumerate((4.5, 7.0)):
    cx = 8
    box("Checkout recessed kick", (cx, .09, cz), (3.0, .18, 1.05), powder, .025)
    box("Checkout oak carcass", (cx, .61, cz), (3.14, 1.04, 1.16), wood, .035)
    box("Checkout stone worktop", (cx, 1.105, cz), (3.3, .09, 1.30), stone, .025)
    for dx in (-1.15, -.57, 0, .57, 1.15):
        box("Vertical millwork reveal", (cx + dx, .60, cz + .584), (.012, .89, .008), woodedge, 0)
    box("Conveyor inset", (cx - .42, 1.156, cz), (1.53, .012, .82), powder, .018)
    for i in range(7):
        box("Conveyor rubber seam", (cx - 1.05 + i * .205, 1.164, cz), (.008, .002, .76), grout, 0)
    for z in (-.35, .35):
        box("Conveyor stainless edge", (cx - .42, 1.169, cz + z), (1.57, .025, .03), steel, .007)
    cylinder("Terminal mount foot", (cx + 1.08, 1.171, cz - .22), .16, .045, steel, vertices=20)
    cylinder("Terminal mounting stem", (cx + 1.08, 1.35, cz - .22), .045, .32, powder, vertices=12)
    # Blank terminal is architectural fixture, not a duplicate live kit device.
    box("POS screen housing", (cx + 1.08, 1.58, cz - .20), (.58, .39, .055), powder, .03)
    box("POS blank glass", (cx + 1.08, 1.58, cz - .165), (.51, .32, .012), screen, .018)
    box("Bagging shelf", (cx + 1.93, .69, cz), (.62, .09, 1.15), stone, .018)
    box("Bagging support", (cx + 2.16, .35, cz), (.10, .70, 1.0), powder, .01)
    box("Counter fascia sign", (cx, .82, cz + .587), (1.70, .24, .016), powder, .01)
    text(("PAYMENTS", "SERVICE DESK")[index], (cx, .77, cz + .600), .125, ink)
    for x in (cx - 1.42, cx + 1.42):
        box("Checkout corner trim", (x, .59, cz + .587), (.025, .93, .014), powder, .002)
# Subtle queue markers, inlaid in the existing floor instead of raised platforms.
for z in (4.3, 5.6, 7):
    box("Queue floor marker", (10.7, .008, z), (.55, .016, .06), teal, .003)
finish("CheckoutFixtures")

# Services are integrated into the building: workbench, wallboard and real cable trays.
box("Network workbench top", (7, 1.06, -3), (3.4, .08, 1.25), stone, .022)
for x in (5.55, 8.45):
    box("Network workbench frame", (x, .52, -3), (.09, 1.04, 1.10), powder, .01)
box("Network workbench lower brace", (7, .22, -3.4), (2.9, .08, .07), steel, .01)
box("Network workbench rear rail", (7, .85, -3.63), (3.1, .055, .055), steel, .008)
# CPE is placed by R3F on y=1.10. No equipment is baked into this asset.
box("Automation wallboard backing", (-10, 1.28, -1.58), (3.6, 2.56, .18), plaster, .03)
box("Automation wallboard frame", (-10, 2.59, -1.58), (3.76, .08, .25), powder, .012)
for x in (-11.82, -8.18):
    box("Automation board post", (x, 1.30, -1.58), (.08, 2.60, .25), powder, .012)
box("Automation lower millwork", (-10, .36, -1.29), (3.5, .72, .72), wood, .022)
box("Automation narrow ledge", (-10, .75, -1.27), (3.65, .07, .81), stone, .018)
text("CONNECTED SERVICES", (-10, 2.31, -1.47), .15, navy)
for x in (-11.2, -10.05, -8.9):
    box("Automation conduit", (x, 1.4, -1.46), (.035, 1.17, .035), steel, .004)
box("Automation conduit trunk", (-10, .83, -1.45), (2.3, .045, .045), steel, .005)
for x in (-11.85, 11.8):
    cylinder("Vertical building conduit", (x, 1.85, -9.45), .035, 3.7, steel, vertices=10)
    for y in (.3, 1.4, 2.5, 3.6):
        box("Conduit saddle", (x, y, -9.42), (.13, .035, .055), powder, .003)
for z in (-8.95, -8.55):
    box("Rear cable tray rail", (0, 3.15, z), (24.8, .10, .045), steel, .005)
for i in range(42):
    box("Cable tray cross member", (-12.3 + i * .6, 3.10, -8.75), (.035, .045, .44), steel, 0)
for z in (-8.86, -8.72, -8.59):
    cylinder("Structured cable bundle", (0, 3.16, z), .024, 24.6, powder, axis=(1, 0, 0), vertices=8)
cylinder("Cable riser at network closet", (11.6, 1.67, -8.72), .04, 3.12, powder, vertices=10)
text("EDGE NETWORK", (7, .83, -2.35), .18, navy)
finish("ServiceArchitecture")

# A slim, exposed rear truss with actual bracing; the central retail floor has no roof.
for z in (-9.5, -8.9):
    for y in (4.35, 5.05):
        beam("Rear truss chord", (-12.8, y, z), (12.8, y, z), .11, powder)
    for i in range(20):
        x = -12.8 + i * 1.28
        a, b = (4.35, 5.05) if i % 2 == 0 else (5.05, 4.35)
        beam("Rear truss diagonal", (x, a, z), (x + 1.28, b, z), .055, steel)
for x in (-12.8, -6.4, 0, 6.4, 12.8):
    beam("Truss transverse tie", (x, 5.05, -9.5), (x, 5.05, -8.9), .07, powder)
    for z in (-9.5, -8.9):
        box("Truss footing", (x, 4.3, z), (.35, .08, .30), steel, .01)
for x in (-9, -3, 3, 9):
    for dx in (-.95, .95):
        beam("Rear light suspension", (x + dx, 4.35, -8.9), (x + dx, 3.73, -7.5), .017, powder)
    box("Rear pendant housing", (x, 3.73, -7.5), (2.5, .10, .28), powder, .02)
    box("Rear pendant diffuser", (x, 3.666, -7.5), (2.35, .025, .22), warm, .006)
# Narrow side support, deliberately behind the useful front/right cutaway view.
for z in (-6.2, -1.5):
    beam("Left support cantilever", (-12.8, 3.25, z), (-10.8, 3.25, z), .075, powder)
    box("Side linear luminaire", (-11.8, 3.21, z), (1.75, .07, .2), warm, .012)
finish("LightingRig")


def plant(x, z, scale=1):
    cylinder("Tapered planter", (x, .30 * scale, z), .30 * scale, .6 * scale, concrete, vertices=16, top=.37 * scale)
    cylinder("Planter soil", (x, .605 * scale, z), .33 * scale, .025 * scale, soil, vertices=16)
    for j in range(9):
        angle = j * math.tau / 9 + .17
        h = (.8 + (j % 3) * .19) * scale
        end = (x + math.cos(angle) * .32 * scale, .63 * scale + h, z + math.sin(angle) * .32 * scale)
        beam("Plant stem", (x, .61 * scale, z), end, .015 * scale, leaf)
        # A curved lenticular leaf, six faces rather than a heavy sphere.
        center = Vector(end)
        radial = Vector((math.cos(angle), .25, math.sin(angle)))
        across = Vector((-math.sin(angle), 0, math.cos(angle))) * .10 * scale
        tip = center + radial * .38 * scale
        base = center - radial * .15 * scale
        mid = center + Vector((0, .06 * scale, 0))
        pts = [base, mid + across, tip, mid - across, mid + Vector((0, .04 * scale, 0))]
        mesh = bpy.data.meshes.new("Botanical leaf")
        mesh.from_pydata([V(p) for p in pts], [], [(0,1,4),(1,2,4),(2,3,4),(3,0,4)])
        obj = bpy.data.objects.new("Botanical leaf", mesh)
        scene.collection.objects.link(obj)
        register(obj, leaf if j % 2 else leaf2)


for p in ((-10.8, 7.8, 1.2), (5.2, 8.7, 1), (11.8, -3.8, .85), (-4.9, -8.5, .85)):
    plant(*p)
finish("Planting")

# Product-facing sign blocks and restrained floor markings are part of the building.
box("Entry welcome sign", (-4.6, 1.0, 7.6), (1.3, 1.7, .08), wood, .025)
box("Entry sign panel", (-4.6, 1.0, 7.66), (1.12, 1.48, .035), navy, .012)
for x in (-5.1, -4.1):
    box("Sign feet", (x, .06, 7.55), (.12, .12, .65), powder, .012)
text("GOOD THINGS", (-4.6, 1.37, 7.69), .13)
text("EVERY DAY", (-4.6, 1.14, 7.69), .14)
text("FRESH / LOCAL", (-4.6, .73, 7.69), .09, sky)
for x in (-8, 1):
    box("Walkway inlay", (x, .006, 6), (.52, .012, .07), teal, .003)
finish("Wayfinding")

bpy.context.view_layer.update()
meshes = [obj for obj in root.children_recursive if obj.type == "MESH"]
triangles = sum(len(face.vertices) - 2 for obj in meshes for face in obj.data.polygons)
corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
world_points = [(p.x, p.z, -p.y) for p in corners]
manifest = {
    "root": "EnterpriseStore", "up": "+Y", "front": "+Z", "units": "meters",
    "interiorSize": [26, 5.105, 20], "siteSize": [32, 5.425, 24], "floorY": 0,
    "groups": list(GROUPS), "triangles": triangles, "meshes": len(meshes),
    "actualBounds": {
        "min": [round(min(p[axis] for p in world_points), 4) for axis in range(3)],
        "max": [round(max(p[axis] for p in world_points), 4) for axis in range(3)]},
    "surfaceMaps": ["Original smoked oak grain · 192 × 512 · embedded PNG"],
    "equipmentIncluded": False,
    "anchors": {
        "Gateway": [7, 1.10, -3], "ServerRack": [10, 0, -6],
        "HVAC": [-9, 0, -6], "Cooler": [0, 0, -7.5],
        "FiberTerminal": [14.5, 0, -6], "CellularTower": [14.5, 0, 2],
        "SolarPanel": [-15, 0, -6], "AutomationWall": [-10, 1.5, -1.45],
        "CustomerPath": [1, 0, 6], "Entrance": [1, 0, 9.86],
        "CheckoutCountertops": [[8, 1.15, 4.5], [8, 1.15, 7]],
    },
    "clearances": "Shelf aisles at x=-6,-1,4 span z=-1.43..3.43. Customer path z=6 is clear from x=-2..5. The front entrance opening spans x=-.68..2.68.",
}
(OUT / "enterprise-store.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
bpy.ops.object.select_all(action="DESELECT")
root.select_set(True)
for obj in root.children_recursive:
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT / "enterprise-store.glb"), export_format="GLB",
                         use_selection=True, export_yup=True, export_materials="EXPORT",
                         export_cameras=False, export_lights=False)
print("STORE_EXPORTED", json.dumps(manifest), flush=True)

# Optional proof staging with the actual reusable equipment. These are never exported.
kit = OUT / "offerings-kit.glb"
if kit.exists():
    old = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(kit))
    imported = set(bpy.data.objects) - old
    placements = {"Gateway": ((7, 1.10, -3), 1.15), "ServerRack": ((10, 0, -6), 1.45),
                  "HVAC": ((-9, 0, -6), 1.5), "Cooler": ((0, 0, -7.5), 1.7),
                  "FiberTerminal": ((14.5, 0, -6), 1.3), "CellularTower": ((14.5, 0, 2), 1.8),
                  "SolarPanel": ((-15, 0, -6), 1.4), "Person": ((1, 0, 6), 1),
                  "Thermostat": ((-10, 1.3, -1.35), .7)}
    for obj in imported:
        if obj.parent is None:
            if obj.name in placements:
                pos, size = placements[obj.name]
                obj.location = V(pos)
                obj.scale = (size, size, size)
            else:
                obj.hide_render = True
                for child in obj.children_recursive:
                    child.hide_render = True

world = bpy.data.worlds.new("Neutral retail studio")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (.22, .28, .34, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = .4
scene.world = world


def area(name, pos, target, energy, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.shape, data.size, data.color = energy, "DISK", size, color
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = V(pos)
    obj.rotation_euler = (V(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


area("Large north light", (-12, 22, 4), (0, 0, 0), 9500, 18, (.86, .94, 1))
area("Warm showroom strip", (14, 17, -6), (0, 1, 0), 8500, 14, (1, .90, .76))
area("Front fill", (0, 15, 22), (0, 1, 0), 7000, 17, (.92, .96, 1))
area("Rear fill", (-2, 15, -16), (0, 0, 0), 6500, 10, (1, 1, 1))
bpy.ops.object.camera_add(location=V((31, 28, 36)))
camera = bpy.context.object
camera.rotation_euler = (V((0, .6, 0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.type, camera.data.ortho_scale = "ORTHO", 43
scene.camera = camera
scene.render.engine = "CYCLES"
scene.cycles.samples, scene.cycles.use_denoising = 40, True
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1800, 1400, 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(OUT / "enterprise-store-proof.png")
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.film_transparent = True
bpy.ops.render.render(write_still=True)
print("STORE_COMPLETE", (OUT / "enterprise-store.glb").stat().st_size, "bytes", triangles, "triangles", flush=True)
