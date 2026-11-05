"""Verify exported finger skins and render the actual GLB's card pinch.

blender -b --factory-startup --python-exit-code 1 --python scripts/blender/enterprise_people/proof_hands.py
The reference solve is the Smart Kitchen three-link sheet grip, in CE axes.
This creates a temporary posed GLB, never rewrites the runtime GLB.
"""
import bpy, bmesh, json, math, struct, tempfile
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion

HERE=Path(__file__).resolve().parent
ASSETS=HERE.parents[2]/'src/assets/offerings'
path=ASSETS/'enterprise-actors.studio.glb'
raw=path.read_bytes();size=struct.unpack_from('<I',raw,12)[0]
g=json.loads(raw[20:20+size]);binary=raw[28+size:]
manifest=json.loads((ASSETS/'enterprise-actors.studio.manifest.json').read_text())
names={node.get('name'):i for i,node in enumerate(g['nodes'])}
parents={child:i for i,node in enumerate(g['nodes']) for child in node.get('children',[])}

def bind(index):
    local=Matrix.Translation(Vector(g['nodes'][index].get('translation',[0,0,0])))
    return bind(parents[index])@local if index in parents else local

def read_accessor(index):
    acc=g['accessors'][index];view=g['bufferViews'][acc['bufferView']]
    count={'VEC3':3,'VEC4':4,'MAT4':16,'SCALAR':1}[acc['type']]
    fmt={5126:'f',5123:'H',5125:'I'}[acc['componentType']]
    offset=view.get('byteOffset',0)+acc.get('byteOffset',0)
    stride=view.get('byteStride',struct.calcsize(fmt)*count)
    return [struct.unpack_from('<'+fmt*count,binary,offset+i*stride) for i in range(acc['count'])]

max_bind_error=0;skinned_vertices=0
for skin in g['skins']:
    inv=read_accessor(skin['inverseBindMatrices'])
    assert len(skin['joints'])==45
    for node,values in zip(skin['joints'],inv):
        m=Matrix([values[k:k+4] for k in range(0,16,4)]).transposed()
        error=bind(node)@m-Matrix.Identity(4)
        max_bind_error=max(max_bind_error,max(abs(v) for row in error for v in row))
for node in g['nodes']:
    if 'skin' not in node:continue
    for primitive in g['meshes'][node['mesh']]['primitives']:
        weights=read_accessor(primitive['attributes']['WEIGHTS_0'])
        indices=read_accessor(primitive['attributes']['JOINTS_0'])
        assert all(abs(sum(row)-1)<1e-6 for row in weights)
        assert all(0<=index<45 for row in indices for index in row)
        skinned_vertices+=len(weights)
assert max_bind_error<2e-7,max_bind_error

def unit(values):return Vector(values).normalized()
def frame(direction,normal):
    x=direction.normalized();y=(normal-x*normal.dot(x)).normalized()
    return Matrix((x,y,x.cross(y))).transposed().to_quaternion()
def canonical(p,side):
    return Vector((p[0]*(1 if side=='Right' else -1),-p[2],p[1]))*1000
def ce(v,side):return Vector((v.x*(1 if side=='Right' else -1),v.z,-v.y))*.001
def convert_rotation(q,side):
    c=Matrix(((1 if side=='Right' else -1,0,0),(0,0,1),(0,-1,0)))
    return (c@q.to_matrix()@c.inverted()).to_quaternion()

pad_errors={}
for role in manifest['roles']:
    for side,data in manifest['roles'][role]['hands'].items():
        chain_data=data['chains'];pad_errors[role+side]={}
        for d,(digit,ce_chain) in enumerate(chain_data.items()):
            chain=[canonical(p,side) for p in ce_chain]
            if d<2:
                thumb=d==0;pad=canonical(data['pads'][digit]['handLocal'],side)
                tip_q=frame(unit((0,.12,-1) if thumb else (0,-.16,1)),unit((1 if thumb else -1,0,0)))
                tip_q=tip_q@frame(chain[3]-chain[2],unit((.35,1,0) if thumb else (-1,0,0))).inverted()
                tip=canonical(data['pinchCenter'],side)
                tip.x+=(-1 if thumb else 1)*.38
                j3=tip-tip_q@(pad-chain[2]);ray=j3-chain[0];reach=ray.length;ray.normalize()
                l1=(chain[1]-chain[0]).length;l2=(chain[2]-chain[1]).length
                along=max(-l1,min(l1,(l1*l1-l2*l2+reach*reach)/(2*reach)))
                pole=unit((-1,-.45,0) if thumb else (.25,.1,-1))
                pole=(pole-ray*pole.dot(ray)).normalized()
                j2=chain[0]+ray*along+pole*math.sqrt(max(0,l1*l1-along*along))
                posed=[chain[0],j2,j3]
                rotations=[(chain[k+1]-chain[k]).rotation_difference(posed[k+1]-posed[k]) for k in range(2)]+[tip_q]
            else:
                posed=[chain[0]];rotations=[]
                for k,direction in enumerate([(-.03,.035,-1),(-.27,.05,-.96),(-.57,.02,-.82)]):
                    direction=unit(direction)
                    if d==2:direction.x*=.63;direction.normalize()
                    posed.append(posed[-1]+direction*(chain[k+1]-chain[k]).length)
                    rotations.append((chain[k+1]-chain[k]).rotation_difference(direction))
            previous=Quaternion();actual=Vector(ce_chain[0]);global_q=Quaternion()
            for k,part in enumerate(['Proximal','Intermediate','Distal']):
                desired=convert_rotation(rotations[k],side)
                local=previous.inverted()@desired;previous=desired
                node=g['nodes'][names[role+'_'+side+digit+part]]
                node['rotation']=[local.x,local.y,local.z,local.w]
                if k:actual+=global_q@(Vector(ce_chain[k])-Vector(ce_chain[k-1]))
                global_q=desired
            if d<2:
                result=actual+global_q@(Vector(data['pads'][digit]['handLocal'])-Vector(ce_chain[2]))
                error=(result-ce(tip,side)).length
                assert error<1e-6,(role,side,digit,error)
                pad_errors[role+side][digit]=error

