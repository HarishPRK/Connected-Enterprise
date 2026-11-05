"""Retarget Smart Kitchen's anatomical library onto CE's stable semantic rig.

python scripts/blender/enterprise_people/build_cast.py
Then open/save/proof in Blender with proof.py. Retargeting is performed on the
skin's bind vertices, never by posing rigid body-part meshes at runtime.
"""
from pathlib import Path
import io, json, struct
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parents[2] / 'src/assets/offerings'
LIB = HERE / 'library'
raw = (ASSETS/'enterprise-actors.glb').read_bytes()
json_size = struct.unpack_from('<I',raw,12)[0]
g = json.loads(raw[20:20+json_size])
binary = bytearray(raw[28+json_size:])
g.setdefault('skins',[]);g.setdefault('images',[]);g.setdefault('textures',[])
g.setdefault('samplers',[]).append({'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497})
sampler = len(g['samplers'])-1
info = np.load(LIB/'fitted_cast.npz')
names = info['bone_names'].tolist()

# These points are the original authored anatomical library, in Blender Z up.
rest = {'pelvis':(0,0,.97),'spine':(0,0,1.06),'chest':(0,0,1.285),
        'neck':(0,0,1.5),'head':(0,0,1.56)}
for side,sign in [('L',1),('R',-1)]:
    for joint,x,y,z in [('upper_arm',.207,0,1.43),('forearm',.235,-.018,1.14),('hand',.247,-.045,.883),
                      ('thigh',.102,0,.94),('shin',.108,-.020,.51),('foot',.113,.005,.095)]:
        rest[joint+'.'+side]=(sign*x,y,z)
def yup(points):
    points=np.asarray(points);return points[..., [0,2,1]]*np.array([1,1,-1])
rest=np.array([yup(rest[name]) for name in names])

# CE's animation and reader IK retain the same exact shoulder, elbow and knee
# pivots. Torso skin sections share the torso driver without collapsing their
# distinct anatomical reference points. Hands retain full finger topology.
joint_map={'pelvis':'Hips','spine':'Torso','chest':'Torso','neck':'Torso','head':'Head'}
target={'pelvis':(0,.9,0),'spine':(0,1.,0),'chest':(0,1.235,0),'neck':(0,1.43,0),'head':(0,1.49,0)}
for side,sign,label in [('L',1,'Right'),('R',-1,'Left')]:
    for name,suffix,x,y,z in [('upper_arm','UpperArm',.235,1.38,0),('forearm','Forearm',.265,1.115,0),
                              ('hand','Hand',.265,.84,.013),('thigh','Thigh',.095,.89,0),
                              ('shin','Shin',.095,.47,0),('foot','Ankle',.095,.075,.055)]:
        joint_map[name+'.'+side]=label+suffix;target[name+'.'+side]=(sign*x,y,z)
target=np.array([target[name] for name in names])

# Authored MakeHuman phalanx centre lines used by Smart Kitchen's receipt grip.
# Canonical coordinates are wrist-local millimetres (Z down the fingers). The
# CE cast is Y up: (x, y, z) -> (x, z, -y). Its left hand mirrors local X.
# Preserve all three links so terminal pad orientation is independent of the
# two-link reach solve, instead of trying to pinch with a rigid open palm.
finger_chains={
 'Thumb':[[-9.6,-19,-26.7],[-15.7,-33.8,-40.8],[-25.7,-48.7,-63.8],[-32.5,-57.1,-79.2]],
 'Index':[[5.8,-24.1,-77.1],[5.2,-28.5,-97],[1.2,-31.2,-114.7],[-3.5,-33.8,-132.7]],
 'Middle':[[5.6,-4.1,-77.8],[6.5,-2.6,-103.5],[3.2,-2.3,-123.5],[0,-1.4,-143.2]],
 'Ring':[[7.1,11.4,-73.3],[8.3,16.5,-95.5],[5.2,19.6,-114.2],[2.2,23.8,-133.3]],
 'Little':[[5.8,26.4,-67],[3.7,31.4,-83.6],[.7,34.6,-94.3],[-3.4,39.1,-107.7]],
}
phalanges=['Proximal','Intermediate','Distal']

def hand_chains(side):
    mirror=np.array([1 if side=='Right' else -1,1,1])
    return {digit:yup(chain)*.001*mirror for digit,chain in finger_chains.items()}

def smooth(t):
    t=np.clip(t,0,1);return t*t*(3-2*t)

def finger_weights(points,weights,joints,role,nodes):
    """Skin only the anatomical hand, with continuous blends at its knuckles.

    Assignment uses the nearest segment of each actual phalanx centre line.
    Webbing keeps its wrist influence; UV-seam duplicates inherit identical
    weights. Clothing and all other body vertices remain unchanged.
    """
    report={}
    for side in ['Right','Left']:
        hand_index=joints.index(side+'Hand')
        hand_origin=position(nodes[role+'_'+side+'Hand'])
        local=points-hand_origin
        selected=np.flatnonzero((weights[:,hand_index]>.70)&(local[:,1]<-.017))
        p=local[selected]
        chains=hand_chains(side)
        closest=np.full(len(p),np.inf); digit_id=np.zeros(len(p),int)
        links=np.zeros(len(p),int);parameters=np.zeros(len(p))
        for d,chain in enumerate(chains.values()):
            for k in range(3):
                axis=chain[k+1]-chain[k];offset=p-chain[k]
                t=offset@axis/(axis@axis)
                distance=np.sum((offset-np.clip(t,0,1)[:,None]*axis)**2,axis=1)
                better=distance<closest
                closest[better]=distance[better];digit_id[better]=d
                links[better]=k;parameters[better]=t[better]
        original=weights[selected,hand_index].copy()
        weights[selected,hand_index]=0
        for d,(digit,chain) in enumerate(chains.items()):
            for k in range(3):
                chosen=np.flatnonzero((digit_id==d)&(links==k))
                t=parameters[chosen]
                indices=[hand_index]+[joints.index(side+digit+part) for part in phalanges]
                current=np.ones(len(chosen))
                before=t<.25
                start=-.25 if k else -.12
                blend=smooth((t[before]-start)/(.25-start))
                weights[selected[chosen[before]],indices[k]]+=original[chosen[before]]*(1-blend)
                current[before]=blend
                if k<2:
                    after=t>.75;blend=smooth((t[after]-.75)/.5)
                    weights[selected[chosen[after]],indices[k+2]]+=original[chosen[after]]*blend
                    current[after]=1-blend
                weights[selected[chosen],indices[k+1]]+=original[chosen]*current
        pads={}
        for d,digit in enumerate(['Thumb','Index']):
            chain=chains[digit]
            normal=yup([.35,1,0] if d==0 else [-1,0,0]).astype(float)
            if side=='Left':normal[0]*=-1
            axis=chain[3]-chain[2];axis/=np.linalg.norm(axis)
            normal-=axis*(normal@axis);normal/=np.linalg.norm(normal)
            candidates=np.flatnonzero((digit_id==d)&(links==2)&(parameters>.42)&(parameters<.94))
            if not len(candidates):raise ValueError(f'Missing {role} {side} {digit} pad vertices')
            chosen=candidates[np.argmax((p[candidates]-chain[2])@normal)]
            pad=p[chosen]
            parent=nodes[role+'_'+side+digit+'Distal'];index=len(g['nodes'])
            g['nodes'].append({'name':role+'_'+side+digit+'Pad','translation':(pad-chain[2]).tolist(),
                              'extras':{'handLocal':pad.tolist(),'sourceVertex':int(selected[chosen])}})
            g['nodes'][parent].setdefault('children',[]).append(index);parents[index]=parent
            pads[digit]={'handLocal':pad.tolist(),'normal':normal.tolist(),'sourceVertex':int(selected[chosen])}
        report[side]={'chains':{digit:chain.tolist() for digit,chain in chains.items()},
                      'pads':pads,'weightedVertices':len(selected),
                      'digitVertices':{digit:int(np.count_nonzero(digit_id==d)) for d,digit in enumerate(chains)},
                      # The restaurant morph used (-22,-30,-82) mm, which
                      # stretches the thumb by 2 mm. This nearby contact is
                      # reachable by all three rigid phalanges without stretch.
                      'pinchCenter':yup([-21 if side=='Right' else 21,-29.5,-79]).tolist()}
        report[side]['pinchCenter']=(np.array(report[side]['pinchCenter'])*.001).tolist()
    if not np.allclose(weights.sum(axis=1),1,atol=2e-6):
        raise ValueError(f'{role}: finger skinning changed normalized weight sum')
    return report

def buffer_view(data,target=None):
    binary.extend(b'\0'*((-len(binary))%4));offset=len(binary);binary.extend(data)
    view={'buffer':0,'byteOffset':offset,'byteLength':len(data)}
    if target:view['target']=target
    g['bufferViews'].append(view);return len(g['bufferViews'])-1
def accessor(array,kind,target=None,bounds=False):
    array=np.ascontiguousarray(array)
    component={np.dtype('float32'):5126,np.dtype('uint16'):5123,np.dtype('uint32'):5125}[array.dtype]
    value={'bufferView':buffer_view(array.tobytes(),target),'componentType':component,'count':len(array),'type':kind}
    if bounds:value.update(min=array.min(axis=0).tolist(),max=array.max(axis=0).tolist())
    g['accessors'].append(value);return len(g['accessors'])-1

textures={}
def texture(item):
    if item in textures:return textures[item]
    filename=item+('.png' if item in ('crop','brows','lashes') else '.jpg')
    data=(LIB/filename).read_bytes()
    if item=='cookshirt':
        # Match Smart Kitchen's neutral work-shirt treatment. Keep denim and
        # mapped cloth folds; remove the library garment's printed graphics.
        im=Image.open(io.BytesIO(data)).convert('RGB');w,h=im.size
        for x,y,width,height in [(.20,.119,.093,.047),(.448,.121,.175,.083)]:
            x0,y0,ww,hh=round(x*w),round(y*h),round(width*w),round(height*h)
            patch=im.crop((x0,round((y+height+.006)*h),x0+ww,round((y+height+.006)*h)+hh))
            im.paste(patch,(x0,y0))
        stream=io.BytesIO();im.save(stream,format='JPEG',quality=90);data=stream.getvalue()
    g['images'].append({'name':'CE cast / '+item,'bufferView':buffer_view(data),'mimeType':'image/png' if filename.endswith('.png') else 'image/jpeg'})
    g['textures'].append({'source':len(g['images'])-1,'sampler':sampler})
    textures[item]=len(g['textures'])-1;return textures[item]

roles={'Customer':('guest',['guest','jacket','leather','crop','eyes','brows','lashes']),
       'Staff':('crew',['crew','cookshirt','kitchenshoe','crop','eyes','brows','lashes']),
       'Technician':('chef',['chef','cookshirt','kitchenshoe','crop','eyes','brows','lashes']),
       'Security':('customer',['customer','cookshirt','kitchenshoe','crop','eyes','brows','lashes'])}
shades={'Customer':[1,1,1,1],'Staff':[.92,.96,.91,1],'Technician':[.50,.70,.61,1],'Security':[.38,.47,.57,1]}
def material(role,item):
    hair=item in ('crop','brows','lashes')
    name=role+' / anatomical '+item
    if item in ('jacket','cookshirt'):name=role+' / tailored shirt textile'
    value={'name':name,'pbrMetallicRoughness':{'baseColorTexture':{'index':texture(item)},
       'baseColorFactor':shades[role] if item=='cookshirt' else [1,1,1,1],
       'metallicFactor':0,'roughnessFactor':.35 if item=='eyes' else .76 if item in ('jacket','cookshirt') else .60}}
    if hair:value.update(alphaMode='MASK',alphaCutoff=.32,doubleSided=True)
    g['materials'].append(value);return len(g['materials'])-1

parents={child:i for i,node in enumerate(g['nodes']) for child in node.get('children',[])}
def position(index):
    node=g['nodes'][index];p=np.array(node.get('translation',[0,0,0]),float)
    return p+(position(parents[index]) if index in parents else 0)

proof={}
for role,(skin,items) in roles.items():
    root=next(i for i,node in enumerate(g['nodes']) if node.get('name')==role)
    nodes={node.get('name'):i for i,node in enumerate(g['nodes'])}
    def remove_rigid(index,keep=False):
        node=g['nodes'][index];keep=keep or node.get('name') in [role+'_Tablet',role+'_BagMount']
        if not keep:node.pop('mesh',None)
        for child in node.get('children',[]):remove_rigid(child,keep)
    remove_rigid(root)
    # New hands are anatomically thinner than the original rigid proxy palms.
    # Move the existing tablet's underside onto their support plane.
    g['nodes'][nodes[role+'_Tablet']]['translation']=[0,0,-.065]
    for side in ['Left','Right']:
        parent=nodes[role+'_'+side+'Forearm']
        index=len(g['nodes'])
        g['nodes'].append({'name':role+'_'+side+'Hand','translation':[0,-.275,.013]})
        g['nodes'][parent].setdefault('children',[]).append(index)
        parents[index]=parent;nodes[role+'_'+side+'Hand']=index
    joints=list(dict.fromkeys(joint_map[name] for name in names))
    for side in ['Right','Left']:
        for digit,chain in hand_chains(side).items():
            parent=nodes[role+'_'+side+'Hand']
            for k,part in enumerate(phalanges):
                suffix=side+digit+part;name=role+'_'+suffix;index=len(g['nodes'])
                g['nodes'].append({'name':name,'translation':(chain[k]-(chain[k-1] if k else 0)).tolist()})
                g['nodes'][parent].setdefault('children',[]).append(index)
                parents[index]=parent;nodes[name]=index;joints.append(suffix);parent=index
    indices=[nodes[role+'_'+joint] for joint in joints]
    inv=[]
    for index in indices:
        matrix=np.eye(4,dtype=np.float32);matrix[:3,3]=-position(index);inv.append(matrix.T.flatten())
    g['skins'].append({'name':role+' anatomical skin','joints':indices,'skeleton':nodes[role+'_ActorRoot'],
                     'inverseBindMatrices':accessor(np.array(inv,dtype=np.float32),'MAT4')})
    skin_index=len(g['skins'])-1;all_bounds=[];render_triangles=0;hand_report={}
    for item in items:
        # The kitchen crew body intentionally masks skin up to a long sleeve.
        # CE's un-aproned uniforms expose more upper arm. Reuse the library's
        # short-sleeve body topology and its inward taper beneath the hem while
        # retaining each role's complexion atlas (all use the same base UVs).
        geometry='customer' if item==skin and role!='Customer' else item
        points=yup(info[geometry+'_position']).astype(float)
        faces=info[geometry+'_tris'].astype(int)
        source_weights=np.zeros((len(points),len(names)))
        np.put_along_axis(source_weights,info[geometry+'_bones'].astype(int),info[geometry+'_weights'],1)
        transformed=np.zeros_like(points)
        for bone,name in enumerate(names):
            local=points-rest[bone]
            if name=='head':local[:,1]*=1.073
            if name.startswith('foot.'):
                low=float(info[('leather' if skin=='guest' else 'kitchenshoe')+'_position'][:,2].min())
                local[:,1]*=.075/(.095-low)
            transformed+=source_weights[:,bone,None]*(local+target[bone])
        # The old procedural people had unusually broad shoulder caps. The
        # bind skin uses a softer anatomical shoulder line while the hidden
        # control pivots remain unchanged for established scene contacts.
        shoulder=np.clip((transformed[:,1]-1.14)/.18,0,1)*np.clip((1.61-transformed[:,1])/.16,0,1)
        transformed[:,0]*=1-shoulder*(.14 if role=='Customer' else .10)
        all_bounds.append(transformed);render_triangles+=len(faces)
        weights=np.zeros((len(points),len(joints)))
        for bone,name in enumerate(names):weights[:,joints.index(joint_map[name])]+=source_weights[:,bone]
        if item==skin:hand_report=finger_weights(transformed,weights,joints,role,nodes)
        skin_joints=np.argsort(-weights,axis=1)[:,:4]
        skin_weights=np.take_along_axis(weights,skin_joints,1)
        skin_weights/=np.maximum(skin_weights.sum(axis=1,keepdims=True),1.e-9)
        # UV seams duplicate only the needed vertices; smoothing remains across
        # seams so faces do not acquire hard lines at the atlas boundary.
        uv=info[geometry+'_uv'].reshape(-1,2).copy();uv[:,1]=1-uv[:,1]
        keys=np.column_stack([faces.flatten(),uv])
        unique,remap=np.unique(keys,axis=0,return_inverse=True)
        vertex=unique[:,0].astype(int)
        n=np.zeros_like(transformed)
        f=transformed[faces];cross=np.cross(f[:,1]-f[:,0],f[:,2]-f[:,0])
        for corner in range(3):np.add.at(n,faces[:,corner],cross)
        n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1.e-9)
        attrs={'POSITION':accessor(transformed[vertex].astype('float32'),'VEC3',34962,True),
               'NORMAL':accessor(n[vertex].astype('float32'),'VEC3',34962),
               'TEXCOORD_0':accessor(unique[:,1:].astype('float32'),'VEC2',34962),
               'JOINTS_0':accessor(skin_joints[vertex].astype('uint16'),'VEC4',34962),
               'WEIGHTS_0':accessor(skin_weights[vertex].astype('float32'),'VEC4',34962)}
        primitive={'attributes':attrs,'indices':accessor(remap.astype('uint16'),'SCALAR',34963),'material':material(role,item)}
        g['meshes'].append({'name':role+' / fitted '+item,'primitives':[primitive]})
        g['nodes'].append({'name':role+'_Skin_'+item,'mesh':len(g['meshes'])-1,'skin':skin_index})
        g['nodes'][root].setdefault('children',[]).append(len(g['nodes'])-1)
    bounds=np.concatenate(all_bounds)
    proof[role]={'skinJoints':joints,'meshes':len(items),'triangles':render_triangles,'min':bounds.min(0).tolist(),'max':bounds.max(0).tolist(),'hands':hand_report}

g['buffers']=[{'byteLength':len(binary)}]
g['asset']['generator']='Connected Enterprise anatomical cast / Smart Kitchen fitted MakeHuman library'
j=json.dumps(g,separators=(',',':')).encode();j+=b' '*((-len(j))%4);binary.extend(b'\0'*((-len(binary))%4))
result=struct.pack('<III',0x46546c67,2,28+len(j)+len(binary))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(binary),0x004e4942)+binary
output=ASSETS/'enterprise-actors.studio.glb';output.write_bytes(result)
(ASSETS/'enterprise-actors.studio.manifest.json').write_text(json.dumps({'bytes':len(result),'roles':proof,'source':'MakeHuman CC0 fitted Smart Kitchen cast','skinContract':'Existing CE semantic joints, shared geometry and textures, independent cloned skeletons'},indent=2)+'\n')
print(output,len(result),json.dumps(proof),flush=True)
