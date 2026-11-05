"""Author reusable, physically shaded equipment for the SME offerings explorer.

Blender 4.5: blender -b --factory-startup --python-exit-code 1 --python scripts/blender/offerings_kit.py
Optional output directory follows --. Prefabs are exported at origin; presentation
layout, labels, floor, camera and lights belong only to the proof render.
"""
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Vector

OUT = (Path(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else
       Path(__file__).resolve().parents[2] / "src/assets/offerings")
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
PI = math.pi
FRONT = (PI / 2, 0, 0)
ROOTS = {}
PARTS = []
BOXES = {}


def srgb(hex_color):
    return tuple(v / 255 / 12.92 if v < 11 else ((v / 255 + .055) / 1.055) ** 2.4
                 for v in bytes.fromhex(hex_color))


def mat(name, color, metal=0, rough=.4, glow=0, alpha=1):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*srgb(color), alpha)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*srgb(color), alpha)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if glow:
        b.inputs["Emission Color"].default_value = (*srgb(color), 1)
        b.inputs["Emission Strength"].default_value = glow
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "DITHERED"
    return m


graphite = mat("Graphite powder coat", "343d49", .5, .36)
aluminum = mat("Bead blasted aluminum", "a2b1bd", .78, .29)
titanium = mat("Brushed titanium", "667d8a", .82, .31)
silver = mat("Machined silver edges", "d3dce0", .84, .23)
ceramic = mat("Warm industrial ceramic", "c5cecf", .13, .4)
recess = mat("Port recess and gasket", "0c1722", .05, .56)
rubber = mat("Soft touch graphite", "222c34", .02, .65)
screen = mat("Anti reflective display", "071924", .28, .16)
glass = mat("Smoked cooler glazing", "84bdcf", .15, .11, alpha=.18)
cyan = mat("Sky blue status", "38bdf8", .25, .29, .8)
green = mat("Emerald status", "4ed49b", .08, .3, .35)
amber = mat("Amber contact", "dcb575", .64, .29)
purple = mat("Violet automation", "a99ce4", .25, .3, .25)
pcb = mat("Circuit board", "164c53", .22, .45)
white = mat("Display and markings", "e0f2ff", .05, .4, .1)
solar = mat("Photovoltaic silicon", "183c66", .52, .22)


def root(name):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    ROOTS[name] = obj
    return obj


def subgroup(name, parent):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    obj.parent = parent
    return obj


def register(obj, material):
    obj.data.materials.append(material)
    PARTS.append(obj)
    return obj


def bevel(obj, width=.02, segments=2):
    if not width:
        return
    m = obj.modifiers.new("Machined edge", "BEVEL")
    m.width, m.segments = width, segments
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)
    for face in obj.data.polygons:
        face.use_smooth = True
    n = obj.modifiers.new("Panel normals", "WEIGHTED_NORMAL")
    n.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=n.name)


def box(pos, size, material, radius=.015, rotation=None):
    key = (tuple(size), material.name, radius)
    mesh = BOXES.get(key)
    if mesh is None:
        bpy.ops.mesh.primitive_cube_add(size=1)
        obj = bpy.context.object
        obj.dimensions = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        register(obj, material)
        bevel(obj, min(radius, min(size) * .4))
        BOXES[key] = obj.data
        obj.data.use_fake_user = True
    else:
        obj = bpy.data.objects.new("Panel", mesh)
        scene.collection.objects.link(obj)
        PARTS.append(obj)
    obj.location = pos
    if rotation:
        obj.rotation_euler = rotation
    return obj


def cyl(pos, radius, depth, material, rotation=(0, 0, 0), sides=20, top=None):
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=radius,
                                    radius2=radius if top is None else top,
                                    depth=depth, location=pos, rotation=rotation)
    obj = register(bpy.context.object, material)
    for face in obj.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    return obj


