"""Reproducible Blender 4.5 LTS asset build. Run: blender -b -t 8 -P assets/build_cooler.py

Authoring helpers use glTF coordinates: +Y is up, +Z faces the customer.
The script converts to Blender Z-up, models all geometry, performs a Cycles AO
bake, preserves articulated semantic nodes, and exports a Draco-compressed GLB.
"""
import bpy
import math
import json
from mathutils import Vector
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / 'public' / 'models'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for datablock in list(bpy.data.materials):
    bpy.data.materials.remove(datablock)

def xyz(p):
    return (p[0], -p[2], p[1])

def material(name, color, metallic=0, roughness=.3, transmission=0, emission=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    s = m.node_tree.nodes.get('Principled BSDF')
    s.inputs['Base Color'].default_value = (*color, 1)
    s.inputs['Metallic'].default_value = metallic
    s.inputs['Roughness'].default_value = roughness
    s.inputs['IOR'].default_value = 1.46
    s.inputs['Transmission Weight'].default_value = transmission
    if emission:
        s.inputs['Emission Color'].default_value = (*emission[:3], 1)
        s.inputs['Emission Strength'].default_value = emission[3]
    m.diffuse_color = (*color, 1)
    return m

RED = material('CocaCola_Gloss_Enamel', (.64,.006,.017), .28, .23)
RED.node_tree.nodes.get('Principled BSDF').inputs['Coat Weight'].default_value = .42
BLACK = material('Satin_Charcoal_Trim', (.014,.02,.026), .35, .28)
RUBBER = material('Door_Gasket_Rubber', (.011,.014,.018), 0, .68)
LINER = material('FoodSafe_White_Interior', (.63,.68,.69), .12, .4)
WIRE = material('PowderCoated_Shelf_Wire', (.72,.77,.78), .6, .27)
CHROME = material('Brushed_Aluminum', (.46,.52,.55), .9, .21)
GLASS = material('LowE_Architectural_Glass', (.9,.97,1), 0, .07, .97)
WHITE = material('Marquee_White_Print', (.96,.97,.96), .02, .3)
LED = material('CoolWhite_LED_Diffuser', (.78,.93,1), 0, .2, emission=(.78,.92,1,3.5))
DISPLAY = material('Thermostat_Screen', (.004,.021,.024), .35, .15)
DIGITS = material('Thermostat_Digits', (.08,.85,.7), .1, .3, emission=(.04,.85,.62,1.5))
PET = material('Cola_PET', (.028,.017,.01), .05, .2)
CAN_RED = material('Cola_Label_Red', (.76,.008,.018), .45, .27)
CAN_GREEN = material('Citrus_Label_Green', (.02,.39,.14), .36, .24)
CAN_ORANGE = material('Orange_Label', (.92,.22,.008), .26, .28)
CAN_BLACK = material('Zero_Label_Charcoal', (.012,.016,.02), .55, .25)
CAP = material('Bottle_Red_Cap', (.62,.009,.018), .12, .32)

def assign(obj, mat):
    obj.data.materials.append(mat)
    return obj

def bevel(obj, amount=.005, segments=3):
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new('Manufactured edge radii', 'BEVEL')
    mod.width = amount
    mod.segments = segments
    mod.affect = 'EDGES'
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in obj.data.polygons:
        p.use_smooth = True
    mod = obj.modifiers.new('Area weighted panel normals', 'WEIGHTED_NORMAL')
    mod.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj

def box(name, center, size, mat, radius=.003, segments=3):
    # Explicit panel mesh makes the source independent of premade/model libraries.
    cx, cy, cz = center
    sx, sy, sz = (v/2 for v in size)
    verts = [xyz((cx+x*sx,cy+y*sy,cz+z*sz))
             for x,y,z in [(-1,-1,-1),(-1,-1,1),(-1,1,1),(-1,1,-1),
                            (1,-1,-1),(1,-1,1),(1,1,1),(1,1,-1)]]
    faces = [(0,1,2,3),(4,7,6,5),(0,4,5,1),(3,2,6,7),(0,3,7,4),(1,5,6,2)]
    mesh = bpy.data.meshes.new(name+'Mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign(obj,mat)
    # Normalize winding robustly, including concave panel assemblies.
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)
    if radius:
        bevel(obj, radius, segments)
    return obj

def combine(name, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    obj.select_set(False)
    return obj

def rod(name, a, b, radius, mat, vertices=8):
    pa,pb = Vector(xyz(a)),Vector(xyz(b))
    axis = pb-pa
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius,
        depth=axis.length, end_fill_type='NGON', location=(pa+pb)/2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_quaternion = axis.to_track_quat('Z','Y')
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = axis.to_track_quat('Z','Y')
    assign(obj,mat)
    for p in obj.data.polygons:
        p.use_smooth=True
    obj.select_set(False)
    return obj

def lathe(name, center, profile, mats, bands=None, sides=24):
    # Profile is (height, radius); discrete bottle contours and crimped can rims.
    verts=[]
    for h,r in profile:
        for j in range(sides):
            a=j*math.tau/sides
            verts.append(xyz((center[0]+r*math.sin(a),center[1]+h,center[2]+r*math.cos(a))))
    faces=[]
    for k in range(len(profile)-1):
        for j in range(sides):
            faces.append((k*sides+j,k*sides+(j+1)%sides,(k+1)*sides+(j+1)%sides,(k+1)*sides+j))
    faces += [tuple(range(sides-1,-1,-1)),tuple((len(profile)-1)*sides+j for j in range(sides))]
    mesh=bpy.data.meshes.new(name+'Mesh')
    mesh.from_pydata(verts,[],faces)
    mesh.update()
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    for m in mats:
        assign(obj,m)
    for i,p in enumerate(mesh.polygons):
        p.use_smooth=True
        if bands and i<(len(profile)-1)*sides:
            p.material_index=bands[i//sides]
    return obj

SCRIPT_FONT=Path('C:/Windows/Fonts/BRUSHSCI.TTF')
SANS_FONT=Path('C:/Windows/Fonts/arialbd.ttf')
fonts={}
def lettering(name, text, center, width, mat, script=False, orientation='front'):
    data=bpy.data.curves.new(name+'Curve','FONT')
    data.body=text
    data.align_x='CENTER'
    data.align_y='CENTER'
    data.size=.1
    # Flat screen-print lettering is inexpensive; marquee curves retain detail.
    data.extrude=0
    data.resolution_u=2 if width>.2 else 1
    path=SCRIPT_FONT if script else SANS_FONT
    if path.exists():
        if str(path) not in fonts:
            fonts[str(path)]=bpy.data.fonts.load(str(path))
        data.font=fonts[str(path)]
    obj=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(obj)
    obj.location=xyz(center)
    assign(obj,mat)
    bpy.context.view_layer.update()
    # Measure unrotated local glyph bounds; world-axis dimensions on freshly
    # created FONT objects lag orientation changes until dependency evaluation.
    glyph_width=max(v[0] for v in obj.bound_box)-min(v[0] for v in obj.bound_box)
    scale=width/max(glyph_width,.001)
    obj.scale=(scale,scale,scale)
    # Text's +Z normal faces the front (-Y Blender).
    obj.rotation_euler=(math.pi/2,0,0)
    if orientation=='side':
        obj.rotation_euler=(math.pi/2,0,math.pi/2)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)
    return obj

# Cabinet: insulated, rounded manufacturing panels surrounding an open cavity.
shell=[
    box('Left_Insulated_Wall',(-.359,1.015,0),(.064,1.89,.74),RED,.019,4),
    box('Right_Insulated_Wall',(.359,1.015,0),(.064,1.89,.74),RED,.019,4),
    box('Rear_Cabinet',(0,1.015,-.342),(.69,1.89,.065),RED,.013,3),
    box('Header_Canopy',(0,1.90,.013),(.75,.18,.735),RED,.016,4),
    box('Machine_Compartment',(0,.204,-.043),(.72,.278,.625),BLACK,.013),
    box('Bottom_Kick_Red',(0,.066,.015),(.735,.052,.7),RED,.01),
]
body=combine('OuterCabinet',shell)
liner=combine('InteriorLiner',[
    box('Inner_Back',(0,1.075,-.298),(.65,1.445,.015),LINER),
    box('Inner_Left',(-.321,1.075,.027),(.018,1.445,.65),LINER),
    box('Inner_Right',(.321,1.075,.027),(.018,1.445,.65),LINER),
    box('Inner_Floor',(0,.357,.027),(.657,.022,.65),LINER),
    box('Inner_Ceiling',(0,1.795,.027),(.657,.022,.65),LINER),
])
rear_details=[]
for x in [-.255,.255]:
    rear_details.append(box('Shelf_Adjustment_Rail',(x,1.075,-.28),(.018,1.4,.008),CHROME,.001))
    for i in range(26):
        rear_details.append(box('Rail_Slot',(x,.42+i*.05,-.273),(.007,.017,.002),BLACK,.001))
combine('AdjustableShelfRails',rear_details)

# Header includes a raised gloss fascia and true vector lettering converted to mesh.
box('Marquee_Fascia',(0,1.902,.386),(.718,.166,.022),RED,.013,4)
lettering('Marquee_CocaCola','Coca-Cola',(0,1.905,.4),.48,WHITE,True)
lettering('Marquee_Footer','ORIGINAL TASTE',(0,1.84,.401),.16,WHITE)
lettering('Right_Side_CocaCola','Coca-Cola',(.393,1.45,.04),.54,WHITE,True,'side')
lettering('Right_Side_Enjoy','ENJOY',(.394,1.58,.04),.13,WHITE,False,'side')

# Recessed condenser face with genuine horizontal vent gaps and inset fins.
grill=[box('Grille_Backplate',(0,.214,.294),(.666,.245,.027),RUBBER,.01),
       box('Grille_Header',(0,.337,.344),(.718,.023,.046),BLACK,.005),
       box('Grille_Footer',(0,.092,.344),(.714,.02,.042),BLACK,.005)]
for i in range(11):
    grill.append(box('Vent_Louver',(0,.114+i*.0197,.327),(.669,.010,.026),BLACK,.002,2))
for x in [-.341,.341]:
    grill.append(box('Grille_Endcap',(x,.214,.34),(.024,.247,.043),BLACK,.003))
grill_obj=combine('CompressorGrille',grill)
lettering('Grille_Manufacturer','imbera',(-.242,.122,.347),.08,CHROME)
for x in [-.322,.322]:
    for y in [.119,.314]:
        rod('Grille_Screw',(x,y,.348),(x,y,.349),.004,CHROME,12)
# Two plausible rear refrigeration parts visible when rotated.
lathe('Compressor_Housing',(.17,.12,-.23),[(0,.075),(.015,.09),(.105,.09),(.15,.067),(.16,.025)],[BLACK],sides=24)
rear_coils=[]
for k in range(9):
    rear_coils.append(rod('Condenser_Coil',(-.25,.12+k*.021,-.378),(.25,.12+k*.021,-.378),.004,CHROME,8))
combine('RearCondenserCoils',rear_coils)

# Five independently pickable welded wire shelves with eight lane dividers.
SHELF_Y=[.415,.677,.939,1.201,1.463]
for row,y in enumerate(SHELF_Y):
    pieces=[]
    for n in range(26):
        x=-.304+n*.0243
        pieces.append(rod('Shelf_Longitudinal_Wire',(x,y,-.252),(x,y,.298),.0018,WIRE))
    for z in [-.258,-.085,.1,.303]:
        pieces.append(rod('Shelf_Crossbar',(-.31,y-.003,z),(.31,y-.003,z),.0034,WIRE))
    pieces.append(box('Shelf_Price_Rail',(0,y-.012,.315),(.638,.028,.019),WHITE,.003))
    for n in range(9):
        x=-.305+n*.07625
        pieces.append(rod('Product_Lane_Divider',(x,y+.016,-.24),(x,y+.016,.274),.0016,WIRE))
        pieces.append(rod('Product_Stop_Wire',(x,y+.017,.274),(x,y+.035,.287),.0016,WIRE))
    shelf=combine('Shelf_'+str(row),pieces)
    shelf['interaction']='shelf'
    shelf['row']=row
    lettering('Shelf_Price_'+str(row),'ICE COLD  /  $2.50',(0,y-.013,.326),.17,BLACK)

# Lathed bottle/can profiles with rolled rims, PET shoulders, caps and printed labels.
can_profile=[(0,.025),(.004,.028),(.009,.029),(.016,.0285),(.136,.0285),(.145,.027),(.149,.028),(.153,.028),(.155,.025)]
bottle_profile=[(0,.025),(.004,.029),(.015,.03),(.032,.028),(.048,.026),(.061,.028),(.067,.03),(.135,.03),(.145,.028),(.156,.026),(.177,.015),(.195,.013),(.199,.014),(.206,.014),(.21,.012)]
label_materials=[CAN_RED,CAN_RED,CAN_BLACK,CAN_RED,CAN_GREEN,CAN_GREEN,CAN_ORANGE,CAN_RED]
stock_nodes=[]
for row,y in enumerate(SHELF_Y):
    for col in range(8):
        x=-.267+col*.07625
        label=label_materials[col]
        center=(x,y+.004,.225)
        pieces=[]
        is_bottle=row>=2
        if is_bottle:
            stock=lathe('Bottle',center,bottle_profile,[PET,label,CAP],
                [0,0,0,0,0,0,1,0,0,0,0,0,2,2],sides=20)
            pieces.append(stock)
            # White front label print sits on the cylinder at front tangent.
            word='Coca-Cola' if col<4 or col==7 else ('Sprite' if col<6 else 'Fanta')
            pieces.append(lettering('Bottle_Print',word,(x,y+.109,.256),.047,WHITE,True))
        else:
            stock=lathe('Can',center,can_profile,[CHROME,label],[0,0,0,1,1,0,0,0],sides=24)
            pieces.append(stock)
            pieces.append(box('Can_Pull_Tab',(x,y+.160,.225),(.009,.0015,.019),CHROME,.002,2))
            word='Coca-Cola' if col<4 or col==7 else ('Sprite' if col<6 else 'Fanta')
            pieces.append(lettering('Can_Print',word,(x,y+.088,.254),.046,WHITE,True))
        stock=combine('Stock_'+str(row)+'_'+str(col),pieces)
        stock['row']=row
        stock['column']=col
        stock['interaction']='stock'
        stock_nodes.append(stock.name)
        # A rear product gives authentic depth but belongs to the same stock slot.
        duplicate=stock.copy()
        duplicate.data=stock.data.copy()
        bpy.context.collection.objects.link(duplicate)
        duplicate.location.y+=.16
        stock=combine('Stock_'+str(row)+'_'+str(col),[stock,duplicate])

# Vertical LED channels are integrated into the interior frame.
led_housings=[]
led_strips=[]
for x in [-.311,.311]:
    led_housings.append(box('LED_Aluminum_Channel',(x,1.084,.30),(.015,1.376,.021),CHROME,.004))
    led_strips.append(box('LED_Opal_Diffuser',(x,1.084,.313),(.007,1.35,.007),LED,.002))
combine('LED_Channels',led_housings)
combine('InteriorLEDStrips',led_strips)

# Door is an actual hinged hierarchy. Local Y in glTF is the hinge axis.
hinge=(-.355,1.065,.397)
pivot=bpy.data.objects.new('DoorPivot',None)
bpy.context.collection.objects.link(pivot)
pivot.location=xyz(hinge)
pivot['openAngleRadians']=-1.919862
pivot['interaction']='door'
bpy.context.view_layer.update()
def attach(obj):
    obj.parent=pivot
    obj.matrix_parent_inverse=pivot.matrix_world.inverted()
    return obj
frame=[]
for x in [-.344,.344]:
    frame.append(box('Door_Stile',(x,1.067,.396),(.036,1.472,.052),BLACK,.009,4))
for y in [.34,1.794]:
    frame.append(box('Door_Rail',(0,y,.396),(.7,.038,.052),BLACK,.008,4))
attach(combine('DoorFrame',frame))
seal=[]
for x in [-.32,.32]:
    seal.append(box('Glass_Side_Seal',(x,1.067,.408),(.009,1.408,.01),RUBBER,.002))
for y in [.365,1.77]:
    seal.append(box('Glass_End_Seal',(0,y,.408),(.65,.011,.01),RUBBER,.002))
attach(combine('GlassGasket',seal))
glass=attach(box('Glass',(0,1.067,.402),(.629,1.394,.006),GLASS,.002,2))
glass['interaction']='door'
handle=[]
for y in [.897,1.273]:
    handle.append(box('Handle_StandOff',(.319,y,.448),(.023,.035,.075),BLACK,.008,4))
handle.append(box('Handle_Grip',(.319,1.085,.48),(.026,.419,.031),BLACK,.012,5))
handle.append(box('Handle_Chrome_Inlay',(.319,1.085,.497),(.013,.32,.004),CHROME,.003))
attach(combine('DoorHandle',handle))
for y in [.445,1.685]:
    attach(rod('DoorHinge',(-.355,y-.035,.397),(-.355,y+.035,.397),.012,BLACK,16))

thermostat=combine('Thermostat',[
    box('Digital_Controller',(.214,1.837,.41),(.117,.047,.02),BLACK,.006),
    box('Screen_Glass',(.21,1.837,.422),(.085,.029,.003),DISPLAY,.002),
])
lettering('Thermostat_Reading','3.2',(.208,1.837,.425),.041,DIGITS)
for x in [.261,.273]:
    box('Thermostat_Button',(x,1.837,.423),(.006,.006,.003),CHROME,.002)
box('AirSensorHousing',(.285,1.697,-.252),(.037,.058,.028),BLACK,.006)
for n in range(4):
    box('Sensor_Vent',(.285,1.68+n*.01,-.235),(.025,.002,.003),LINER,.0005)

# Feet are recessed under the plinth.
for x in [-.29,.29]:
    for z in [-.27,.27]:
        lathe('Adjustable_Foot',(x,.008,z),[(0,.024),(.014,.026),(.045,.019)],[RUBBER],sides=16)

# Genuine Cycles AO atlas: the cavity, shell, shelves, grille and metal detail share
# a non-overlapping UV layout. Product labels and transmissive glass are excluded.
bake_names=['OuterCabinet','InteriorLiner','CompressorGrille','AdjustableShelfRails',
            'LED_Channels']+['Shelf_'+str(i) for i in range(5)]
bake_objects=[bpy.data.objects[n] for n in bake_names]
bpy.ops.object.select_all(action='DESELECT')
for obj in bake_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active=bake_objects[0]
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=1.151917, island_margin=.006, area_weight=.5,
                         correct_aspect=True, scale_to_bounds=True)
bpy.ops.object.mode_set(mode='OBJECT')

# Separate receiving materials so label objects never sample the atlas.
receiving_materials=[]
shared_copies={}
for obj in bake_objects:
    for slot in obj.material_slots:
        original=slot.material
        if original.name not in shared_copies:
            dup=original.copy()
            dup.name=original.name+'_AO'
            shared_copies[original.name]=dup
            receiving_materials.append(dup)
        slot.material=shared_copies[original.name]
ao=bpy.data.images.new('Cooler_Baked_Ambient_Occlusion',width=1024,height=1024,alpha=False)
ao.generated_color=(1,1,1,1)
ao.colorspace_settings.name='Non-Color'
for mat in receiving_materials:
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image=ao
    tex.name='Baked_AO_Atlas'
    mat.node_tree.nodes.active=tex
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.device='CPU'
scene.cycles.samples=12
scene.world.light_settings.distance=.16
scene.render.bake.margin=6
scene.render.bake.use_clear=False
scene.world.color=(.8,.8,.8)
glass.hide_render=True
print('BAKING REAL CYCLES AMBIENT OCCLUSION', flush=True)
bpy.ops.object.bake(type='AO')
glass.hide_render=False
ao.filepath_raw=str(OUT/'cooler-ao.png')
ao.file_format='PNG'
ao.save()
pixels=list(ao.pixels)
ao_min=min(pixels[0::4])
ao_max=max(pixels[0::4])
ao.pack()

# This documented exporter node is emitted as glTF occlusionTexture, avoiding
# multiplying AO into base-color and retaining the physically based workflow.
group=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree')
group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
group.nodes.new('NodeGroupInput')
for mat in receiving_materials:
    node=mat.node_tree.nodes.new('ShaderNodeGroup')
    node.node_tree=group
    node.name='glTF Material Output'
    mat.node_tree.links.new(mat.node_tree.nodes['Baked_AO_Atlas'].outputs['Color'],node.inputs['Occlusion'])

scene.unit_settings.system='METRIC'
scene.unit_settings.scale_length=1
bpy.ops.object.select_all(action='DESELECT')
for obj in scene.objects:
    if obj.type in {'MESH','EMPTY'}:
        obj.select_set(True)
# Standalone .blend remains an editable authoring source.
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'cooler.blend'))
glb_path=OUT/'cooler.glb'
print('EXPORTING DRACO GLB', flush=True)
bpy.ops.export_scene.gltf(filepath=str(glb_path),export_format='GLB',use_selection=True,
    export_yup=True,export_apply=True,export_materials='EXPORT',
    export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14,export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,export_extras=True)