j=json.dumps(g,separators=(',',':')).encode();j+=b' '*((-len(j))%4)
posed_path=Path(tempfile.gettempdir())/'ce-cast-pinch-proof.glb'
posed_path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(j)+len(binary))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(binary),0x004e4942)+binary)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(posed_path))
bpy.context.view_layer.update()

# Isolate the actual evaluated hand skin for inspection at a readable scale.
# Preserve its UVs and materials; no replacement primitives stand in for digits.
body=next(o for o in bpy.data.objects if o.type=='MESH' and 'Customer' in o.name and 'guest' in o.name)
deps=bpy.context.evaluated_depsgraph_get()
mesh=bpy.data.meshes.new_from_object(body.evaluated_get(deps),preserve_all_data_layers=True,depsgraph=deps)
hand=bpy.data.objects.new('Exported anatomical pinch',mesh);bpy.context.scene.collection.objects.link(hand)
hand.matrix_world=body.matrix_world.copy()
bm=bmesh.new();bm.from_mesh(mesh)
remove=[v for v in bm.verts if (hand.matrix_world@v.co-Vector((.265,-.013,.84))).length>.185 or (hand.matrix_world@v.co).z>.89 or (hand.matrix_world@v.co).x<.18]
bmesh.ops.delete(bm,geom=remove,context='VERTS');bm.to_mesh(mesh);bm.free()
for obj in list(bpy.context.scene.objects):
    if obj!=hand:obj.hide_render=True

# A standard 85.6 x 53.98 mm card; its narrow edge is between the skin pads.
grip=manifest['roles']['Customer']['hands']['Right']['pinchCenter']
center=Vector((.265+grip[0],-(.013+grip[2]),.84+grip[1]))
bpy.ops.mesh.primitive_cube_add(size=1,location=center+Vector((0,-.036,0)))
card=bpy.context.object;card.name='Card edge pinched between pads';card.dimensions=(.00076,.0856,.05398)
bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
bevel=card.modifiers.new('Card edge radius','BEVEL');bevel.width=.0018;bevel.segments=4
cardmat=bpy.data.materials.new('Ivory polymer card');cardmat.diffuse_color=(.86,.90,.82,1);card.data.materials.append(cardmat)

scene=bpy.context.scene;world=bpy.data.worlds.new('Neutral hand inspection');scene.world=world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.13,.18,.16,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.35
def area(name,pos,power,size):
    light=bpy.data.lights.new(name,'AREA');light.energy=power;light.size=size
    ob=bpy.data.objects.new(name,light);scene.collection.objects.link(ob);ob.location=pos
    ob.rotation_euler=(center-ob.location).to_track_quat('-Z','Y').to_euler()
area('Soft hand key',center+Vector((-.18,-.22,.25)),8,.20)
area('Skin rim',center+Vector((.22,.1,.17)),6,.16)
camera=bpy.data.cameras.new('Pinch inspection');cam=bpy.data.objects.new('Pinch inspection',camera);scene.collection.objects.link(cam)
cam.location=center+Vector((-.24,-.17,.12));cam.rotation_euler=(center+Vector((.006,0,.012))-cam.location).to_track_quat('-Z','Y').to_euler()
camera.type='ORTHO';camera.ortho_scale=.25;scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1200;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(ASSETS/'enterprise-actors.hands-proof.png')
bpy.ops.render.render(write_still=True)
report={'maxBindMatrixError':max_bind_error,'skinVerticesChecked':skinned_vertices,'padTargetErrorMeters':pad_errors,'sourceGLBBytes':len(raw),'fingerJointsPerActor':30}
(ASSETS/'enterprise-actors.hands-proof.json').write_text(json.dumps(report,indent=2)+'\n')
print('HAND_PROOF_COMPLETE',json.dumps(report),flush=True)