def ball(pos, scale, material, segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=pos)
    obj = register(bpy.context.object, material)
    obj.scale = scale
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def bar(a, b, radius, material, sides=12, top=None):
    a, b = Vector(a), Vector(b)
    obj = cyl((a + b) / 2, radius, (b - a).length, material, sides=sides, top=top)
    obj.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    return obj


def cable(points, radius=.012, material=recess):
    data = bpy.data.curves.new("Cable", "CURVE")
    data.dimensions, data.resolution_u = "3D", 5
    data.bevel_depth, data.bevel_resolution = radius, 1
    spl = data.splines.new("BEZIER")
    spl.bezier_points.add(len(points) - 1)
    for p, co in zip(spl.bezier_points, points):
        p.co = co
        p.handle_left_type = p.handle_right_type = "AUTO"
    obj = bpy.data.objects.new("Cable", data)
    scene.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    register(obj, material)
    return obj


def finish(parent):
    """One mesh per material, with geometry baked around the prefab origin."""
    batches = defaultdict(list)
    for obj in PARTS:
        batches[obj.data.materials[0].name].append(obj)
    for name, batch in batches.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in batch:
            obj.select_set(True)
        active = batch[0]
        if active.data.users > 1:
            active.data = active.data.copy()
        bpy.context.view_layer.objects.active = active
        if len(batch) > 1:
            bpy.ops.object.join()
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        active.name = parent.name + "_" + name.replace(" ", "")
        active.parent = parent
    PARTS.clear()


def set_group_pivot(group, position):
    """Move the articulation origin without changing assembled world geometry."""
    center = Vector(position)
    for obj in group.children:
        if obj.type == "MESH":
            for vertex in obj.data.vertices:
                vertex.co -= center
    group.location = center


def led(x, y, z, material=cyan, radius=.018):
    cyl((x, y, z), radius, .012, material, FRONT, 12)


def screw(x, y, z, top=False):
    rot = (0, 0, 0) if top else FRONT
    cyl((x, y, z), .018, .009, silver, rot, 10)
    if top:
        box((x, y, z + .005), (.018, .004, .002), recess, .0004)
    else:
        box((x, y - .005, z), (.018, .002, .004), recess, .0004)


def port(x, y, z, width=.15):
    box((x, y, z), (width, .025, width * .73), silver, .005)
    box((x, y - .016, z), (width * .82, .012, width * .55), recess, .003)
    for n in range(4):
        box((x + (n - 1.5) * width * .13, y - .023, z - width * .17),
            (width * .055, .008, width * .16), amber, .001)


def screen_lines(x, y, z, width=.3):
    for i in range(3):
        box((x - width * .13, y, z - i * .045), (width * (1 - i * .15), .006, .012), cyan, .003)


def make_gateway():
    r = root("Gateway")
    p = subgroup("GatewayHousing", r)
    box((0, 0, .07), (1.86, 1.1, .14), titanium, .035)
    box((0, 0, .22), (1.7, .98, .3), graphite, .035)
    box((0, -.496, .23), (1.62, .035, .25), aluminum, .015)
    for x in (-.78, .78):
        for y in (-.4, .4):
            screw(x, y, .147, True)
    for x in (-.75, .75):
        screw(x, -.522, .25)
    finish(p)
    p = subgroup("GatewayBoard", r)
    box((0, 0, .305), (1.48, .78, .025), pcb, .009)
    box((-.05, -.02, .331), (.37, .32, .04), recess, .006)
    box((-.05, -.02, .355), (.27, .22, .009), silver, .002)
    for x in (-.5, .5):
        for y in (-.2, .08, .25):
            box((x, y, .34), (.16, .09, .045), recess, .004)
            box((x, y, .365), (.11, .055, .003), titanium, .001)
    finish(p)
    p = subgroup("GatewayHeatsink", r)
    box((0, 0, .38), (1.72, .99, .09), titanium, .018)
    for x in range(20):
        box((-.79 + x * .083, .03, .493), (.032, .88, .17), aluminum, .01)
    finish(p)
    p = subgroup("GatewayPorts", r)
    for x in (-.38, -.12, .14, .4):
        port(x, -.525, .215, .18)
    led(-.62, -.52, .27, green)
    led(-.55, -.52, .27, cyan, .012)
    box((.64, -.527, .21), (.09, .025, .045), recess, .005)
    finish(p)
    p = subgroup("GatewayAntennae", r)
    for x in (-.7, .7):
        cyl((x, .38, .48), .067, .18, recess)
        cyl((x, .38, .59), .058, .06, silver)
        cyl((x, .38, 1), .035, .77, rubber, top=.026)
        ball((x, .38, 1.385), (.027, .027, .025), rubber, 12, 6)
        box((x, .346, 1.1), (.023, .006, .18), titanium, .002)
    finish(p)


