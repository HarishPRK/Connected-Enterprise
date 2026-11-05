"""Original articulated retail people and story props; Blender 4.5, no downloads.

blender -b --factory-startup --python-exit-code 1 --python scripts/blender/enterprise_actors.py
Coordinates are Three.js/glTF: +Y up, +Z front. Rigid semantic joints preserve
meaningful anatomical pivots for runtime animation from a shared absolute clock.
"""
import bmesh
import bpy
import json
import math
import struct
import sys
from collections import defaultdict
from pathlib import Path
from mathutils import Vector

OUT = (Path(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else
       Path(__file__).resolve().parents[2] / "src/assets/offerings")
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
PARTS = []
PART = "Hips"
ROOTS = {}
RIGS = {}


def V(p):
    return Vector((p[0], -p[2], p[1]))


def mat(name, color, rough=.72, metal=0, emission=0):
    rgb = [v / 255 for v in bytes.fromhex(color)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*rgb, 1)
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Metallic"].default_value = metal
    if emission:
        bs.inputs["Emission Color"].default_value = (*rgb, 1)
        bs.inputs["Emission Strength"].default_value = emission
    return m


rubber = mat("Soft black rubber", "202a30", .85)
steel = mat("Brushed buckle steel", "9aa8aa", .32, .72)
white = mat("Warm white paper and trim", "e0e2d7", .65)
graphite = mat("Graphite device casing", "2b3b46", .42, .3)
glass = mat("Dark display glass", "112f3c", .18, .15)
screen = mat("Sky blue display details", "78d5ed", .3, .04, .25)
amber = mat("Safety amber details", "dfae63", .5)
red = mat("Beacon lens", "d76f54", .25, .05, .4)
green = mat("Product sage", "82a88a", .65)
orange = mat("Product warm orange", "d99d59", .68)
blue = mat("Basket slate blue", "3d7d91", .5, .06)


def reg(obj, name, material):
    obj.name = name
    obj.data.materials.append(material)
    PARTS.append((obj, PART, material))
    return obj


def soft(obj, width=.01, segments=2):
    if width:
        bevel = obj.modifiers.new("Soft tailored edge", "BEVEL")
        bevel.width, bevel.segments = width, segments
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=bevel.name)
    for p in obj.data.polygons:
        p.use_smooth = True
    normals = obj.modifiers.new("Tailored normals", "WEIGHTED_NORMAL")
    normals.keep_sharp = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=normals.name)


def box(name, p, size, material, bevel=.008, rotation=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=V(p))
    obj = bpy.context.object
    obj.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    reg(obj, name, material)
    soft(obj, min(bevel, min(size) * .32))
    if rotation:
        # Euler values supplied in Three coordinates; use this only for local X.
        obj.rotation_euler = (rotation[0], -rotation[2], rotation[1])
    return obj


def sphere(name, p, scale, material, segments=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=V(p))
    obj = bpy.context.object
    obj.scale = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    reg(obj, name, material)
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def cyl(name, p, radius, depth, material, axis=(0, 1, 0), sides=12, top=None):
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=radius,
                                    radius2=radius if top is None else top,
                                    depth=depth, location=V(p))
    obj = bpy.context.object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(V(axis).normalized())
    reg(obj, name, material)
    for face in obj.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    return obj


def tube(name, points, radius, material):
    c = bpy.data.curves.new(name, "CURVE")
    c.dimensions, c.resolution_u = "3D", 4
    c.bevel_depth, c.bevel_resolution = radius, 1
    spl = c.splines.new("BEZIER")
    spl.bezier_points.add(len(points) - 1)
    for a, p in zip(spl.bezier_points, points):
        a.co = V(p)
        a.handle_left_type = a.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, c)
    scene.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    return reg(obj, name, material)


def mesh(name, verts, faces, material):
    data = bpy.data.meshes.new(name)
    data.from_pydata([V(p) for p in verts], [], faces)
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    reg(obj, name, material)
    return obj


