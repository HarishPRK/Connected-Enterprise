"""Create the illustrative Dell-style edge analytics appliance, Blender 4.5.

Run from the repository: blender -b --factory-startup --python scripts/blender/offerings_analytics.py
The camera ingest ports and uplink coordinates are also exported for cable routing.
"""
import json
import math
from pathlib import Path
import bpy
from mathutils import Vector

OUT = Path(__file__).resolve().parents[2] / 'src/assets/offerings'
bpy.ops.wm.read_factory_settings(use_empty=True)

def material(name, color, metal=0, rough=.4, glow=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    rgb = [int(color[i:i+2], 16)/255 for i in (0, 2, 4)]
    linear = [v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    p.inputs['Base Color'].default_value = (*linear, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    p.inputs['Emission Color'].default_value = (*linear, 1)
    p.inputs['Emission Strength'].default_value = glow
    return mat

shell = material('Analytics graphite aluminum', '3b424a', .7, .32)
black = material('Analytics rubber and vents', '101920', .05, .65)
silver = material('Analytics brushed alloy', 'a2b0ba', .85, .27)
blue = material('Analytics blue status', '42bdf4', .1, .25, 2.5)
green = material('Analytics link status', '86dfae', .05, .3, 1.6)
gold = material('Analytics contact gold', 'd6b47b', .8, .28)
white = material('Analytics silkscreen', 'd6e2e7', .1, .5)
root = bpy.data.objects.new('AnalyticsServer', None)
bpy.context.scene.collection.objects.link(root)

def box(name, at, size, mat, bevel=.005):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Machined edge', 'BEVEL')
        mod.width = min(bevel, min(size)*.3)
        mod.segments = 3
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.materials.append(mat)
    obj.parent = root
    return obj

def text(label, at, height):
    bpy.ops.object.text_add(location=at, rotation=(math.pi/2, 0, 0))
    obj=bpy.context.object
    obj.data.body=label
    obj.data.align_x='CENTER'
    obj.data.size=height
    obj.data.extrude=.0002
    obj.data.materials.append(white)
    obj.parent=root
    bpy.ops.object.convert(target='MESH')

# Blender +Z up / -Y front; glTF conversion gives +Y up / +Z front.
box('Chassis', (0,0,.62), (.66,.82,1.16), shell, .022)
for x in (-.25,.25):
    for y in (-.29,.29): box('Isolated foot',(x,y,.035),(.12,.15,.07),black,.015)
box('Front bezel',(0,-.423,.64),(.61,.035,1.06),black,.014)
box('Status rail',(-.276,-.447,.64),(.025,.018,1.02),silver)
box('Status light',(-.275,-.459,1.025),(.012,.01,.15),blue)
text('DELL', (0,-.447,1.10), .061)
text('EDGE ANALYTICS', (0,-.447,1.035), .031)
for row in range(4):
    z=.88-row*.12
    box('Hot swap drive',(0,-.451,z),(.47,.045,.098),shell,.008)
    box('Drive latch',(.17,-.479,z),(.06,.015,.07),silver,.005)
    box('Drive activity',(-.18,-.478,z),(.013,.012,.032),green,.003)
    for col in range(13): box('Drive ventilation',(-.135+col*.022,-.478,z),(.009,.007,.049),black,.001)
for row in range(5):
    for col in range(20): box('Intake perforation',(-.23+col*.024,-.449,.24+row*.025),(.013,.006,.012),shell,.002)
# Three real modeled recesses: ingest A, ingest B, LAN uplink.
ports={}
for i, name in enumerate(('Camera A','Camera B','LAN')):
    x=-.17+i*.17
    box(name+' cage',(x,-.454,.435),(.13,.028,.093),silver,.004)
    box(name+' cavity',(x,-.473,.435),(.106,.016,.069),black,.002)
    for pin in range(8): box('NIC pin',(x-.035+pin*.01,-.483,.411),(.004,.007,.014),gold,.001)
    box('NIC activity',(x+.054,-.477,.484),(.012,.007,.01),green,.001)
    ports[name]=[x,.435,.485]
for z in (.17,1.08):
    for x in (-.26,.26): box('Captive fastener',(x,-.451,z),(.018,.006,.018),silver,.004)
for i in range(20): box('Side cooling channel',(.333,-.18+i*.022,.82),(.006,.01,.38),black,.001)

# Merge by material: six draw calls, with all detail baked into the GLB.
for mat in bpy.data.materials:
    objs=[o for o in list(root.children) if o.type=='MESH' and o.data.materials and o.data.materials[0]==mat]
    if not objs: continue
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objs: obj.select_set(True)
    bpy.context.view_layer.objects.active=objs[0]
    bpy.ops.object.join()
    objs[0].name=mat.name
bpy.context.view_layer.update()
points=[o.matrix_world@Vector(v) for o in root.children if o.type=='MESH' for v in o.bound_box]
low=[min(v[i] for v in points) for i in range(3)]
high=[max(v[i] for v in points) for i in range(3)]
minimum=[low[0],low[2],-high[1]]
maximum=[high[0],high[2],-low[1]]
manifest={'prefabs':{'AnalyticsServer':{'min':minimum,'max':maximum,'size':[maximum[i]-minimum[i] for i in range(3)]}},'ports':ports}
(OUT/'analytics-server.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
bpy.ops.export_scene.gltf(filepath=str(OUT/'analytics-server.glb'),export_format='GLB',export_apply=True)
print('EXPORTED_ANALYTICS',manifest,flush=True)
