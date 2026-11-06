"""Render lightweight, transparent studio spheres for the device topology.

blender -b --factory-startup --python-exit-code 1 --python scripts/blender/device_orbit_planets.py

Procedural materials only: no downloaded textures, fonts, or embedded text.
The UI owns rings, status markers and numbers. All assets use the same lighting.
"""
import bpy
import math
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parents[2] / 'src/assets/device-studio'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 4
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.render.image_settings.compression = 100
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = 0.2
world = bpy.data.worlds.new('Soft studio ambient')
world.use_nodes = True
world.node_tree.nodes.get('Background').inputs['Color'].default_value = (.38, .46, .60, 1)
world.node_tree.nodes.get('Background').inputs['Strength'].default_value = .32
scene.world = world


def aim(obj, target=(0, 0, 0)):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def softbox(name, at, power, size, color):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size, data.color = power, 'DISK', size, color
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = at
    aim(obj)


softbox('Upper left large daylight softbox', (-3.8, -4.0, 4.5), 720, 4.0, (1.0, .93, .83))
softbox('Cool frontal fill', (2.8, -3.0, .5), 65, 4.0, (.57, .77, 1.0))
softbox('Atmospheric edge softbox', (2.5, 1.4, 2.8), 290, 3.0, (.59, .83, 1.0))
camera_data = bpy.data.cameras.new('Orthographic sprite camera')
camera = bpy.data.objects.new('Orthographic sprite camera', camera_data)
scene.collection.objects.link(camera)
camera.location = (0, -6, 0)
aim(camera)
camera_data.type, camera_data.ortho_scale = 'ORTHO', 2.22
scene.camera = camera


def linear(hex_color):
    rgb = [v / 255 for v in bytes.fromhex(hex_color)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb) + (1,)


def ramp(nodes, colors):
    node = nodes.new('ShaderNodeValToRGB')
    node.color_ramp.interpolation = 'EASE'
    for index, (position, color) in enumerate(colors):
        item = node.color_ramp.elements[index] if index < 2 else node.color_ramp.elements.new(position)
        item.position, item.color = position, linear(color)
    return node


def sphere(name, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=192, ring_count=96, radius=1)
    obj = bpy.context.object
    obj.name = name
    # Rotate the atmosphere about the view axis: latitude bands remain a 3D surface.
    obj.rotation_euler.y = math.radians(-17)
    for face in obj.data.polygons:
        face.use_smooth = True
    obj.data.materials.append(material)
    return obj


def atmosphere(name, palette):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = .58
    shader.inputs['Specular IOR Level'].default_value = .23
    coord = nodes.new('ShaderNodeTexCoord')
    separate = nodes.new('ShaderNodeSeparateXYZ')
    links.new(coord.outputs['Generated'], separate.inputs[0])
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 4.5
    noise.inputs['Detail'].default_value = 5
    noise.inputs['Roughness'].default_value = .68
    links.new(coord.outputs['Generated'], noise.inputs['Vector'])
    broad = nodes.new('ShaderNodeMath')
    broad.operation = 'MULTIPLY'
    broad.inputs[1].default_value = 32
    links.new(separate.outputs['Z'], broad.inputs[0])
    turbulence = nodes.new('ShaderNodeMath')
    turbulence.operation = 'MULTIPLY'
    turbulence.inputs[1].default_value = 3.6
    links.new(noise.outputs['Fac'], turbulence.inputs[0])
    warp = nodes.new('ShaderNodeMath')
    warp.operation = 'ADD'
    links.new(broad.outputs[0], warp.inputs[0])
    links.new(turbulence.outputs[0], warp.inputs[1])
    wave = nodes.new('ShaderNodeMath')
    wave.operation = 'SINE'
    links.new(warp.outputs[0], wave.inputs[0])
    normalize = nodes.new('ShaderNodeMapRange')
    normalize.inputs['From Min'].default_value = -1
    normalize.inputs['From Max'].default_value = 1
    links.new(wave.outputs[0], normalize.inputs[0])
    color = ramp(nodes, palette)
    links.new(normalize.outputs[0], color.inputs[0])
    links.new(color.outputs['Color'], shader.inputs['Base Color'])
    links.new(color.outputs['Color'], shader.inputs['Emission Color'])
    shader.inputs['Emission Strength'].default_value = .035
    # Fine atmospheric ribbons add highlights without turning the planet into stone.
    ribbon = nodes.new('ShaderNodeTexWave')
    ribbon.wave_type, ribbon.bands_direction = 'BANDS', 'Z'
    ribbon.inputs['Scale'].default_value = 18
    ribbon.inputs['Distortion'].default_value = 6
    ribbon.inputs['Detail'].default_value = 4
    ribbon.inputs['Detail Scale'].default_value = .7
    links.new(coord.outputs['Generated'], ribbon.inputs['Vector'])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .11
    bump.inputs['Distance'].default_value = .015
    links.new(ribbon.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    return material


def moon_material():
    material = bpy.data.materials.new('Moon / silvery regolith and shallow crater rims')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = .86
    shader.inputs['Specular IOR Level'].default_value = .18
    coord = nodes.new('ShaderNodeTexCoord')
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 7
    noise.inputs['Detail'].default_value = 5
    links.new(coord.outputs['Generated'], noise.inputs['Vector'])
    color = ramp(nodes, [(0, '666b73'), (.4, '969ca5'), (.72, 'c1c6cb'), (1, 'e0e2e4')])
    links.new(noise.outputs['Fac'], color.inputs[0])
    links.new(color.outputs['Color'], shader.inputs['Base Color'])
    voronoi = nodes.new('ShaderNodeTexVoronoi')
    voronoi.inputs['Scale'].default_value = 14
    links.new(coord.outputs['Generated'], voronoi.inputs['Vector'])
    crater = ramp(nodes, [(0, '202020'), (.25, '414141'), (.35, 'b4b4b4'), (.41, 'eeeeee'), (.48, '929292'), (1, '929292')])
    links.new(voronoi.outputs['Distance'], crater.inputs[0])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .55
    bump.inputs['Distance'].default_value = .075
    links.new(crater.outputs[0], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    return material


palettes = {
    'it': [(0, '146d86'), (.22, '248ea3'), (.44, '55b6c0'), (.61, '74c4cb'), (.73, 'b2d6cb'), (.82, 'dddcc2'), (.92, '5daec2'), (1, '2a8ca6')],
    'ot': [(0, '363f91'), (.23, '6250ac'), (.43, '8c69bd'), (.60, 'b783c1'), (.73, 'e2a8bb'), (.82, 'efbdaf'), (.92, '9688c8'), (1, '596bb0')],
}
for kind, palette in palettes.items():
    planet = sphere('Orbit ' + kind.upper(), atmosphere(kind + ' atmospheric bands', palette))
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.filepath = str(OUT / ('orbit-planet-' + kind + '.png'))
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(planet, do_unlink=True)
moon = sphere('Orbit moon', moon_material())
scene.render.resolution_x = scene.render.resolution_y = 128
scene.render.filepath = str(OUT / 'orbit-moon.png')
bpy.ops.render.render(write_still=True)
for name in ['orbit-planet-it.png', 'orbit-planet-ot.png', 'orbit-moon.png']:
    file = OUT / name
    print(f'SPRITE {file} {file.stat().st_size} bytes')
    assert file.stat().st_size < 400_000, f'{name} exceeds its asset budget'
