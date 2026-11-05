"""Compact, physically scaled automation equipment for the existing CE store.

blender -b --factory-startup --python-exit-code 1 --python scripts/blender/automation_kit.py
Coordinates are metres, Three.js +Y up, visible equipment fronts face +Z.
Only this kit is exported. Existing architecture is imported afterwards for QA.
"""
import bpy, json, math, sys
from pathlib import Path
from collections import defaultdict
from mathutils import Vector

HERE=Path(__file__).resolve().parent
OUT=HERE.parents[1]/'src/assets/offerings'
OUT.mkdir(parents=True,exist_ok=True)
STEM='automation-kit.studio'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
def V(p):return Vector((p[0],-p[2],p[1]))
def ce(p):return [round(p.x,6),round(p.z,6),round(-p.y,6)]
def mat(name,hex,metal=0,rough=.55,emission=0,alpha=1):
    rgb=[v/255 for v in bytes.fromhex(hex)]
    rgb=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*rgb,alpha)
    s=m.node_tree.nodes.get('Principled BSDF')
    s.inputs['Base Color'].default_value=(*rgb,alpha);s.inputs['Metallic'].default_value=metal
    s.inputs['Roughness'].default_value=rough
    if emission:s.inputs['Emission Color'].default_value=(*rgb,1);s.inputs['Emission Strength'].default_value=emission
    if alpha<1:s.inputs['Alpha'].default_value=alpha;m.surface_render_method='DITHERED'
    return m
ivory=mat('Automation / warm appliance polymer','e7e8dc',0,.34)
white=mat('Automation / porcelain faceplate','f1f0e7',0,.30)
seam=mat('Automation / polymer mould seam','a6ada6',0,.55)
spruce=mat('Automation / spruce enamel','234d43',.15,.4)
graphite=mat('Automation / graphite hardware','24312f',.3,.36)
black=mat('Automation / insulated cable jacket','171e1c',0,.72)
brass=mat('Automation / satin brass','b69a5c',.68,.28)
steel=mat('Automation / stainless fasteners','a8b5b3',.84,.26)
red=mat('Automation / Shelly red polymer','bb342d',0,.4)
blue=mat('Automation / blue insulation','326db0',0,.58)
brown=mat('Automation / brown insulation','764b31',0,.6)
pcb=mat('Automation / green circuit board','1e624b',.12,.5)
copper=mat('Automation / copper contact','be8647',.82,.3)
glass=mat('Automation / isolated transparent service cover','b5d6d0',0,.12,alpha=.10)
wood=mat('Automation / door honey oak','ae8153',0,.5)
cream=mat('Automation / architectural mineral','e4dfcc',0,.8)
leds={name:mat('Automation / '+name,'8fe8bc' if 'Indicator' in name or 'LED' in name else 'fff0ca',0,.35,2)
      for name in ['WiFiPlugLED','ThreadPlugLED','ShellyIndicator','ZigbeeSensorLED','WiFiAPLED','ThreadBorderRouterLED','ZigbeeBridgeLED','ControllerStatusLED']}
faces={name:mat('Automation / '+name,color,0,.5,1.0) for name,color in
       [('PromoDisplayFace','fff0c9'),('LampDiffuser','ffe4ad'),('IlluminatedSignFace','ffeabf'),('EdgeControllerScreen','a9d9ca')]}

root=bpy.data.objects.new('AutomationKit',None);scene.collection.objects.link(root)
groups={};current=root;dynamic=[];nodes={}
def group(name,at):
    global current
    current=bpy.data.objects.new(name,None);scene.collection.objects.link(current)
    current.parent=root;current.location=V(at);groups[name]=current
    return current
def attach(obj,material,name,animate=False):
    obj.name=name;obj.data.materials.append(material);obj.parent=current;obj.location-=current.location
    if animate:dynamic.append(name);nodes[name]=obj
    return obj
def bevel(obj,width):
    if width<=0:return
    mod=obj.modifiers.new('Manufactured edge radius','BEVEL');mod.width=width;mod.segments=3
    bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in obj.data.polygons:p.use_smooth=True
    mod=obj.modifiers.new('Weighted surface normals','WEIGHTED_NORMAL');mod.keep_sharp=True
    bpy.ops.object.modifier_apply(modifier=mod.name)
