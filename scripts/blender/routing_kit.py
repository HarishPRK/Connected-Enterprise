"""Office-scale routing story furniture, authored in Blender at real metre scale.

blender -b --factory-startup --python-exit-code 1 --python scripts/blender/routing_kit.py
Only this kit is exported. Existing retail architecture is imported for proofs.
"""
import bpy, json, math, sys
from pathlib import Path
from collections import defaultdict
from mathutils import Vector

HERE=Path(__file__).resolve().parent
OUT=HERE.parents[1]/'src/assets/offerings'
STEM='routing-kit.studio'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
def V(p):return Vector((p[0],-p[2],p[1]))
def ce(p):return [round(p.x,6),round(p.z,6),round(-p.y,6)]
def mat(name,color,metal=0,rough=.5,emission=0):
    rgb=[n/255 for n in bytes.fromhex(color)]
    rgb=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    m=bpy.data.materials.new('Routing / '+name);m.use_nodes=True;m.diffuse_color=(*rgb,1)
    s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=(*rgb,1)
    s.inputs['Metallic'].default_value=metal;s.inputs['Roughness'].default_value=rough
    if emission:s.inputs['Emission Color'].default_value=(*rgb,1);s.inputs['Emission Strength'].default_value=emission
    return m
graphite=mat('graphite anodised aluminium','253430',.55,.33)
black=mat('soft touch polymer','171e1c',0,.53)
spruce=mat('spruce enamel','234d43',.10,.36)
oak=mat('honey oak','ae8153',0,.58)
oak_dark=mat('oak end grain','785c3a',0,.66)
cream=mat('warm mineral desktop','e4dfcc',0,.72)
paper=mat('ivory paper','f1eee1',0,.85)
brass=mat('satin brass','b69a5c',.68,.28)
steel=mat('fasteners and connectors','a8b5b3',.83,.26)
terracotta=mat('terracotta ceramic','b36043',0,.55)
leaf=mat('rubber plant leaves','355b3f',0,.58)
soil=mat('potting soil','30291d',0,.95)
lens=mat('webcam coated lens','2b5865',.75,.18)
keycap=mat('keyboard graphite keycaps','43514b',0,.54)
screen_mats={name:mat(name,'102924',0,.38,.5) for name in ['TeamsMonitorScreen','VoipPhoneScreen']}
led_mats={name:mat(name,'8bd8b7',0,.4,2) for name in ['WebcamStatusLED','MonitorStatusLED','VoipStatusLED','SpeakerphoneStatusRing']}
root=bpy.data.objects.new('RoutingKit',None);scene.collection.objects.link(root)
groups={};current=root;nodes={};dynamic=[]
def group(name,at):
    global current
    current=bpy.data.objects.new(name,None);scene.collection.objects.link(current);current.parent=root;current.location=V(at);groups[name]=current
    return current
def attach(o,m,name,animate=False):
    o.name=name;o.data.materials.append(m);o.parent=current;o.location-=current.location
    if animate:dynamic.append(name);nodes[name]=o
    return o
def bevel(o,width):
    if not width:return
    mod=o.modifiers.new('Manufactured edge radius','BEVEL');mod.width=width;mod.segments=2 if width<.003 else 3
    bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in o.data.polygons:p.use_smooth=True
    mod=o.modifiers.new('Weighted surface normals','WEIGHTED_NORMAL');mod.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=mod.name)
def box(name,p,size,m=graphite,r=.003,animate=False):
    bpy.ops.mesh.primitive_cube_add(size=1,location=V(p));o=bpy.context.object;o.scale=(size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);bevel(o,min(r,min(size)*.24))
    return attach(o,m,name,animate)
def cylinder(name,p,radius,depth,m=steel,axis=(0,1,0),top=None,animate=False,vertices=32):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=radius,radius2=radius if top is None else top,depth=depth,location=V(p));o=bpy.context.object
    o.rotation_mode='QUATERNION';o.rotation_quaternion=Vector((0,0,1)).rotation_difference(V(axis).normalized())
    for f in o.data.polygons:f.use_smooth=len(f.vertices)==4
    return attach(o,m,name,animate)