def loft(name, x, profile, material, sides=16):
    verts, faces = [], []
    for y, rx, rz, z in profile:
        for i in range(sides):
            a = i * math.tau / sides
            verts.append((x + rx * math.cos(a), y, z + rz * math.sin(a)))
    for j in range(len(profile) - 1):
        for i in range(sides):
            n = (i + 1) % sides
            faces.append((j * sides + i, j * sides + n, (j + 1) * sides + n, (j + 1) * sides + i))
    faces.extend([tuple(reversed(range(sides))), tuple((len(profile) - 1) * sides + i for i in range(sides))])
    obj = mesh(name, verts, faces, material)
    for f in obj.data.polygons:
        f.use_smooth = True
    return obj


def panel(name, outline, z, material):
    verts = [(x, y, z + d) for d in (-.004, .004) for x, y in outline]
    n = len(outline)
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    return mesh(name, verts, faces, material)


PIVOTS = {
    "ActorRoot": (None, (0, 0, 0)),
    "Hips": ("ActorRoot", (0, .90, 0)),
    "Torso": ("Hips", (0, 1.00, 0)),
    "Head": ("Torso", (0, 1.49, 0)),
    "LeftUpperArm": ("Torso", (-.235, 1.38, 0)),
    "LeftForearm": ("LeftUpperArm", (-.265, 1.115, 0)),
    "RightUpperArm": ("Torso", (.235, 1.38, 0)),
    "RightForearm": ("RightUpperArm", (.265, 1.115, 0)),
    "LeftThigh": ("Hips", (-.095, .89, 0)),
    "LeftShin": ("LeftThigh", (-.095, .47, 0)),
    "LeftAnkle": ("LeftShin", (-.095, .075, .055)),
    "RightThigh": ("Hips", (.095, .89, 0)),
    "RightShin": ("RightThigh", (.095, .47, 0)),
    "RightAnkle": ("RightShin", (.095, .075, .055)),
    "TabletMount": ("LeftForearm", (-.265, .79, .09)),
    "Tablet": ("TabletMount", (-.265, .79, .09)),
    "BagMount": ("RightForearm", (.265, .755, .025)),
}


def build_tablet(p=(0, .15, 0), small=False):
    x, y, z = p
    box("Tablet soft enclosure", p, (.21, .30, .03), graphite, .015)
    box("Tablet inset screen", (x, y, z + .019), (.177, .253, .006), glass, .01)
    for i, width in enumerate((.125, .09, .105)):
        box("Tablet interface line", (x - .006, y + .075 - i * .033, z + .024), (width, .009, .003), screen, .001)
    box("Tablet status tile", (x, y - .074, z + .024), (.12, .032, .003), blue, .002)
    sphere("Tablet front camera", (x, y + .138, z + .018), (.006, .006, .002), rubber, 8, 6)