def box(name,p,size,material=ivory,r=.002,animate=False):
    bpy.ops.mesh.primitive_cube_add(size=1,location=V(p));o=bpy.context.object
    o.scale=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    bevel(o,min(r,min(size)*.24));return attach(o,material,name,animate)
def cylinder(name,p,radius,depth,material=steel,axis=(0,1,0),top=None,animate=False,vertices=32):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=radius,radius2=radius if top is None else top,depth=depth,location=V(p))
    o=bpy.context.object;o.rotation_mode='QUATERNION';o.rotation_quaternion=Vector((0,0,1)).rotation_difference(V(axis).normalized())
    for face in o.data.polygons:face.use_smooth=len(face.vertices)==4
    return attach(o,material,name,animate)
def cable(name,points,r=.003,material=black):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.resolution_u=12;data.bevel_depth=r;data.bevel_resolution=3
    spline=data.splines.new('BEZIER');spline.bezier_points.add(len(points)-1)
    for bp,p in zip(spline.bezier_points,points):bp.co=V(p);bp.handle_left_type='AUTO';bp.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,data);scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False)
    return attach(o,material,name)
def face(name,p,size,material):
    # One front-facing plane with full [0,1] UVs, ready for a runtime canvas.
    x,y,z=p;w,h=size
    mesh=bpy.data.meshes.new(name);mesh.from_pydata([V((x-w/2,y-h/2,z)),V((x+w/2,y-h/2,z)),V((x+w/2,y+h/2,z)),V((x-w/2,y+h/2,z))],[],[(0,1,2,3)])
    uv=mesh.uv_layers.new(name='Display UV')
    for item,value in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):item.uv=value
    obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj)
    return attach(obj,material,name,True)
def text(word,p,size=.009,material=graphite):
    bpy.ops.object.text_add(location=V(p),rotation=(math.pi/2,0,0));o=bpy.context.object
    o.data.body=word;o.data.size=size;o.data.align_x='CENTER';o.data.align_y='CENTER';o.data.extrude=.00006;o.data.resolution_u=2
    bpy.ops.object.convert(target='MESH');return attach(o,material,'Engraving '+word)
def screw(p,r=.002):
    cylinder('Recessed fastener',p,r,.001,steel,(0,0,1),vertices=16)
    box('Fastener slot',(p[0],p[1],p[2]+.0006),(r*1.25,r*.2,.0003),graphite,0)
def plate(x,y):
    box('Surface outlet back box',(x,y,-1.461),(.086,.086,.058),ivory,.006)
    box('Outlet faceplate',(x,y,-1.427),(.086,.086,.010),white,.005)
    for dy in [-.032,.032]:screw((x,y+dy,-1.4216),.0016)
def plug(name,x,y,w,h,d):
    group(name,(x,y,-1.385 if name=='WiFiPlug' else -1.382))
    z=-1.385 if name=='WiFiPlug' else -1.382
    plate(x,y)
    cylinder('Socket insertion collar',(x,y,-1.411),.018,.021,ivory,(0,0,1))
    box('Compact smart plug shell',(x,y,z),(w,h,d),ivory,.007)
    cylinder('Recessed outlet rim',(x,y-.004,z+d/2+.0005),.020,.003,white,(0,0,1))
    cylinder('Socket cavity',(x,y-.004,z+d/2+.002),.016,.001,black,(0,0,1))
    for dx in [-.0095,.0095]:cylinder('Socket pin opening',(x+dx,y-.004,z+d/2+.0028),.0026,.001,graphite,(0,0,1),vertices=16)
    for dy in [-.014,.006]:box('Earth contact clip',(x,y+dy,z+d/2+.003),(.005,.004,.001),brass,.0002)
    # Inserted load connector has its own moulded body and ribbed strain relief.
    box('Inserted load plug',(x,y-.004,z+d/2+.010),(.025,.029,.020),black,.006)
    for k in range(5):cylinder('Cord strain relief rib',(x,y-.022-k*.0025,z+d/2+.011),.004,.0016,black,vertices=16)
    led_name=name+'LED';led_y=y+h/2-.010
    cylinder('Power button bezel',(x,led_y,z+d/2+.0008),.0048,.0012,seam,(0,0,1),vertices=24)
    cylinder(led_name,(x,led_y,z+d/2+.0017),.0028,.0008,leds[led_name],(0,0,1),animate=True,vertices=24)
    text('Wi-Fi' if name=='WiFiPlug' else 'Thread',(x,y-h/2+.006,z+d/2+.0008),.0047)
    return (x,y-.032,z+d/2+.011)

