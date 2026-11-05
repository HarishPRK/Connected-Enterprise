"""Open the retargeted GLB in Blender, save editable cast, render a contact sheet."""
import bpy,sys,math
from pathlib import Path
from mathutils import Vector, Quaternion
HERE=Path(__file__).resolve().parent
ASSETS=HERE.parents[2]/'src/assets/offerings'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ASSETS/'enterprise-actors.studio.glb'))
roles=['Customer','Staff','Technician','Security']
for i,role in enumerate(roles):
    root=bpy.data.objects.get(role);root.location.x=(i-1.5)*1.25
    # Blender imports the glTF's semantic joints as a regular armature. Poses
    # stay editable here and retain all source skin weights and UV textures.
    for child in root.children_recursive:
        if child.type=='ARMATURE':
            child.data.display_type='STICK'
            for suffix,axis,rotation in [('LeftUpperArm',(1,0,0),-.65),('LeftForearm',(1,0,0),-1.15),('LeftHand',(0,0,1),-math.pi/2)]:
                bone=child.pose.bones.get(role+'_'+suffix)
                if bone and role in ('Staff','Technician'):
                    # glTF's semantic XYZ controls become Blender bones with a
                    # chosen display orientation. Conjugate the CE axis into
                    # that rest basis rather than rotating a different axis.
                    basis=bone.bone.matrix_local.to_quaternion()
                    bone.rotation_mode='QUATERNION'
                    bone.rotation_quaternion=basis.inverted()@Quaternion(axis,rotation)@basis
for ob in list(bpy.context.scene.objects):
    if not ob.parent and ob.name not in roles:ob.hide_render=True
scene=bpy.context.scene
world=bpy.data.worlds.new('Warm studio');scene.world=world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.18,.22,.20,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.45
def area(name,pos,power,size,color):
    light=bpy.data.lights.new(name,'AREA');light.energy=power;light.shape='DISK';light.size=size;light.color=color
    ob=bpy.data.objects.new(name,light);scene.collection.objects.link(ob);ob.location=pos
    ob.rotation_euler=(Vector((0,0,1))-ob.location).to_track_quat('-Z','Y').to_euler()
area('Large warm key',(-4,-5,6),750,5,(1,.87,.72));area('Cool fill',(5,-2,3),500,4,(.72,.86,1));area('Shoulder rim',(1,4,5),650,4,(1,.94,.84))
bpy.ops.mesh.primitive_plane_add(size=200)
floor=bpy.context.object;floor.location.z=-.025
mat=bpy.data.materials.new('Spruce studio');mat.diffuse_color=(.035,.070,.057,1);floor.data.materials.append(mat)
camera=bpy.data.cameras.new('Cast review');ob=bpy.data.objects.new('Cast review',camera);scene.collection.objects.link(ob)
ob.location=(4,-10,3.7);ob.rotation_euler=(Vector((0,0,.95))-ob.location).to_track_quat('-Z','Y').to_euler()
camera.type='ORTHO';camera.ortho_scale=6.0;scene.camera=ob
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1800;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(ASSETS/'enterprise-actors.studio-proof.png')
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'enterprise-cast.blend'))
bpy.ops.render.render(write_still=True)
print('BLENDER_CAST_PROOF_COMPLETE',flush=True)