def build_actor(role):
    global PART
    settings = {
        "Customer": ("a5774e", "334b62", "b98461", "302921", "d5d3c6"),
        "Staff": ("274d68", "37434d", "aa765a", "222927", "303c42"),
        "Technician": ("4c7478", "4e5659", "d4aa88", "695044", "383c3c"),
        "Security": ("324356", "26313a", "785440", "1e2226", "222c30"),
    }
    shirtc, pantsc, skinc, hairc, shoec = settings[role]
    shirt = mat(role + " tailored shirt", shirtc, .89)
    pants = mat(role + " woven trousers", pantsc, .93)
    skin = mat(role + " skin", skinc, .71)
    hair = mat(role + " hair", hairc, .91)
    shoes = mat(role + " shoes", shoec, .7)
    seam = mat(role + " fabric seams", "273841" if role != "Customer" else "79583e", .92)
    inner = mat(role + " collar inner", "bbd1ca" if role == "Customer" else "a4b8ba", .9)
    lip = mat(role + " natural lip tone", "895544" if role != "Security" else "624032", .82)
    PART = "Hips"
    loft("Tailored hips", 0, [(.835,.135,.087,0),(.88,.16,.105,0),(.965,.163,.105,0),(1.015,.15,.095,0)], pants)
    loft("Leather belt", 0, [(.969,.165,.108,0),(.993,.163,.108,0)], rubber)
    box("Belt buckle", (0,.981,.111), (.042,.026,.012), steel, .004)
    for x in (-.12,.12):
        box("Belt loop", (x,.985,.091), (.019,.05,.014), pants, .003)
    if role in ("Technician", "Security"):
        box("Belt utility pouch", (.17,.90,.025), (.065,.14,.095), rubber, .012)
        box("Pouch flap", (.20,.95,.029), (.027,.035,.102), seam, .005)
    PART = "Torso"
    loft("Soft tailored torso", 0, [(1.0,.151,.095,0),(1.09,.164,.111,0),(1.23,.184,.124,0),
                                    (1.355,.213,.115,-.004),(1.41,.202,.106,-.006),(1.46,.108,.076,0)], shirt, 20)
    # Folded collar and narrow placket provide a natural, clothed silhouette.
    for s in (-1,1):
        panel("Folded collar", [(s*.018,1.435),(s*.075,1.465),(s*.126,1.422),(s*.065,1.373)], .108, shirt)
        tube("Shoulder seam", [(s*.09,1.455,.07),(s*.172,1.429,.06),(s*.214,1.385,.03)], .0025, seam)
    panel("Neckline undershirt", [(-.046,1.435),(.046,1.435),(.03,1.376),(-.03,1.376)], .107, inner)
    if role == "Customer":
        tube("Bomber jacket zip", [(0,1.02,.102),(0,1.24,.13),(0,1.43,.112)], .0035, steel)
        for s in (-1,1):
            tube("Angled jacket pocket", [(s*.075,1.08,.106),(s*.143,1.19,.104)], .003, seam)
        loft("Ribbed jacket hem",0,[(1.0,.156,.099,0),(1.042,.16,.104,0)],seam)
    else:
        box("Shirt placket", (0,1.27,.128), (.018,.26,.008), shirt, .002)
        for y in (1.16,1.25,1.34):
            cyl("Shirt button", (0,y,.135), .004,.004, white, axis=(0,0,1), sides=8)
        box("Work shirt chest pocket", (.103,1.28,.118), (.087,.09,.012), shirt, .007)
        box("Chest pocket seam", (.103,1.322,.128), (.087,.006,.006), seam, .002)
        box("ID card backing", (-.104,1.30,.132), (.057,.077,.012), graphite, .005)
        box("Staff ID", (-.104,1.30,.14), (.045,.061,.004), white, .001)
        box("ID photo", (-.112,1.31,.143), (.014,.02,.002), blue, .001)
        for y in (1.284,1.29):
            box("ID print", (-.098,y,.143), (.023,.002,.002), seam, .0005)
    if role in ("Staff", "Security"):
        box("Clipped radio", (.17,1.335,.11), (.047,.082,.032), rubber, .006)
        cyl("Radio antenna", (.17,1.405,.11), .004,.06, rubber, sides=8)
        for y in (1.32,1.335,1.35):
            box("Radio grille", (.17,y,.13), (.028,.003,.002), steel, .0005)
    if role == "Technician":
        for s in (-1,1):
            box("Service shirt piping", (s*.14,1.355,.105), (.10,.012,.007), amber, .003)
        box("Service shoulder panel", (.145,1.405,.053), (.11,.025,.09), seam, .006)
    if role == "Security":
        panel("Security badge", [(.07,1.335),(.12,1.335),(.12,1.29),(.095,1.275),(.07,1.29)], .136, steel)
        for s in (-1,1):
            box("Uniform epaulette", (s*.168,1.418,.018), (.095,.015,.07), seam, .004)
    PART = "Head"
    cyl("Neck", (0,1.49,0), .052,.105,skin,sides=16)
    loft("Natural head profile",0,[(1.525,.047,.054,.012),(1.546,.069,.071,.012),(1.585,.09,.083,.006),
                                  (1.64,.101,.087,0),(1.69,.096,.081,-.006),(1.721,.067,.062,-.01)],skin,20)
    sphere("Nose",(0,1.608,.087),(.018,.028,.028),skin,12,8)
    for s in (-1,1):
        sphere("Ear",(s*.102,1.618,-.002),(.018,.033,.018),skin,12,8)
        sphere("Inset eye",(s*.041,1.646,.078),(.012,.006,.004),rubber,10,6)
        tube("Eyebrow",[(s*.026,1.66,.081),(s*.044,1.666,.078),(s*.059,1.661,.073)],.0028,hair)
    tube("Neutral lip",[(-.024,1.565,.078),(0,1.562,.083),(.024,1.565,.078)],.0018,lip)
    # A close-fitting hair shell follows the skull, with a visible hairline and sweep.
    loft("Sculpted hair",0,[(1.675,.102,.086,-.011),(1.705,.104,.087,-.012),
                           (1.737,.079,.065,-.016),(1.75,.025,.023,-.02)],hair,20)
    for s in (-1,1):
        box("Short sideburn",(s*.093,1.659,-.002),(.014,.054,.029),hair,.005)
    if role == "Staff":
        sphere("Hair sweep",(-.04,1.714,.036),(.072,.03,.048),hair,16,8)
    elif role == "Technician":
        for i in range(5):
            sphere("Soft hair texture",(-.064+i*.03,1.73,.008),(.026,.019,.037),hair,10,6)
    elif role == "Customer":
        tube("Hair part",[(-.047,1.706,.061),(-.055,1.736,.011),(-.047,1.713,-.065)],.0025,seam)
    for side,s in (("Left",-1),("Right",1)):
        x=s*.095
        PART=side+"Thigh"
        loft("Contoured trouser thigh",x,[(.465,.067,.075,.006),(.55,.075,.084,0),(.72,.086,.091,-.006),(.89,.083,.087,0)],pants)
        tube("Trouser side seam",[(x+s*.067,.49,.005),(x+s*.087,.70,0),(x+s*.081,.87,0)],.002,seam)
        if role == "Technician":
            box("Cargo pocket",(x+s*.075,.69,.018),(.025,.12,.10),shirt,.008)
            box("Cargo pocket flap",(x+s*.09,.743,.018),(.012,.025,.105),seam,.003)
        PART=side+"Shin"
        loft("Trouser knee and calf",x,[(.12,.056,.062,.008),(.19,.063,.069,0),(.34,.067,.071,-.006),(.47,.067,.075,.006)],pants)
        if role == "Technician":
            sphere("Fabric knee reinforcement",(x,.446,.075),(.060,.074,.013),seam,12,8)
        loft("Trouser cuff",x,[(.115,.061,.064,.007),(.14,.062,.065,.005)],seam)
        PART=side+"Ankle"
        box("Rounded shoe upper",(x,.068,.058),(.139,.10,.246),shoes,.033)
        box("Rubber sole",(x,.015,.058),(.148,.03,.255),white if role=="Customer" else rubber,.009)
        sphere("Shoe ankle",(x,.10,.003),(.058,.052,.069),shoes,12,8)
        for j in range(3):
            tube("Shoe lacing",[(x-.04,.117-j*.009,.04+j*.024),(x,.124-j*.01,.05+j*.024),(x+.04,.117-j*.009,.04+j*.024)],.0025,white if role=="Customer" else seam)
        # Cloth overlaps elbow/knee seams slightly while the named pivots articulate.
        x=s*.265
        PART=side+"UpperArm"
        loft("Tailored sleeve",x,[(1.105,.052,.059,0),(1.20,.061,.067,0),(1.32,.071,.076,0),(1.39,.055,.059,0)],shirt)
        sphere("Soft shoulder cap",(s*.238,1.365,-.002),(.073,.072,.074),shirt,16,10)
        tube("Sleeve shoulder stitch",[(x-s*.055,1.355,.038),(x,1.395,.057),(x+s*.055,1.355,.038)],.0025,seam)
        PART=side+"Forearm"
        loft("Forearm sleeve",x,[(.84,.039,.043,.004),(.9,.044,.049,0),(1.02,.052,.058,0),(1.115,.051,.058,0)],shirt)
        loft("Soft sleeve cuff",x,[(.827,.044,.046,.005),(.862,.044,.047,.004)],seam)
        sphere("Hand palm",(x,.783,.013),(.043,.053,.027),skin,12,8)
        sphere("Thumb",(x-s*.037,.779,.03),(.014,.029,.015),skin,10,6)
        for finger in range(4):
            sphere("Finger",(x-.027+finger*.018,.744,.02),(.010,.026,.014),skin,8,6)
        if side=="Left":
            cyl("Watch band",(x,.845,.006),.046,.018,rubber,sides=16)
            box("Watch face",(x,.845,.052),(.034,.029,.008),glass,.007)
    if role in ("Staff","Technician"):
        PART="Tablet"
        build_tablet((-.265,.79,.09))
    if role == "Technician":
        PART="BagMount"
        build_toolbox((.38,.565,.025),compact=True)
    root=assemble(role,PIVOTS)
    return root