wifi_exit=plug('WiFiPlug',-11.25,1.40,.051,.072,.040)
cable('PromoDisplayPowerLead',[wifi_exit,(-11.25,1.33,-1.345),(-11.43,1.34,-1.35),(-11.57,1.55,-1.40),(-11.51,1.89,-1.43)],.0028)
thread_exit=plug('ThreadPlug',-10.2,1.40,.056,.056,.045)
cable('DeskLampPowerLead',[thread_exit,(-10.2,1.28,-1.32),(-10.38,.90,-1.31),(-10.27,.802,-1.14)],.0026)

group('PromoDisplay',(-11.25,1.98,-1.42))
box('Promotional display wall bracket',(-11.25,1.98,-1.468),(.27,.15,.045),graphite,.006)
box('Promotional display chassis',(-11.25,1.98,-1.424),(.61,.37,.05),graphite,.009)
box('Promotional display warm bezel',(-11.25,1.98,-1.401),(.595,.355,.006),brass,.004)
face('PromoDisplayFace',(-11.25,1.98,-1.397),(.58,.34),faces['PromoDisplayFace'])
for dx in [-.26,.26]:screw((-11.25+dx,1.825,-1.397),.0015)

group('DeskLamp',(-10.2,.79,-1.14))
cylinder('Lamp rubber contact foot',(-10.2,.7875,-1.14),.070,.005,black)
cylinder('Lamp weighted foot',(-10.2,.803,-1.14),.080,.026,spruce)
cylinder('Lamp stem collar',(-10.2,.83,-1.14),.022,.028,brass)
cylinder('Lamp brass stem',(-10.2,1.005,-1.14),.006,.33,brass,vertices=24)
cylinder('Lamp shade',(-10.2,1.20,-1.14),.108,.15,spruce,top=.052)
cylinder('Shade interior reflector',(-10.2,1.167,-1.14),.098,.074,ivory,top=.050)
cylinder('LampDiffuser',(-10.2,1.126,-1.14),.094,.008,faces['LampDiffuser'],animate=True)
cylinder('Lamp brass finial',(-10.2,1.286,-1.14),.012,.018,brass)

group('ShellyRelay',(-9.1,1.40,-1.4))
# Recessed relay and a transparent, sealed service cover. No loose live copper.
box('Relay enclosure back',(-9.1,1.40,-1.468),(.14,.13,.044),ivory,.008)
for dx in [-.066,.066]:box('Relay enclosure side',(-9.1+dx,1.4,-1.415),(.008,.13,.096),ivory,.002)
for dy in [-.061,.061]:box('Relay enclosure top bottom',(-9.1,1.4+dy,-1.415),(.124,.008,.096),ivory,.002)
box('Isolated relay mounting plate',(-9.1,1.40,-1.43),(.113,.105,.004),graphite,.001)
for dx in [-.027,.027]:cylinder('Relay mounting spacer',(-9.1+dx,1.40,-1.419),.004,.022,ivory,(0,0,1),vertices=20)
box('Shelly red module',(-9.1,1.40,-1.400),(.042,.037,.016),red,.005)
box('Shelly front lid',(-9.1,1.402,-1.3916),(.036,.029,.0012),red,.002)
text('Shelly',(-9.1,1.405,-1.3908),.0055,white)
text('PLUS 1PM',(-9.1,1.399,-1.3908),.0031,white)
box('ShellyRelayContact',(-9.113,1.401,-1.3906),(.004,.008,.001),graphite,.0004,True)
cylinder('ShellyIndicator',(-9.0855,1.411,-1.3903),.00115,.0008,leds['ShellyIndicator'],(0,0,1),animate=True,vertices=20)
for i,label in enumerate(['O','L','L','SW','N','N']):
    x=-9.116+i*.0064
    box('Protected relay screw terminal',(x,1.383,-1.399),(.0055,.006,.009),graphite,.0005)
    cylinder('Terminal screw head',(x,1.383,-1.3938),.0017,.0007,steel,(0,0,1),vertices=16)
    text(label,(x,1.389,-1.3908),.0022,white)
