"""Render a neutral metal inventory token for the branch topology.

This is an abstract inventory marker, not a model of discovered hardware.
Blender 4.5: blender -b --factory-startup --python-exit-code 1 --python scripts/blender/inventory_node.py
An optional output directory may follow --.
"""
from pathlib import Path
import sys
import bpy
from mathutils import Vector

OUT = (Path(sys.argv[sys.argv.index('--') + 1]) if '--' in sys.argv else
       Path(__file__).resolve().parents[2] / 'src/assets/device-studio')
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def linear(rgb):
    return tuple((v / 255 / 12.92 if v < 11 else ((v / 255 + .055) / 1.055) ** 2.4)
                 for v in bytes.fromhex(rgb))


def material(name, color, metal, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    principled = mat.node_tree.nodes.get('Principled BSDF')
    principled.inputs['Base Color'].default_value = (*linear(color), 1)
    principled.inputs['Metallic'].default_value = metal
    principled.inputs['Roughness'].default_value = roughness
    return mat


aluminium = material('Bead blasted titanium body', '8996a0', .88, .25)
graphite = material('Graphite inset face', '394852', .72, .39)
rubber = material('Recessed graphite underside', '1c252c', .16, .52)

# A restrained satin finish; the broad reflections provide the visible material
# cues at dashboard sizes. The fine grain merely stops the face looking plastic.
nodes = graphite.node_tree.nodes
links = graphite.node_tree.links
coord = nodes.new('ShaderNodeTexCoord')
mapping = nodes.new('ShaderNodeVectorMath'); mapping.operation = 'MULTIPLY'
mapping.inputs[1].default_value = (2, 90, 3)
noise = nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 90
noise.inputs['Detail'].default_value = 1
bump = nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .045
bump.inputs['Distance'].default_value = .008
links.new(coord.outputs['Generated'], mapping.inputs[0])
links.new(mapping.outputs[0], noise.inputs['Vector'])
links.new(noise.outputs['Fac'], bump.inputs['Height'])
links.new(bump.outputs['Normal'], nodes.get('Principled BSDF').inputs['Normal'])


def cylinder(name, radius, depth, height, mat, bevel):
    bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=radius, depth=depth,
                                       location=(0, 0, height))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new('Machined chamfer', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 5
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    for face in obj.data.polygons:
        face.use_smooth = True
    normal = obj.modifiers.new('Face weighted normals', 'WEIGHTED_NORMAL')
    normal.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=normal.name)
    return obj


cylinder('Under-cut shadow edge', .925, .105, .055, rubber, .025)
cylinder('Single machined metal body', 1, .205, .158, aluminium, .07)
cylinder('Inset graphite face', .883, .065, .252, graphite, .033)


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def softbox(name, position, power, size, size_y, color=(1, 1, 1)):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.shape = 'RECTANGLE'; data.size = size; data.size_y = size_y
    data.color = color
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = position
    aim(obj, (0, 0, .15))


# A wide key reflection and narrow opposing bounce delineate a real metal bevel.
softbox('Large upper-left softbox', (-3.2, 4.5, 5), 700, 3.6, 2.7, (.94, .975, 1))
softbox('Front strip reflection', (-.7, -4, 2.6), 26, 4.0, .65, (.90, .95, 1))
softbox('Small back edge fill', (3.8, 2, 2.9), 45, 2, 1.2, (1, .97, .93))

world = bpy.data.worlds.new('Neutral studio reflections')
scene.world = world
world.use_nodes = True
world.node_tree.nodes.get('Background').inputs['Color'].default_value = (.35, .39, .43, 1)
world.node_tree.nodes.get('Background').inputs['Strength'].default_value = .35

camera_data = bpy.data.cameras.new('Orthographic product camera')
camera = bpy.data.objects.new('Orthographic product camera', camera_data)
scene.collection.objects.link(camera)
camera.location = (0, -3.2, 10)
aim(camera, (0, 0, .13))
camera_data.type = 'ORTHO'; camera_data.ortho_scale = 2.24
scene.camera = camera

scene.render.engine = 'CYCLES'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
scene.render.resolution_x = 384
scene.render.resolution_y = 384
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.render.filepath = str(OUT / 'inventory-node.png')
bpy.ops.render.render(write_still=True)
print('Rendered inventory token:', scene.render.filepath)