def assemble(name,pivots):
    root=bpy.data.objects.new(name,None)
    scene.collection.objects.link(root)
    ROOTS[name]=root
    joints={}
    for joint,(_,p) in pivots.items():
        obj=bpy.data.objects.new(name+"_"+joint,None)
        scene.collection.objects.link(obj)
        obj.location=V(p)
        joints[joint]=obj
    bpy.context.view_layer.update()
    for joint,(parent,_) in pivots.items():
        obj=joints[joint]
        matrix=obj.matrix_world.copy()
        obj.parent=joints[parent] if parent else root
        obj.matrix_world=matrix
    batches=defaultdict(list)
    for obj,part,material in PARTS:
        batches[(part,material)].append(obj)
    for (part,material),objs in batches.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objs:obj.select_set(True)
        bpy.context.view_layer.objects.active=objs[0]
        if len(objs)>1:bpy.ops.object.join()
        obj=bpy.context.object
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        obj.name=name+"_"+part+"_"+material.name.replace(" ","")
        bpy.context.view_layer.update()
        matrix=obj.matrix_world.copy()
        obj.parent=joints[part]
        obj.matrix_world=matrix
    PARTS.clear()
    RIGS[name]=joints
    return root


def build_toolbox(p=(0,.14,0),compact=False):
    x,y,z=p
    box("Tool case shell",p,(.36,.25,.23),graphite,.022)
    for dx in (-.15,.15):
        box("Tool case reinforced end",(x+dx,y,z),(.035,.25,.24),rubber,.008)
    for dx in (-.105,.105):
        box("Case latch",(x+dx,y+.075,z+.122),(.035,.04,.012),steel,.003)
    tube("Carry handle",[(x-.09,y+.125,z),(x-.075,y+.18,z),(x+.075,y+.18,z),(x+.09,y+.125,z)],.012,rubber)
    box("Service case label",(x,y,z+.121),(.11,.046,.005),amber,.003)