def sphere(name,p,size,m):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,radius=1,location=V(p));o=bpy.context.object;o.scale=(size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for f in o.data.polygons:f.use_smooth=True
    return attach(o,m,name)
def cable(name,points,r=.0025,m=black):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.resolution_u=10;data.bevel_depth=r;data.bevel_resolution=2
    s=data.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
    for bp,p in zip(s.bezier_points,points):bp.co=V(p);bp.handle_left_type='AUTO';bp.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH')
    return attach(o,m,name)
def face(name,p,size,m):
    x,y,z=p;w,h=size;data=bpy.data.meshes.new(name)
    data.from_pydata([V((x-w/2,y-h/2,z)),V((x+w/2,y-h/2,z)),V((x+w/2,y+h/2,z)),V((x-w/2,y+h/2,z))],[],[(0,1,2,3)])
    uv=data.uv_layers.new(name='Screen UV')
    for item,value in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):item.uv=value
    o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);return attach(o,m,name,True)
def text(word,p,size=.006,m=paper):
    bpy.ops.object.text_add(location=V(p),rotation=(math.pi/2,0,0));o=bpy.context.object;o.data.body=word;o.data.size=size;o.data.align_x='CENTER';o.data.align_y='CENTER';o.data.extrude=.00004;o.data.resolution_u=1
    bpy.ops.object.convert(target='MESH');return attach(o,m,'Engraving '+word)
def torus(name,p,major,minor,m,axis=(0,1,0),animate=False):
    bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=40,minor_segments=8,location=V(p));o=bpy.context.object
    o.rotation_mode='QUATERNION';o.rotation_quaternion=Vector((0,0,1)).rotation_difference(V(axis).normalized())
    for f in o.data.polygons:f.use_smooth=True
    return attach(o,m,name,animate)

def desk(name,z,width,depth):
    group(name,(8,0,z))
    # Top surface exactly 1.10 m; all equipment feet contact it.
    box('Mineral standing desktop',(8,1.078,z),(width,.044,depth),cream,.012)
    box('Oak edge and underside',(8,1.046,z),(width-.018,.02,depth-.018),oak,.005)
    box('Rear cable tray',(8,.982,z-depth/2+.075),(width-.16,.09,.10),graphite,.009)
    for side in [-1,1]:
        x=8+side*(width/2-.12)
        for dz in [-depth*.32,depth*.32]:
            cylinder('Desk rubber levelling foot',(x,.010,z+dz),.031,.020,black,vertices=24)
        box('Standing desk foot',(x,.043,z),(.10,.046,depth*.82),graphite,.012)
        box('Telescopic outer upright',(x,.34,z),(.071,.58,.071),graphite,.007)
        box('Telescopic inner upright',(x,.785,z),(.054,.51,.054),steel,.004)
        box('Desktop underside support',(x,1.021,z),(.084,.034,depth*.70),graphite,.005)
    box('Oak desk modesty panel',(8,.76,z-depth/2+.04),(width-.18,.43,.032),oak,.008)
    for dx in range(16):box('Subtle timber flute',(8-width*.44+dx*width*.058,.76,z-depth/2+.058),(.009,.38,.006),oak_dark,.001)
    box('Desk height controller',(8+width/2-.16,1.036,z+depth/2-.008),(.095,.021,.028),black,.004)
    for dx in [-.02,.02]:box('Desk controller keys',(8+width/2-.16+dx,1.035,z+depth/2+.007),(.014,.006,.001),paper,.001)
    cylinder('Cable grommet',(8+width/2-.17,1.101,z-depth/2+.11),.028,.003,graphite,vertices=32)
desk('BriefingStandingDesk',4.5,1.50,.84)
desk('VoiceStandingCounter',7,1.40,.70)

group('TeamsWorkstation',(8,1.10,4.5))
box('Monitor low profile weighted base',(8,1.110,4.43),(.28,.020,.18),graphite,.009)
box('Monitor base rubber pad',(8,1.101,4.43),(.25,.002,.15),black,.002)
box('Monitor stand riser',(8,1.237,4.438),(.044,.235,.032),steel,.004)
cylinder('VESA tilt barrel',(8,1.36,4.452),.024,.14,graphite,(1,0,0))
box('Rear VESA mounting plate',(8,1.44,4.458),(.13,.14,.021),graphite,.008)
box('Monitor machined rear housing',(8,1.50,4.483),(.62,.361,.043),graphite,.009)
box('Monitor rear ventilation recess',(8,1.38,4.460),(.47,.030,.003),black,.002)
for i in range(22):box('Rear panel cooling slots',(7.78+i*.021,1.385,4.458),(.008,.018,.002),black,.0003)
box('Monitor bezel',(8,1.50,4.507),(.615,.357,.006),black,.003)
face('TeamsMonitorScreen',(8,1.50,4.511),(.60,.3375),screen_mats['TeamsMonitorScreen'])
text('CONNECTED WORKPLACE',(8,1.326,4.511),.0044,steel)
cylinder('MonitorStatusLED',(8.287,1.327,4.512),.0012,.0008,led_mats['MonitorStatusLED'],(0,0,1),animate=True,vertices=16)
box('Webcam hinge clip',(8,1.686,4.475),(.047,.015,.048),black,.004)
box('Webcam microphone housing',(8,1.708,4.491),(.092,.029,.033),graphite,.010)
cylinder('Webcam glass optical barrel',(8,1.708,4.510),.009,.010,black,(0,0,1))
cylinder('Webcam coated lens',(8,1.708,4.516),.0065,.0015,lens,(0,0,1),vertices=32)
for side in [-1,1]:
    for i in range(3):cylinder('Webcam microphone hole',(8+side*(.025+i*.005),1.708,4.508),.001,.001,black,(0,0,1),vertices=12)
