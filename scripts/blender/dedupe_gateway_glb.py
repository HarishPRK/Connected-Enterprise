"""Lossless glTF buffer/material deduplication for the exported Gemtek twin.

Keeps all geometry, texture pixels and independently inspectable part names.
No decoder dependency or topology simplification is introduced.
"""
import hashlib
import json
import struct
from pathlib import Path

asset = Path(__file__).resolve().parents[2] / 'src/assets/offerings/gemtek-gateway.glb'
source = asset.read_bytes()
json_length = struct.unpack_from('<I', source, 12)[0]
document = json.loads(source[20:20 + json_length])
binary = source[28 + json_length:]
packed = bytearray()
views, mapping, unique = [], {}, {}
for index, view in enumerate(document['bufferViews']):
    start = view.get('byteOffset', 0)
    payload = binary[start:start + view['byteLength']]
    metadata = {k: v for k, v in view.items() if k not in ('buffer', 'byteOffset', 'byteLength')}
    key = (hashlib.sha256(payload).digest(), json.dumps(metadata, sort_keys=True))
    if key not in unique:
        unique[key] = len(views)
        views.append({**metadata, 'buffer': 0, 'byteOffset': len(packed), 'byteLength': len(payload)})
        packed.extend(payload)
        packed.extend(b'\0' * (-len(packed) % 4))
    mapping[index] = unique[key]
for accessor in document['accessors']:
    accessor['bufferView'] = mapping[accessor['bufferView']]
for image in document.get('images', []):
    if 'bufferView' in image:
        image['bufferView'] = mapping[image['bufferView']]
materials, material_map, unique_materials = [], {}, {}
for index, material in enumerate(document['materials']):
    key = json.dumps(material, sort_keys=True)
    if key not in unique_materials:
        unique_materials[key] = len(materials)
        materials.append(material)
    material_map[index] = unique_materials[key]
for mesh in document['meshes']:
    for primitive in mesh['primitives']:
        if 'material' in primitive:
            primitive['material'] = material_map[primitive['material']]
document['materials'] = materials
document['bufferViews'] = views
document['buffers'][0]['byteLength'] = len(packed)
encoded = json.dumps(document, separators=(',', ':')).encode('utf-8')
encoded += b' ' * (-len(encoded) % 4)
output = (struct.pack('<III', 0x46546C67, 2, 28 + len(encoded) + len(packed))
          + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded
          + struct.pack('<II', len(packed), 0x004E4942) + packed)
asset.write_bytes(output)
print(f'Lossless GLB: {len(source):,} -> {len(output):,} bytes; {len(materials)} materials')