for i,material in enumerate([brown,brown,blue]):
    x=-9.114+i*.014
    cable('Insulated relay harness',[(x,1.382,-1.402),(x,1.365,-1.408),(-9.15+i*.015,1.36,-1.425)],.00115,material)
box('RelayServiceCover',(-9.1,1.40,-1.366),(.138,.128,.006),glass,.003,True)
for dx in [-.056,.056]:
    for dy in [-.05,.05]:screw((-9.1+dx,1.4+dy,-1.3627),.0023)
cylinder('Load cable gland',(-9.1,1.472,-1.425),.007,.016,graphite)
cable('ShellySignPowerLead',[(-9.1,1.48,-1.425),(-9.1,1.57,-1.432),(-9.33,1.69,-1.444),(-9.33,2.0,-1.444)],.003)

group('IlluminatedSign',(-9.1,2.05,-1.42))
box('Sign mounting blocks',(-9.1,2.05,-1.465),(.36,.12,.048),graphite,.004)
box('Sign spruce chassis',(-9.1,2.05,-1.424),(.69,.25,.05),spruce,.009)
box('Sign brass reveal',(-9.1,2.05,-1.400),(.674,.234,.004),brass,.003)
face('IlluminatedSignFace',(-9.1,2.05,-1.397),(.66,.22),faces['IlluminatedSignFace'])

group('EdgeController',(-10.2,1.97,-1.42))
box('Controller wall mount',(-10.2,1.97,-1.4665),(.11,.085,.047),steel,.003)
box('Controller finned back',(-10.2,1.97,-1.427),(.257,.16,.048),graphite,.006)
for i in range(16):box('Controller cooling groove',(-10.315+i*.0153,2.048,-1.426),(.004,.006,.036),black,.0007)
box('Controller front bezel',(-10.2,1.97,-1.402),(.25,.15,.008),graphite,.004)
face('EdgeControllerScreen',(-10.2,1.97,-1.397),(.23,.13),faces['EdgeControllerScreen'])
cylinder('ControllerStatusLED',(-10.087,1.903,-1.396),.0014,.0007,leds['ControllerStatusLED'],(0,0,1),animate=True,vertices=16)
cable('Controller low voltage lead',[(-10.29,1.88,-1.443),(-10.29,1.75,-1.443),(-10.44,1.53,-1.444),(-10.44,.84,-1.444)],.0024)

def network_box(name,x,width,depth,height,label):
    y=.79+height/2;z=-1.1
    group(name,(x,y,z))
    for dx in [-width*.32,width*.32]:
        for dz in [-depth*.32,depth*.32]:cylinder('Rubber equipment foot',(x+dx,.7875,z+dz),.005,.005,black,vertices=16)
    box(name+' base',(x,.794,z),(width,.008,depth),graphite,.004)
    box(name+' housing',(x,y+.003,z),(width,height,depth),ivory,.008)
    for side in [-1,1]:
        for i in range(9):box('Network device cooling slot',(x+side*(width/2+.0001),y,z-depth*.32+i*depth*.08),(.0008,.014,.0026),black,.0002)
    ledname=name+'LED';front=z+depth/2+.0006
    box(ledname,(x,y+.006,front),(.011,.002,.001),leds[ledname],.0002,True)
    text(label,(x,y-.009,front+.0006),.0047)
    # Rear RJ45 socket, USB power inlet and actual leads, not floating symbols.
    box('Rear Ethernet port',(x-.022,y,z-depth/2-.0006),(.014,.011,.002),graphite,.001)
    box('Rear power inlet',(x+.025,y,z-depth/2-.0006),(.007,.003,.002),black,.0007)
    cable('Network device power lead',[(x+.025,y,z-depth/2-.003),(x+.025,.807,-1.28),(x+.025,.81,-1.43)],.0018)
    cable('Network device patch cord',[(x-.022,y,z-depth/2-.004),(x-.06,.81,-1.27),(x-.06,.815,-1.43)],.0021,blue)
network_box('WiFiAP',-9.55,.12,.10,.062,'WI-FI AP')
network_box('ThreadBorderRouter',-9.15,.105,.10,.045,'THREAD BR')
network_box('ZigbeeBridge',-8.75,.105,.10,.045,'ZIGBEE')