def make_fiber():
    r = root("FiberTerminal")
    box((0, 0, .56), (.85, .5, 1.12), ceramic, .055)
    box((0, -.256, .57), (.69, .024, .94), graphite, .025)
    box((0, -.273, .77), (.43, .012, .14), screen, .012)
    screen_lines(-.01, -.284, .80, .25)
    for z in (.41, .57):
        for x in (-.19, .19):
            box((x, -.289, z), (.17, .065, .11), cyan, .009)
            box((x, -.326, z), (.11, .01, .055), recess, .003)
    for z in range(9):
        box((.432, .015, .29 + z * .065), (.008, .29, .016), recess, .003)
    for x in (-.2, -.1, 0, .1, .2):
        led(x, -.279, .21, green, .012)
    cable([(-.19, -.33, .41), (-.2, -.42, .19), (.15, -.43, .15), (.19, -.33, .41)], .014, cyan)
    finish(r)


def make_tower():
    r = root("CellularTower")
    box((0, 0, .04), (.9, .9, .08), graphite, .035)
    legs = [(-.26, -.23), (.26, -.23), (0, .3)]
    for x, y in legs:
        bar((x, y, .08), (x * .35, y * .35, 1.83), .027, titanium)
    for z in (.27, .63, .99, 1.35):
        for i in range(3):
            a, b = legs[i], legs[(i + 1) % 3]
            t = 1 - z * .35
            bar((a[0] * t, a[1] * t, z), (b[0] * (t - .12), b[1] * (t - .12), z + .34), .012, aluminum, 8)
    cyl((0, 0, 1.91), .028, .42, silver, sides=12)
    for angle in (0, 2 * PI / 3, 4 * PI / 3):
        x, y = math.sin(angle) * .23, math.cos(angle) * .23
        box((x, y, 1.66), (.17, .11, .62), ceramic, .035, (0, 0, -angle))
        bar((0, 0, 1.53), (x, y, 1.53), .018, titanium)
        bar((0, 0, 1.8), (x, y, 1.8), .018, titanium)
    ball((0, 0, 2.135), (.035, .035, .03), cyan, 12, 6)
    box((.24, -.28, .3), (.22, .22, .4), graphite, .02)
    finish(r)