triangles=sum(sum(len(p.vertices)-2 for p in obj.data.polygons) for obj in scene.objects if obj.type=='MESH')
metadata={
    'generator':'Blender '+bpy.app.version_string,
    'source':'assets/build_cooler.py',
    'coordinateSystem':'glTF +Y up; +Z front; floor origin',
    'dimensionsMeters':{'width':.79,'height':2.0,'depth':.89},
    'door':{'pivotNode':'DoorPivot','position':list(hinge),'axis':'Y','closedRadians':0,'openRadians':-1.919862,
            'childNodes':['DoorFrame','GlassGasket','Glass','DoorHandle','DoorHinge','DoorHinge.001']},
    'shelves':{'rows':5,'columns':8,'rowOrder':'bottom to top','yCoordinates':SHELF_Y},
    'stockNodes':stock_nodes,
    'interactions':['DoorFrame','DoorHandle','Glass','CompressorGrille','Thermostat']+['Shelf_'+str(i) for i in range(5)],
    'hudCoordinates':{'airSensor':[.285,1.697,.08],'compressor':[.13,.22,.42],'thermostat':[.214,1.837,.43]},
    'triangleCount':triangles,
    'meshObjects':sum(1 for obj in scene.objects if obj.type=='MESH'),
    'glbBytes':glb_path.stat().st_size,
    'ambientOcclusion':{'baked':True,'engine':'Cycles','samples':12,'resolution':[1024,1024],
        'file':'cooler-ao.png','range':[ao_min,ao_max],'receivingObjects':bake_names,'gltfChannel':'occlusionTexture'},
    'compression':'KHR_draco_mesh_compression',
    'environment':{'file':'studio.hdr','source':'https://polyhaven.com/a/studio_small_09',
                    'author':'Sergej Majboroda','license':'CC0'},
    'branding':'Illustrative Coca-Cola / Imbera inspired concept, not a manufacturer CAD model.'
}
(OUT/'cooler.metadata.json').write_text(json.dumps(metadata,indent=2))
print(json.dumps(metadata,indent=2),flush=True)
