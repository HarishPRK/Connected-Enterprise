"""Blender 4.5 LTS: export a UV-mapped cartographic globe oriented to true north."""
import math
import sys
from pathlib import Path

import bpy

image_path, model_path = map(Path, sys.argv[sys.argv.index("--") + 1:])
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
segments, bands = 128, 64
vertices, faces, coords = [], [], []
for row in range(bands + 1):
    latitude = math.pi * (row / bands - .5)
    for column in range(segments + 1):
        longitude = 2 * math.pi * (column / segments - .5)
        vertices.append((math.cos(latitude) * math.sin(longitude),
                         -math.cos(latitude) * math.cos(longitude), math.sin(latitude)))
        coords.append((column / segments, row / bands))
for row in range(bands):
    for column in range(segments):
        i = row * (segments + 1) + column
        j = i + segments + 1
        faces.append((i, i + 1, j + 1, j))
mesh = bpy.data.meshes.new("Geographic grid")
mesh.from_pydata(vertices, [], faces)
mesh.update()
uv = mesh.uv_layers.new(name="LongitudeLatitude")
for face in mesh.polygons:
    face.use_smooth = True
    for loop in face.loop_indices:
        uv.data[loop].uv = coords[mesh.loops[loop].vertex_index]
earth = bpy.data.objects.new("Earth", mesh)
bpy.context.collection.objects.link(earth)
material = bpy.data.materials.new("Blue Marble · natural color")
material.use_nodes = True
shader = material.node_tree.nodes.get("Principled BSDF")
shader.inputs["Roughness"].default_value = 1.0
shader.inputs["Metallic"].default_value = 0.0
texture = material.node_tree.nodes.new("ShaderNodeTexImage")
texture.image = bpy.data.images.load(str(image_path.resolve()))
material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
mesh.materials.append(material)
bpy.ops.export_scene.gltf(filepath=str(model_path.resolve()), export_format="GLB",
                          export_image_format="AUTO", export_yup=True)