def make_cloud():
    r = root("Cloud")
    # Polished, integrated cloud volume; recognisable from the scene camera.
    pieces = []
    for pos, scale in [((-.45, 0, .37), (.39, .32, .37)), ((0, 0, .55), (.54, .37, .55)),
                        ((.51, 0, .33), (.34, .3, .32)), ((0, 0, .24), (.65, .31, .24))]:
        pieces.append(ball(pos, scale, ceramic, 24, 16))
    bpy.ops.object.select_all(action="DESELECT")
    for obj in pieces:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    active = pieces[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    m = active.modifiers.new("Fused cloud casing", "REMESH")
    m.mode, m.voxel_size, m.use_smooth_shade = "VOXEL", .025, True
    m.adaptivity = .12
    bpy.ops.object.modifier_apply(modifier=m.name)
    dec = active.modifiers.new("Lightweight cloud", "DECIMATE")
    dec.ratio = .4
    bpy.ops.object.modifier_apply(modifier=dec.name)
    PARTS.clear(); PARTS.append(active)
    box((0, -.327, .34), (.39, .027, .14), graphite, .055)
    for x in (-.1, 0, .1):
        led(x, -.344, .34, cyan, .016)
    finish(r)


def make_rack():
    r = root("ServerRack")
    box((0, 0, .91), (1.05, .87, 1.82), graphite, .045)
    box((0, -.446, .91), (.91, .035, 1.66), recess, .018)
    for x in (-.48, .48):
        box((x, -.472, .91), (.045, .06, 1.73), titanium, .01)
    for z in (.24, .54, .84, 1.14, 1.51):
        h = .23 if z < 1.4 else .24
        box((0, -.485, z), (.84, .065, h), aluminum if z > 1.4 else titanium, .012)
        if z > 1.4:
            for x in range(6):
                port(-.31 + x * .122, -.526, z, .08)
        else:
            for x in (-.21, .21):
                box((x, -.523, z), (.36, .025, .14), graphite, .006)
                for n in range(6):
                    box((x - .12 + n * .045, -.539, z), (.022, .009, .09), recess, .002)
            led(.34, -.53, z + .077, green, .009)
        for x in (-.38, .38):
            screw(x, -.529, z)
    for z in range(11):
        box((.531, 0, .45 + z * .08), (.01, .51, .025), recess, .004)
    for x in (-.34, .34):
        for y in (-.27, .27):
            cyl((x, y, .035), .055, .07, rubber)
    finish(r)


def make_laptop():
    r = root("Laptop")
    box((0, -.1, .045), (1.23, .83, .09), aluminum, .04)
    box((0, -.08, .093), (1.08, .5, .009), graphite, .018)
    for row in range(4):
        for col in range(11):
            box((-.47 + col * .094, -.1 + row * .083, .105), (.067, .054, .014), rubber, .005)
    box((0, -.358, .1), (.36, .15, .009), titanium, .015)
    # Upright back panel is subtly tilted rearward, as a product model.
    box((0, .29, .49), (1.23, .055, .78), graphite, .035, (-.13, 0, 0))
    box((0, .254, .49), (1.12, .012, .67), screen, .02, (-.13, 0, 0))
    box((-.34, .238, .64), (.31, .008, .14), cyan, .009, (-.13, 0, 0))
    for i in range(4):
        box((.16, .224 + i * .012, .63 - i * .09), (.42 - i * .06, .008, .022), titanium, .005)
    for i in range(7):
        box((-.4 + i * .12, .212, .34), (.058, .008, .06 + (i % 3) * .04), cyan, .004)
    finish(r)


def make_sensor():
    r = root("Sensor")
    box((0, 0, .36), (.5, .36, .72), ceramic, .065)
    box((0, -.182, .42), (.37, .025, .43), graphite, .035)
    cyl((0, -.206, .45), .12, .025, titanium, FRONT, 24)
    ball((0, -.229, .45), (.083, .03, .083), screen)
    led(0, -.201, .16, green, .022)
    for x in (-.135, -.09, -.045, 0, .045, .09, .135):
        box((x, -.187, .65), (.015, .013, .055), recess, .003)
    finish(r)


def make_desk_phone():
    r = root("DeskPhone")
    box((0, 0, .075), (1.02, .82, .15), graphite, .055)
    box((0, .015, .21), (.96, .77, .17), titanium, .045, (.19, 0, 0))
    box((.17, .18, .343), (.43, .25, .025), graphite, .025, (.19, 0, 0))
    box((.17, .18, .359), (.36, .19, .012), screen, .012, (.19, 0, 0))
    for i in range(3):
        box((.15, .15 + i * .045, .369 + i * .009), (.23 - i * .035, .012, .006), cyan, .003)
    for row in range(4):
        for col in range(3):
            y = -.27 + row * .085
            box((.07 + col * .1, y, .302 + y * .19), (.067, .054, .023), rubber, .009, (.19, 0, 0))
            box((.07 + col * .1, y, .315 + y * .19), (.018, .015, .003), white, .002, (.19, 0, 0))
    # The lifted bridge and two oval earpieces read as a handset at small scale.
    cable([(-.31, -.28, .30), (-.31, -.13, .40), (-.31, .14, .46), (-.31, .31, .40)], .048, aluminum)
    for y, z in ((-.28, .30), (.31, .41)):
        box((-.31, y, z), (.24, .19, .13), aluminum, .06, (.19, 0, 0))
        box((-.31, y - .015, z + .07), (.17, .13, .025), rubber, .035, (.19, 0, 0))
        for x in (-.35, -.31, -.27):
            box((x, y - .015, z + .084), (.009, .07, .003), recess, .002, (.19, 0, 0))
    cable([(-.42, -.31, .29), (-.56, -.38, .21), (-.59, .07, .15), (-.48, .17, .19)], .012, recess)
    finish(r)


def make_lock():
    r = root("Lock")
    box((0, 0, .64), (.43, .22, 1.28), graphite, .05)
    box((0, -.119, .87), (.32, .025, .58), screen, .025)
    for row in range(3):
        for col in range(3):
            led((col - 1) * .075, -.138, .74 + row * .11, white, .014)
    cyl((0, -.142, .42), .105, .09, aluminum, FRONT)
    bar((0, -.21, .42), (.37, -.21, .42), .045, silver, 20)
    led(0, -.126, 1.19, cyan, .015)
    finish(r)


def make_thermostat():
    r = root("Thermostat")
    cyl((0, 0, .36), .36, .18, aluminum, FRONT, 48)
    cyl((0, -.098, .36), .31, .02, recess, FRONT, 48)
    cyl((0, -.112, .36), .283, .02, screen, FRONT, 48)
    # Seven-segment 22 display, created as proper emissive inlay geometry.
    for cx in (-.09, .09):
        for z in (.48, .36, .24):
            box((cx, -.127, z), (.105, .007, .018), cyan, .004)
        for x, z in ((cx + .047, .422), (cx - .047, .30)):
            box((x, -.127, z), (.018, .007, .10), cyan, .004)
    led(.21, -.127, .51, white, .012)
    finish(r)


def make_light():
    r = root("Light")
    cyl((0, 0, .035), .23, .07, graphite)
    cyl((0, 0, .49), .023, .86, titanium, sides=16)
    cyl((0, 0, .91), .11, .13, aluminum, sides=24, top=.08)
    ball((0, 0, 1.11), (.21, .21, .24), white, 24, 16)
    cyl((0, 0, .98), .14, .07, ceramic, sides=24, top=.18)
    finish(r)


def make_hvac():
    r = root("HVAC")
    for x in (-.48, .48):
        box((x, 0, .065), (.18, .82, .13), titanium, .015)
    box((0, 0, .67), (1.36, .83, 1.12), ceramic, .045)
    box((0, -.429, .68), (1.23, .025, .94), graphite, .015)
    cyl((-.18, -.455, .71), .38, .03, recess, FRONT, 40)
    for x in range(-6, 7):
        xx = x * .052
        length = 2 * math.sqrt(max(0, .35 ** 2 - xx ** 2))
        box((-.18 + xx, -.526, .71), (.009, .008, length), silver, .003)
    for z in (.5, .71, .92):
        box((-.18, -.532, z), (.57, .008, .009), silver, .003)
    for z in range(12):
        box((.53, -.448, .29 + z * .064), (.13, .018, .022), recess, .003)
    for z in range(13):
        box((.687, .015, .28 + z * .06), (.012, .56, .022), recess, .003)
    led(.51, -.465, 1.08, green)
    finish(r)
    # Actual rotor rotates behind the fixed protective grille, around glTF +Z.
    rotor = subgroup("HVACFan", r)
    for a in range(7):
        angle = a * 2 * PI / 7
        obj = box((-.18 + math.sin(angle) * .19, -.478, .71 + math.cos(angle) * .19),
                  (.12, .028, .3), titanium, .03)
        obj.rotation_euler.y = -angle + .35
    cyl((-.18, -.5, .71), .085, .04, aluminum, FRONT)
    finish(rotor)
    set_group_pivot(rotor, (-.18, -.478, .71))


def make_cooler():
    r = root("Cooler")
    box((0, .04, 1.0), (1.29, .75, 2), graphite, .035)
    # Lighter interior and shelves are visible through the glazing.
    box((0, -.346, 1.04), (1.15, .025, 1.53), recess, .01)
    for x in (-.58, .58):
        box((x, -.38, 1.04), (.035, .09, 1.56), aluminum, .008)
        box((x * .93, -.402, 1.04), (.012, .012, 1.43), cyan, .003)
    for z in (.35, .70, 1.05, 1.4):
        box((0, -.379, z), (1.08, .055, .025), silver, .005)
        for x in (-.43, -.27, -.11, .11, .27, .43):
            cyl((x, -.381, z + .10), .043, .17, ceramic if z < 1 else titanium, sides=12)
            cyl((x, -.381, z + .193), .025, .02, amber, sides=12)
    box((0, -.348, 1.92), (.49, .02, .08), screen, .009)
    screen_lines(.02, -.365, 1.943, .2)
    for x in range(15):
        box((-.52 + x * .074, -.347, .105), (.03, .018, .1), recess, .003)
    finish(r)
    for x, name, hinge in ((-.3, "CoolerLeftDoor", -.578), (.3, "CoolerRightDoor", .578)):
        door = subgroup(name, r)
        box((x, -.43, 1.04), (.55, .025, 1.53), glass, .012)
        for dx in (-.278, .278):
            box((x + dx, -.45, 1.04), (.025, .04, 1.56), aluminum, .006)
        for z in (.26, 1.82):
            box((x, -.45, z), (.57, .04, .032), aluminum, .007)
        handle = -.065 if x < 0 else .065
        bar((handle, -.51, .91), (handle, -.51, 1.26), .018, silver)
        for z in (.91, 1.26):
            bar((handle, -.45, z), (handle, -.51, z), .013, silver)
        finish(door)
        set_group_pivot(door, (hinge, -.45, .26))


def make_meter():
    r = root("Meter")
    box((0, 0, .53), (.72, .33, 1.06), ceramic, .06)
    box((0, -.177, .68), (.54, .025, .34), graphite, .02)
    box((0, -.192, .7), (.43, .012, .2), screen, .015)
    screen_lines(.015, -.203, .75, .28)
    for x in (-.15, 0, .15):
        cyl((x, -.185, .37), .042, .02, titanium, FRONT, 16)
    for x in (-.18, -.06, .06, .18):
        box((x, -.16, .10), (.07, .06, .09), amber, .006)
    led(.22, -.182, .94, green, .014)
    finish(r)


def make_camera():
    r = root("Camera")
    cyl((0, .08, .035), .25, .07, aluminum)
    bar((0, .08, .07), (0, .08, .43), .05, titanium, 16)
    ball((0, .08, .43), (.085, .085, .085), graphite, 16, 10)
    box((0, -.13, .55), (.43, .77, .34), ceramic, .05)
    box((0, -.528, .55), (.36, .035, .27), graphite, .04)
    cyl((0, -.555, .55), .103, .04, titanium, FRONT, 28)
    cyl((0, -.58, .55), .08, .016, screen, FRONT, 28)
    ball((-.018, -.59, .57), (.027, .006, .027), cyan, 12, 8)
    for x in (-.137, .137):
        led(x, -.555, .55, recess, .023)
    box((0, -.16, .75), (.5, .81, .05), aluminum, .025)
    finish(r)


def make_person(name="Person", fallen=False):
    r = root(name)
    # Neutral faceless safety mannequin: articulated, anatomical proportions.
    # Metallic surfaces retain the visual language without impersonating a person.
    ball((0, 0, 1.55), (.108, .101, .145), ceramic, 20, 14)
    cyl((0, 0, 1.385), .047, .08, titanium, sides=16)
    ball((0, 0, 1.19), (.20, .105, .23), titanium, 20, 14)
    ball((0, 0, .935), (.145, .097, .14), graphite, 20, 12)
    for side in (-1, 1):
        shoulder = (side * .19, 0, 1.3)
        elbow = (side * .27, -.015, 1.07)
        wrist = (side * .30, -.07, .86)
        bar(shoulder, elbow, .052, ceramic, 16, .042)
        ball(elbow, (.044, .044, .044), titanium, 12, 8)
        bar(elbow, wrist, .041, ceramic, 16, .029)
        ball((side * .30, -.07, .825), (.032, .026, .055), ceramic, 12, 8)
        hip = (side * .09, 0, .91)
        knee = (side * .11, -.015, .51)
        ankle = (side * .12, .015, .12)
        bar(hip, knee, .071, titanium, 16, .05)
        ball(knee, (.052, .05, .052), graphite, 12, 8)
        bar(knee, ankle, .049, ceramic, 16, .032)
        box((side * .12, -.055, .055), (.10, .23, .11), graphite, .04)
    box((0, -.107, 1.23), (.12, .012, .025), cyan, .006)
    finish(r)
    if fallen:
        # Rotate child meshes, then shift to floor; root remains at identity.
        for obj in r.children:
            for v in obj.data.vertices:
                x, y, z = v.co
                v.co = (z - .85, -x, -y)
        low = min(v.co.z for obj in r.children for v in obj.data.vertices)
        for obj in r.children:
            for v in obj.data.vertices:
                v.co.z -= low


def make_solar():
    r = root("SolarPanel")
    tilt = -.32
    # Tilted silicon cells in a real aluminum frame, with a rear support.
    panel = subgroup("SolarArray", r)
    box((0, 0, 0), (1.54, .08, 1.05), aluminum, .025)
    box((0, -.047, 0), (1.44, .018, .95), recess, .006)
    for row in range(4):
        for col in range(6):
            x, z = -.595 + col * .238, -.345 + row * .23
            box((x, -.062, z), (.221, .012, .214), solar, .007)
            for dx in (-.055, .055):
                box((x + dx, -.071, z), (.004, .005, .199), aluminum, .001)
    finish(panel)
    panel.rotation_euler.x = tilt
    panel.location.z = .72
    for x in (-.55, .55):
        box((x, .12, .04), (.18, .74, .08), titanium, .012)
        bar((x, .35, .08), (x, .1, .97), .025, aluminum)
        bar((x, -.19, .08), (x, -.1, .37), .025, aluminum)
    finish(r)


for fn in (make_gateway, make_fiber, make_tower, make_cloud, make_rack,
           make_laptop, make_sensor, make_lock, make_thermostat, make_light,
           make_hvac, make_cooler, make_meter, make_camera, make_person, make_solar, make_desk_phone):
    fn()
make_person("FallenPerson", True)

bpy.context.view_layer.update()


def descendants(obj):
    for child in obj.children:
        if child.type == "MESH":
            yield child
        yield from descendants(child)


def bounds(obj):
    points = [o.matrix_world @ Vector(p) for o in descendants(obj) for p in o.bound_box]
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    return low, high


# Precisely ground each root, preserving the root/subgroup transform contract.
for obj in ROOTS.values():
    low, high = bounds(obj)
    for child in obj.children:
        child.location.z -= low.z
bpy.context.view_layer.update()

manifest = {"format": "GLB / glTF 2.0", "up": "+Y", "front": "+Z", "units": "meters (illustrative equipment scale)",
            "origin": "each prefab root is identity at origin; minimum Y is zero", "prefabs": {},
            "articulation": {
                "HVACFan": {"parent": "HVAC", "pivot": [-.18, .71, .478], "axis": "Z", "motion": "continuous rotor rotation"},
                "CoolerLeftDoor": {"parent": "Cooler", "pivot": [-.578, .26, .45], "axis": "Y", "openRadians": -1.05},
                "CoolerRightDoor": {"parent": "Cooler", "pivot": [.578, .26, .45], "axis": "Y", "openRadians": 1.05},
            }}
for name, obj in ROOTS.items():
    lo, hi = bounds(obj)
    size = hi - lo
    manifest["prefabs"][name] = {
        "size": [round(size.x, 4), round(size.z, 4), round(size.y, 4)],
        "min": [round(lo.x, 4), round(lo.z, 4), round(-hi.y, 4)],
        "max": [round(hi.x, 4), round(hi.z, 4), round(-lo.y, 4)],
        "groups": [c.name for c in obj.children if c.type == "EMPTY"],
        "triangles": sum(len(p.vertices) - 2 for o in descendants(obj) for p in o.data.polygons),
        "meshes": len(list(descendants(obj))),
    }
(OUT / "offerings-kit.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

bpy.ops.object.select_all(action="DESELECT")
for obj in ROOTS.values():
    obj.select_set(True)
    for child in obj.children_recursive:
        child.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT / "offerings-kit.glb"), export_format="GLB",
                         use_selection=True, export_yup=True, export_materials="EXPORT",
                         export_extras=True, export_cameras=False, export_lights=False)