group('ZigbeePresenceSensor',(-10.15,2.77,-.95))
# Small radar sensor on a ceiling/cantilever mounting foot; the dome faces down.
box('Presence sensor wall anchor',(-10.15,2.55,-1.465),(.065,.10,.05),graphite,.004)
box('Presence sensor overhead riser',(-10.15,2.72,-1.46),(.025,.32,.025),graphite,.003)
box('Presence sensor cantilever',(-10.15,2.875,-1.205),(.025,.025,.535),graphite,.003)
cylinder('Sensor mounting foot',(-10.15,2.851,-.95),.019,.022,ivory,vertices=32)
cylinder('Sensor swivel joint',(-10.15,2.825,-.95),.009,.03,graphite,vertices=24)
box('Zigbee presence radar body',(-10.15,2.784,-.95),(.0442,.059,.0442),ivory,.008)
cylinder('Radar white lens',(-10.15,2.752,-.95),.0195,.006,white,vertices=40)
cylinder('ZigbeeSensorLED',(-10.15,2.748,-.939),.0013,.0008,leds['ZigbeeSensorLED'],animate=True,vertices=20)
box('Sensor pairing button',(-10.128,2.783,-.946),(.001,.005,.010),seam,.0005)
cable('Sensor USB supply',[(-10.15,2.80,-.972),(-10.15,2.83,-1.05),(-10.15,2.86,-1.44),(-10.15,2.6,-1.445)],.0018,ivory)

# Context: the staff door is a genuine hinged leaf in the free gap beside the
# existing automation wall, not a painted outline on an obstructing wallboard.
group('StaffDoorFrame',(-7.55,0,-1.55))
for x in [-8.065,-7.035]:box('Door frame jamb',(x,1.1,-1.55),(.09,2.2,.16),graphite,.008)
box('Door frame lintel',(-7.55,2.155,-1.55),(1.12,.09,.16),graphite,.008)
box('Staff threshold',(-7.55,.012,-1.55),(1.03,.024,.18),steel,.004)
box('Staff door header',(-7.55,2.27,-1.545),(1.07,.15,.055),spruce,.006)
text('STAFF',(-7.55,2.27,-1.515),.067,white)
for y in [.3,1.1,1.9]:cylinder('Door hinge barrel',(-8.02,y,-1.49),.012,.11,steel,vertices=24)
group('StaffDoorHinge',(-8.02,0,-1.49))
box('StaffDoorLeaf',(-7.55,1.065,-1.49),(.94,2.10,.044),wood,.008)
box('Door inset panel',(-7.55,1.38,-1.465),(.70,1.12,.008),spruce,.005)
box('Door kick plate',(-7.55,.18,-1.464),(.87,.27,.006),steel,.003)
cylinder('Door handle spindle',(-7.17,1.05,-1.451),.014,.034,steel,(0,0,1),vertices=24)
cylinder('DoorHandle',(-7.22,1.05,-1.426),.009,.115,brass,(1,0,0),animate=True,vertices=24)

# Static micro-detail meshes are combined by material within each device. LED,
# display, relay, cover and hinge nodes retain their exact animation identity.
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
    points=[obj.matrix_world@Vector(corner) for obj in objects if obj.type=='MESH' for corner in obj.bound_box]
    a=[min(ce(p)[i] for p in points) for i in range(3)];b=[max(ce(p)[i] for p in points) for i in range(3)]
    return {'min':a,'max':b,'size':[round(b[i]-a[i],6) for i in range(3)]}