def prop_start():
    global PART
    PART="Body"


def make_payment_terminal():
    global PART
    prop_start()
    box("Terminal rounded foot",(0,.025,0),(.27,.05,.25),graphite,.023)
    cyl("Terminal support",(0,.115,-.02),.035,.16,steel,sides=16)
    box("Reader main body",(0,.25,.01),(.24,.31,.065),graphite,.025,(-.30,0,0))
    box("Reader front surround",(0,.252,.047),(.215,.285,.008),rubber,.015,(-.30,0,0))
    PART="Display"
    box("Payment screen",(0,.325,.032),(.18,.115,.012),glass,.01,(-.30,0,0))
    for y,w in ((.349,.11),(.324,.078),(.303,.12)):
        box("Terminal display line",(0,y,.046+(y-.325)*.30),(w,.009,.003),screen,.001)
    PART="Body"
    for row in range(3):
        for col in range(3):
            y=.17+row*.033
            box("Reader tactile key",((col-1)*.052,y,.072+(.23-y)*.30),(.038,.025,.012),white,.005,(-.30,0,0))
    box("Confirm key",(.054,.135,.108),(.04,.018,.01),green,.004)
    box("Cancel key",(-.054,.135,.108),(.04,.018,.01),red,.004)
    PART="TapZone"
    for i in range(3):
        radius=.014+i*.011
        pts=[(math.cos(a)*radius,.397+math.sin(a)*radius,.006) for a in (.3,.7,1.1,1.5)]
        tube("Contactless wave",pts,.0025,screen)
    assemble("PaymentTerminal",{"Body":(None,(0,0,0)),"Display":("Body",(0,.325,.04)),"TapZone":("Body",(0,.397,.006))})


