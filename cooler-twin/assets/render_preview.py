"""Render editable asset for visual QA: blender -b assets/cooler.blend -P assets/render_preview.py."""
import bpy
import math
from pathlib import Path
from mathutils import Vector
here=Path(__file__).resolve().parent
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=32
scene.cycles.use_denoising=True
scene.render.resolution_x=900
scene.render.resolution_y=1100
scene.render.resolution_percentage=100
scene.world.use_nodes=True
bg=scene.world.node_tree.nodes.get('Background')
bg.inputs['Color'].default_value=(.32,.36,.42,1)
bg.inputs['Strength'].default_value=.5

def point_at(obj,point):
    obj.rotation_euler=(Vector(point)-obj.location).to_track_quat('-Z','Y').to_euler()
def area(name,pos,energy,size,color=(1,1,1),target=(0,0,1)):
    data=bpy.data.lights.new(name,'AREA')
    data.energy=energy
    data.shape='DISK'
    data.size=size
    data.color=color
    obj=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(obj)
    obj.location=pos
    point_at(obj,target)
    return obj
area('Key',(2,-4,4),500,3)
area('Fill',(-3,-2,2),300,3,(.72,.82,1))
area('Rim',(0,2,3),600,2)
for x in [-.29,.29]:
    for z in [.7,1.3,1.65]:
        area('InternalLED',(x,-.30,z),3,.25,(.84,.94,1),(0,.15,z))
camera_data=bpy.data.cameras.new('QA_Camera')
camera=bpy.data.objects.new('QA_Camera',camera_data)
bpy.context.collection.objects.link(camera)
camera.location=(2.6,-4.1,2.25)
point_at(camera,(0,0,1.05))
camera_data.type='ORTHO'
camera_data.ortho_scale=2.65
scene.camera=camera
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,0))
plane=bpy.context.object
mat=bpy.data.materials.new('QA_Ground')
mat.diffuse_color=(.14,.16,.19,1)
plane.data.materials.append(mat)
scene.view_settings.view_transform='AgX'
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(here/'preview.png')
bpy.ops.render.render(write_still=True)