mesh_objects=[o for o in root.children_recursive if o.type=='MESH']
manifest={'root':'AutomationKit','units':'meters','up':'+Y','front':'+Z','placement':'Already in enterprise store world coordinates; render at identity scale/transform.',
 'bounds':bounds(mesh_objects),'groups':{name:{'origin':ce(parent.matrix_world.translation),'bounds':bounds(parent.children_recursive)} for name,parent in groups.items()},
 'animatedNodes':{name:{'group':obj.parent.name,'center':ce(obj.matrix_world.translation),'bounds':bounds([obj]),'material':obj.data.materials[0].name} for name,obj in nodes.items()},
 'door':{'node':'StaffDoorHinge','pivot':[-8.02,0,-1.49],'rotationAxis':'+Y','closedAngle':0,'openAngle':1.42,'passageCenter':[-7.55,0,-1.49],'swingDirection':'toward negative Z, behind automation wall'},
 'outputs':{'WiFiPlug':'PromoDisplayFace','ThreadPlug':'LampDiffuser','ShellyRelay':'IlluminatedSignFace'},
 'lampLightPosition':[-10.2,1.116,-1.14],
 'sources':[
  {'device':'Wi-Fi Matter smart plug','url':'https://www.tp-link.com/en/home-networking/smart-plug/tapo-p110m/','note':'Generic housing inspired by 72 x 51 x 40 mm EU P110M dimensions, not a P125M replica.'},
  {'device':'Thread Matter smart plug','url':'https://www.evehome.com/en/eve-energy','note':'Generic European housing, 56 x 56 mm front, installed body excludes concealed rear pins.'},
  {'device':'Shelly Plus 1PM','url':'https://www.shelly.com/blogs/documentation/shelly-plus-1pm','note':'42 x 37 x 16 mm red module, illustrative enclosed installation.'},
  {'device':'Zigbee presence sensor','url':'https://support.sonoff.tech/snzb-06p-usermanual/','note':'Generic 44.2 x 44.2 x 59 mm radar sensor and separate bridge. Proposed illustrative adapter, not claimed app support.'}],
 'notes':['Display/front planes have full 0..1 UVs and independent materials for runtime text and on/off changes.','All electrical wiring is a visual illustration behind an isolated cover, not an installation diagram.','Door opening swing avoids the existing leftmost gondola (its left edge is x=-6.6).','Hide the old oversized sensor/thermostat/lock models in the automation scenario to avoid duplicate equipment.']}
for name,obj in nodes.items():
    # Plane objects retain world-coordinate vertices: their actual visual centre
    # comes from bounds, not their mesh origin. Runtime should use these centres.
    b=manifest['animatedNodes'][name]['bounds'];manifest['animatedNodes'][name]['center']=[round((a+b)/2,6) for a,b in zip(b['min'],b['max'])]
manifest['triangles']=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in mesh_objects)
bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
for obj in root.children_recursive:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/(STEM+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False)
manifest['bytes']=(OUT/(STEM+'.glb')).stat().st_size
(OUT/(STEM+'.manifest.json')).write_text(json.dumps(manifest,indent=2)+'\n')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/(STEM+'.blend')))
print('AUTOMATION_EXPORTED',manifest['bytes'],manifest['triangles'],flush=True)

# Actual architecture is proof context only and never enters the kit export.
bpy.ops.import_scene.gltf(filepath=str(OUT/'enterprise-store.studio.glb'))
world=bpy.data.worlds.new('Warm automation studio');world.use_nodes=True;scene.world=world
world.node_tree.nodes['Background'].inputs[0].default_value=(.14,.20,.18,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.45
def area(name,at,power,size,color):
    light=bpy.data.lights.new(name,'AREA');light.energy=power;light.size=size;light.color=color
    obj=bpy.data.objects.new(name,light);scene.collection.objects.link(obj);obj.location=V(at)
    obj.rotation_euler=(V((-10,1.5,-1.4))-obj.location).to_track_quat('-Z','Y').to_euler()
area('Large warm softbox',(-11,6,2),500,4,(1,.91,.77));area('Cool edge',(-6,4,-.5),250,3,(.72,.85,1))
camera=bpy.data.cameras.new('Automation proof');cam=bpy.data.objects.new('Automation proof',camera);scene.collection.objects.link(cam);scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.view_settings.view_transform='AgX';scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
for suffix,at,target,scale,width,height in [
 ('-proof',(-7.1,3.5,4.8),(-9.7,1.45,-1.3),5.2,1600,1100),
 ('-plug-proof',(-11.08,1.50,-1.05),(-11.25,1.40,-1.39),.20,1000,1000),
 ('-relay-proof',(-8.94,1.48,-1.03),(-9.1,1.40,-1.40),.22,1000,1000),
]:
    cam.location=V(at);cam.rotation_euler=(V(target)-cam.location).to_track_quat('-Z','Y').to_euler()
    camera.type='ORTHO';camera.ortho_scale=scale;scene.render.resolution_x=width;scene.render.resolution_y=height
    scene.render.filepath=str(OUT/(STEM+suffix+'.png'));bpy.ops.render.render(write_still=True)
print('AUTOMATION_PROOF_COMPLETE',flush=True)