cylinder('WebcamStatusLED',(8.017,1.708,4.509),.0012,.001,led_mats['WebcamStatusLED'],(0,0,1),animate=True,vertices=16)
cable('Webcam USB lead',[(8,1.708,4.470),(8.045,1.65,4.451),(8.035,1.30,4.447),(8.08,1.112,4.26),(8.58,1.105,4.19)],.0017)
cable('Monitor power and data loom',[(8.1,1.36,4.46),(8.07,1.20,4.45),(8.08,1.11,4.26),(8.58,1.10,4.19),(8.58,.96,4.19)],.003)
for y in [1.17,1.24,1.31]:box('Riser cable retaining clip',(8.023,y,4.432),(.015,.012,.035),black,.002)

group('DeskKeyboard',(8,1.1,4.78))
box('Keyboard rubber feet',(8,1.102,4.78),(.394,.004,.12),black,.005)
box('Keyboard aluminium deck',(8,1.111,4.78),(.41,.014,.137),graphite,.008)
# A compact, correctly sized keyboard with individually rounded, separated keys.
for row in range(5):
    count=14 if row<4 else 7
    for col in range(count):
        if row==4 and col in [2,3,4]:continue
        if row<4:x=7.816+col*.028;y=1.122;z=4.727+row*.023;width=.023
        else:x=7.816+col*.057;y=1.122;z=4.819;width=.049
        box('Sculpted keyboard key',(x,y,z),(width,.008,.018),keycap,.003)
        box('Key legend',(x,y+.0042,z-.003),(.006,.0004,.001),paper,.0001)
box('Keyboard spacebar',(8,1.122,4.819),(.14,.008,.018),keycap,.003)
cable('Keyboard rear lead',[(8.18,1.111,4.711),(8.22,1.108,4.65),(8.43,1.105,4.54),(8.58,1.105,4.19)],.0017)
group('DeskMouse',(8.37,1.1,4.79))
box('Mouse mat',(8.40,1.101,4.77),(.19,.002,.19),spruce,.012)
sphere('Ergonomic wireless mouse',(8.40,1.118,4.78),(.031,.019,.052),black)
box('Mouse split seam',(8.40,1.131,4.754),(.001,.001,.050),graphite,.0002)
cylinder('Mouse knurled scroll wheel',(8.40,1.136,4.757),.006,.008,steel,(1,0,0),vertices=20)

group('DeskPersonalObjects',(7.45,1.1,4.5))
box('Closed linen notebook',(7.46,1.114,4.71),(.16,.028,.22),spruce,.006)
box('Notebook paper block',(7.46,1.114,4.712),(.151,.023,.213),paper,.003)
box('Notebook top cover',(7.46,1.129,4.71),(.16,.003,.22),spruce,.003)
box('Notebook elastic strap',(7.514,1.131,4.71),(.009,.002,.218),black,.001)
cylinder('Brass pen',(7.43,1.136,4.71),.004,.14,brass,(0,0,1),vertices=16)
cylinder('Terracotta plant pot',(7.43,1.153,4.29),.050,.106,terracotta,top=.062)
cylinder('Planter soil',(7.43,1.202,4.29),.055,.006,soil,vertices=24)
for i in range(7):
    a=i*2.399;end=(7.43+math.cos(a)*.083,1.27+(i%3)*.027,4.29+math.sin(a)*.075)
    cable('Plant stem',[(7.43,1.205,4.29),(7.43,1.235,4.29),end],.0015,leaf)
    o=sphere('Rubber plant leaf',end,(.035,.005,.019),leaf);o.rotation_euler.z=a