def make_receipt_printer():
    global PART
    prop_start()
    box("Printer base",(0,.018,0),(.36,.036,.30),rubber,.017)
    box("Receipt printer case",(0,.125,0),(.35,.22,.29),graphite,.027)
    box("Paper roll cover",(0,.231,-.035),(.32,.025,.19),steel,.01)
    box("Printer outlet",(0,.221,.119),(.24,.019,.017),rubber,.004)
    box("Feed button",(.125,.208,.14),(.036,.018,.01),blue,.006)
    box("Printer indicator",(.124,.185,.147),(.013,.009,.004),screen,.002)
    PART="Receipt"
    box("Thermal receipt paper",(0,.352,.124),(.205,.26,.002),white,.0004)
    for i,width in enumerate((.12,.16,.13,.17,.11)):
        box("Receipt print line",(-.008,.454-i*.025,.126),(width,.005,.001),graphite,.0003)
    for i in range(14):
        box("Receipt barcode",(-.07+i*.0105,.275,.126),(.003 if i%3 else .006,.031,.001),graphite,0)
    assemble("ReceiptPrinter",{"Body":(None,(0,0,0)),"Receipt":("Body",(0,.222,.124))})


def make_basket():
    global PART
    prop_start()
    box("Basket base",(0,.025,0),(.44,.05,.31),blue,.015)
    for z in (-.155,.155):
        box("Basket top long rim",(0,.255,z),(.46,.035,.035),blue,.009)
        for x in (-.19,-.14,-.09,-.04,.01,.06,.11,.16,.20):
            box("Basket open vertical slat",(x,.14,z),(.022,.22,.018),blue,.004)
    for x in (-.22,.22):
        box("Basket top short rim",(x,.255,0),(.035,.035,.31),blue,.009)
        for z in (-.12,-.06,0,.06,.12):
            box("Basket end slat",(x,.14,z),(.018,.22,.023),blue,.004)
    for z in (-.14,.14):
        tube("Basket folding handle",[(-.20,.25,z),(-.18,.45,z*.4),(0,.51,0),(.18,.45,z*.4),(.20,.25,z)],.012,rubber)
    box("Grocery carton",(-.09,.18,-.04),(.14,.29,.15),orange,.008)
    box("Carton label",(-.09,.19,.038),(.09,.11,.006),white,.002)
    cyl("Basket bottle",(.10,.16,.035),.061,.25,green,sides=12,top=.05)
    cyl("Bottle closure",(.10,.30,.035),.027,.045,white,sides=12)
    assemble("ShoppingBasket",{"Body":(None,(0,0,0)),"Grip":("Body",(0,.51,0))})


def make_beacon():
    global PART
    prop_start()
    cyl("Beacon mounting foot",(0,.024,0),.12,.048,graphite,sides=24)
    cyl("Beacon collar",(0,.07,0),.10,.055,steel,sides=24)
    PART="Lens"
    cyl("Beacon translucent colored shell",(0,.16,0),.092,.13,red,sides=24,top=.085)
    sphere("Beacon rounded dome",(0,.225,0),(.085,.035,.085),red,20,10)
    for y in (.135,.18):
        cyl("Beacon lens ridge",(0,y,0),.096,.011,red,sides=24)
    assemble("AlertBeacon",{"Body":(None,(0,0,0)),"Lens":("Body",(0,.16,0))})


for role in ("Customer","Staff","Technician","Security"):
    build_actor(role)
make_payment_terminal()
make_receipt_printer()
make_basket()
prop_start();build_tablet();assemble("Tablet",{"Body":(None,(0,0,0))})
prop_start();build_toolbox((0,.125,0));assemble("Toolbox",{"Body":(None,(0,0,0))})
make_beacon()
bpy.context.view_layer.update()


def bounds(root):
    pts=[obj.matrix_world@Vector(v) for obj in root.children_recursive if obj.type=="MESH" for v in obj.bound_box]
    lo=[min(p[i] for p in pts) for i in range(3)]
    hi=[max(p[i] for p in pts) for i in range(3)]
    return [round(lo[0],5),round(lo[2],5),round(-hi[1],5)], [round(hi[0],5),round(hi[2],5),round(-lo[1],5)]


manifest={"up":"+Y","front":"+Z","units":"meters","roots":{},"rigNaming":"Role_Joint; e.g. Customer_LeftForearm","pivotWorld":PIVOTS,
          "animation":"Rigid semantic pivots. Negative local X lifts arms forward; knees flex with positive X. Preserve original joint positions. No baked animations or armature required."}