print("PREFABS_EXPORTED", json.dumps({k: v["size"] for k, v in manifest["prefabs"].items()}), flush=True)

# Proof render: same geometry and materials as the runtime, studio illumination.
order = list(ROOTS)
for index, name in enumerate(order):
    obj = ROOTS[name]
    col, row = index % 5, index // 5
    obj.location = ((col - 2) * 3.0, row * 3.5, 0)
    obj.rotation_euler.z = -.17
    bpy.ops.object.text_add(location=((col - 2) * 3.0 - .8, row * 3.5 - 1.18, .015))
    label = bpy.context.object
    label.data.body = name
    label.data.size, label.data.extrude = .18, .0001
    label.data.materials.append(white)

floor = mat("Studio floor - proof only", "182431", .12, .5)
box((0, 5, -.12), (60, 60, .2), floor, .005)
PARTS.clear()

world = bpy.data.worlds.new("Neutral studio")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (.18, .23, .29, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = .32
scene.world = world


def area(name, pos, energy, size, target, color=(1, 1, 1), shape="DISK", size_y=None):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.shape, data.size, data.color = energy, shape, size, color
    if size_y is not None:
        data.size_y = size_y
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = pos
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


area("Long softbox", (-6, -3, 10), 2600, 9, (0, 5, 0), (0.88, .95, 1))
area("Silver edge strip", (8, 8, 9), 3000, 7, (0, 5, 0), (1, .95, .86))
area("Broad overhead", (-1, 12, 12), 2200, 10, (0, 5, 0))
area("Front fill", (1, -9, 5), 1400, 8, (0, 5, 0))
bpy.ops.object.camera_add(location=(5.6, -13.5, 18.5))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 4.7, .2)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.type, camera.data.ortho_scale = "ORTHO", 17.8
scene.camera = camera
scene.render.engine = "CYCLES"
scene.cycles.samples = 40
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1600, 1500, 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(OUT / "offerings-kit-proof.png")
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
bpy.ops.render.render(write_still=True)
print("KIT_COMPLETE", (OUT / "offerings-kit.glb").stat().st_size, flush=True)