group('VoipDeskPhone',(8,1.1,7))
box('Phone rubber contact feet',(8,1.102,7),(.235,.004,.185),black,.006)
box('VoIP phone weighted base',(8,1.126,7),(.27,.048,.22),graphite,.012)
box('Phone speaker grille',(8.077,1.153,7.002),(.098,.005,.070),black,.004)
for row in range(6):
    for col in range(10):cylinder('Phone grille perforation',(8.035+col*.009,1.156,6.979+row*.009),.0012,.0008,keycap,vertices=8)
box('Phone display support',(8.025,1.20,6.932),(.162,.105,.031),graphite,.006)
box('Phone display bezel',(8.025,1.238,6.946),(.161,.091,.012),black,.004)
face('VoipPhoneScreen',(8.025,1.238,6.9525),(.145,.076),screen_mats['VoipPhoneScreen'])
cylinder('VoipStatusLED',(8.096,1.282,6.953),.0015,.0008,led_mats['VoipStatusLED'],(0,0,1),animate=True,vertices=16)
# Handset remains a separate transformable group with cradle contact pads.
for z in [6.927,7.075]:box('Handset cradle rubber seat',(7.912,1.159,z),(.054,.012,.043),black,.006)
handset=group('VoipHandset',(7.912,1.190,7.0))
box('Handset grip spine',(7.912,1.193,7.0),(.038,.032,.144),black,.012)
for z in [6.914,7.086]:
    sphere('Handset acoustic cup',(7.912,1.188,z),(.035,.027,.040),black)
    cylinder('Handset inner speaker',(7.912,1.169,z),.018,.003,graphite,vertices=24)
# One continuous helix, including both strain-relief leads. Separate short
# curves would create visible breaks between turns at close inspection.
coil=[(7.912,1.174,7.119),(7.89,1.170,7.11)]
for i in range(61):
    a=i*math.pi/6;coil.append((7.88+math.cos(a)*.008,1.163-i*.00095,7.11+math.sin(a)*.008))
coil.extend([(7.854,1.108,7.103),(7.853,1.126,7.079),(7.869,1.13,7.075)])
cable('Continuous coiled handset lead',coil,.0012)
cylinder('Handset lead base strain relief',(7.865,1.13,7.075),.003,.012,black,(1,0,0),vertices=16)
group('VoipDeskPhoneControls',(8,1.1,7))
for row in range(4):
    for col in range(3):
        x=8.016+col*.027;z=7.035+row*.019
        box('Telephone dial key',(x,1.154,z),(.022,.009,.014),keycap,.003)
        box('Dial key small legend',(x,1.159,z),(.004,.0004,.001),paper,.0001)
cable('VoIP ethernet lead',[(8.105,1.128,6.89),(8.16,1.114,6.80),(8.52,1.104,6.76),(8.52,.96,6.76)],.0024)

group('ConferenceSpeakerphone',(8.42,1.1,7.02))
cylinder('Speakerphone rubber foot',(8.42,1.102,7.02),.058,.004,black,vertices=40)
cylinder('Speakerphone puck chassis',(8.42,1.119,7.02),.064,.030,graphite,top=.061,vertices=48)
cylinder('Acoustic top fabric',(8.42,1.136,7.02),.055,.004,black,vertices=48)
for ring in range(1,7):
    for i in range(ring*9):
        a=i*math.tau/(ring*9);r=ring*.0075
        cylinder('Acoustic grille hole',(8.42+math.cos(a)*r,1.1385,7.02+math.sin(a)*r),.0013,.0006,keycap,vertices=6)
torus('SpeakerphoneStatusRing',(8.42,1.137,7.02),.058,.0013,led_mats['SpeakerphoneStatusRing'],animate=True)
for dx in [-.025,0,.025]:box('Puck touch key',(8.42+dx,1.139,7.041),(.009,.0008,.002),paper,.0003)
cable('Speakerphone USB lead',[(8.42,1.116,6.956),(8.47,1.105,6.88),(8.52,1.105,6.76)],.0018)

# Consolidate static detail within each logical device, preserving all screen,
# indicator and handset transforms for R3F interaction.
for name,parent in groups.items():
    by_material=defaultdict(list)
    for obj in parent.children:
        if obj.type=='MESH' and obj.name not in dynamic:by_material[obj.data.materials[0].name].append(obj)
    for material,objects in by_material.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1:bpy.ops.object.join()
        objects[0].name=name+'_'+material.rsplit('/',1)[-1].strip().replace(' ','')
bpy.context.view_layer.update()
def bounds(objects):
    points=[obj.matrix_world@Vector(c) for obj in objects if obj.type=='MESH' for c in obj.bound_box]
    a=[min(ce(p)[i] for p in points) for i in range(3)];b=[max(ce(p)[i] for p in points) for i in range(3)]
    return {'min':a,'max':b,'size':[round(b[i]-a[i],6) for i in range(3)]}
