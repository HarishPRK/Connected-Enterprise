"""Dependency-free structural verification: python assets/validate_asset.py."""
import json
import struct
from pathlib import Path

base=Path(__file__).resolve().parent.parent/'public'/'models'
raw=(base/'cooler.glb').read_bytes()
magic,version,total=struct.unpack_from('<III',raw)
assert magic==0x46546C67 and version==2 and total==len(raw)
chunk_size,chunk_type=struct.unpack_from('<II',raw,12)
assert chunk_type==0x4E4F534A
gltf=json.loads(raw[20:20+chunk_size])
names={node.get('name'):node for node in gltf['nodes']}
assert 'KHR_draco_mesh_compression' in gltf['extensionsUsed']
assert 'KHR_materials_transmission' in gltf['extensionsUsed']
for row in range(5):
    assert 'Shelf_'+str(row) in names
    for column in range(8):
        assert f'Stock_{row}_{column}' in names
assert abs(names['DoorPivot']['translation'][0]+.355)<1e-5
assert len(names['DoorPivot']['children'])>=4
for name in ['DoorFrame','DoorHandle','Glass','CompressorGrille','Thermostat','InteriorLEDStrips']:
    assert name in names,name
ao_materials=[m for m in gltf['materials'] if m.get('occlusionTexture')]
assert len(ao_materials)>=3
compressed=sum('KHR_draco_mesh_compression' in p.get('extensions',{})
               for mesh in gltf['meshes'] for p in mesh['primitives'])
primitives=sum(len(mesh['primitives']) for mesh in gltf['meshes'])
assert compressed==primitives
png=(base/'cooler-ao.png').read_bytes()
assert png[:8]==b'\x89PNG\r\n\x1a\n'
assert struct.unpack_from('>II',png,16)==(1024,1024)
metadata=json.loads((base/'cooler.metadata.json').read_text())
assert metadata['ambientOcclusion']['baked'] is True
assert metadata['ambientOcclusion']['range'][0]<metadata['ambientOcclusion']['range'][1]
assert metadata['triangleCount']<125000
assert (base/'studio.hdr').read_bytes()[:10] in [b'#?RADIANCE',b'#?RGBE\r\n']
print(json.dumps({'valid':True,'bytes':len(raw),'triangles':metadata['triangleCount'],
    'nodes':len(names),'compressedPrimitives':compressed,'aoMaterials':len(ao_materials),
    'stockSlots':40,'shelves':5},indent=2))