for name,root in ROOTS.items():
    lo,hi=bounds(root)
    manifest["roots"][name]={"min":lo,"max":hi,"size":[round(hi[i]-lo[i],5) for i in range(3)],"joints":[o.name for o in root.children_recursive if o.type=="EMPTY"]}
bpy.ops.object.select_all(action="DESELECT")
for root in ROOTS.values():
    root.select_set(True)
    for obj in root.children_recursive:obj.select_set(True)
path=OUT/"enterprise-actors.glb"
bpy.ops.export_scene.gltf(filepath=str(path),export_format="GLB",use_selection=True,export_yup=True,
                         export_texcoords=False,export_materials="EXPORT",export_cameras=False,export_lights=False)
raw=path.read_bytes();g=json.loads(raw[20:20+struct.unpack_from("<I",raw,12)[0]])
manifest["bytes"]=len(raw)
manifest["triangles"]=sum(g["accessors"][p["indices"]]["count"]//3 for m in g["meshes"] for p in m["primitives"])
manifest["meshes"]=len(g["meshes"])
(OUT/"enterprise-actors.manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
print("ACTORS_EXPORTED",json.dumps({"bytes":manifest["bytes"],"triangles":manifest["triangles"],"roots":list(ROOTS)}),flush=True)

# Proof: relaxed natural poses; this staging never enters the exported GLB.
for i,name in enumerate(("Customer","Staff","Technician","Security")):
    root=ROOTS[name]
    root.location=V(((i-1.5)*1.3,0,0))
    root.rotation_euler.z=.12 if i%2 else -.10
    rig=RIGS[name]
    if name in ("Staff","Technician"):
        rig["LeftUpperArm"].rotation_euler.x=-.30
        rig["LeftForearm"].rotation_euler.x=-1.12
        rig["RightUpperArm"].rotation_euler.x=-.21
        rig["RightForearm"].rotation_euler.x=-.84 if name=="Staff" else -.15
    elif name=="Customer":
        rig["RightUpperArm"].rotation_euler.x=-.17
        rig["RightForearm"].rotation_euler.x=-.36
    else:
        rig["Head"].rotation_euler.z=.08
    rig["Head"].rotation_euler.x=.04
for i,name in enumerate(("PaymentTerminal","ReceiptPrinter","ShoppingBasket","Tablet","Toolbox","AlertBeacon")):
    ROOTS[name].location=V(((i-2.5)*.8,0,1.65))
    ROOTS[name].rotation_euler.z=-.15
floor=mat("Proof studio floor","263744",.6)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.006));bpy.context.object.data.materials.append(floor)
world=bpy.data.worlds.new("Actor studio")
world.use_nodes=True
world.node_tree.nodes["Background"].inputs["Color"].default_value=(.19,.23,.29,1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value=.35
scene.world=world
for pos,power,size,color in [((-4,6,4),900,5,(.91,.96,1)),((5,4,-2),700,4,(1,.90,.80)),((0,4,5),450,4,(1,1,1))]:
    bpy.ops.object.light_add(type="AREA",location=V(pos));o=bpy.context.object
    o.data.energy,o.data.shape,o.data.size,o.data.color=power,"DISK",size,color
    o.rotation_euler=(V((0,.8,0))-o.location).to_track_quat("-Z","Y").to_euler()
bpy.ops.object.camera_add(location=V((3.0,2.7,7.5)))
camera=bpy.context.object
camera.rotation_euler=(V((0,.85,.55))-camera.location).to_track_quat("-Z","Y").to_euler()
camera.data.type,camera.data.ortho_scale="ORTHO",6.45
scene.camera=camera
scene.render.engine="CYCLES"
scene.cycles.samples,scene.cycles.use_denoising=40,True
scene.render.resolution_x,scene.render.resolution_y,scene.render.resolution_percentage=1800,1200,100
scene.view_settings.view_transform="AgX"
scene.view_settings.look="AgX - Medium High Contrast"
scene.render.image_settings.file_format="PNG"
scene.render.filepath=str(OUT/"enterprise-actors-proof.png")
bpy.ops.render.render(write_still=True)
print("ACTORS_COMPLETE",manifest["bytes"],flush=True)