mesh_objects=[o for o in root.children_recursive if o.type=='MESH']
manifest={'root':'RoutingKit','units':'meters','up':'+Y','front':'+Z','placement':'World coordinates. Render with identity transform and unit scale.',
 'architectureHideGroup':'CheckoutFixtures','bounds':bounds(mesh_objects),
 'groups':{name:{'origin':ce(parent.matrix_world.translation),'bounds':bounds(parent.children_recursive)} for name,parent in groups.items()},
 'animatedNodes':{},
 'surfaces':{'TeamsMonitorScreen':{'center':[8,1.50,4.511],'size':[.60,.3375],'frontNormal':[0,0,1]},'VoipPhoneScreen':{'center':[8.025,1.238,6.9525],'size':[.145,.076],'frontNormal':[0,0,1]}},
 'actorPositions':{'briefing':{'root':[8,0,5.35],'facing':[0,0,-1],'keyboardTarget':[8,1.125,4.78]},'voice':{'root':[8,0,7.75],'facing':[0,0,-1]}},
 'notes':['Hide only CheckoutFixtures when routing. All original architecture remains unchanged for other scenarios.','27-inch-class display is 620 mm across its housing; 600 x 337.5 mm screen. Generic branded-free hardware.','Standing desk surfaces are 1.10 m above floor. Conference phone footprint 270 x 220 mm; speakerphone diameter 128 mm.','Screen meshes have full 0..1 UVs and front +Z normals. Hide each named screen and add runtime surfaces at z +0.0005.','No external textures, downloaded models, animations or embedded lights. Equipment detail is authored in Blender.']}
for name,obj in nodes.items():
    b=bounds([obj]);manifest['animatedNodes'][name]={'group':obj.parent.name,'center':[round((a+b)/2,6) for a,b in zip(b['min'],b['max'])],'bounds':b,'material':obj.data.materials[0].name}
manifest['triangles']=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in mesh_objects)
bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
for obj in root.children_recursive:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/(STEM+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False)
manifest['bytes']=(OUT/(STEM+'.glb')).stat().st_size;manifest['meshCount']=len(mesh_objects)
(OUT/(STEM+'.manifest.json')).write_text(json.dumps(manifest,indent=2)+'\n')
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(HERE/(STEM+'.blend')))
print('ROUTING_EXPORTED',manifest['bytes'],manifest['triangles'],flush=True)

bpy.ops.import_scene.gltf(filepath=str(OUT/'enterprise-store.studio.glb'))
old=bpy.data.objects.get('CheckoutFixtures')
if old:
    for o in [old,*old.children_recursive]:o.hide_render=True
world=bpy.data.worlds.new('Routing warm studio');world.use_nodes=True;scene.world=world
world.node_tree.nodes['Background'].inputs[0].default_value=(.14,.20,.18,1);world.node_tree.nodes['Background'].inputs[1].default_value=.45
def area(name,at,target,power,size,color):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.size=size;data.color=color
    o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=V(at);o.rotation_euler=(V(target)-o.location).to_track_quat('-Z','Y').to_euler()
area('Large warm softbox',(6,6,6),(8,1,5),600,4,(1,.91,.77));area('Cool right edge',(11,4,3),(8,1.3,4.5),350,3,(.72,.85,1))
data=bpy.data.cameras.new('Routing proof');cam=bpy.data.objects.new('Routing proof',data);scene.collection.objects.link(cam);scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.view_settings.view_transform='AgX';scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
for suffix,at,target,scale,width,height in [
 ('-proof',(11.5,4.3,10.8),(8,1.1,5.45),4.9,1600,1100),
 ('-workstation-proof',(9.1,2.2,6.6),(8,1.35,4.55),1.65,1400,1100),
 ('-phone-proof',(8.65,1.95,7.95),(8.13,1.20,7.0),.76,1200,1000),
]:
    if '--phone-proof' in sys.argv and suffix!='-phone-proof':continue
    cam.location=V(at);cam.rotation_euler=(V(target)-cam.location).to_track_quat('-Z','Y').to_euler();data.type='ORTHO';data.ortho_scale=scale
    scene.render.resolution_x=width;scene.render.resolution_y=height;scene.render.filepath=str(OUT/(STEM+suffix+'.png'));bpy.ops.render.render(write_still=True)
print('ROUTING_PROOF_COMPLETE',flush=True)
