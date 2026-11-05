import fs from 'node:fs/promises';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** The production loader and original skins/bind matrices, without DOM images. */
export async function loadGeometryGlb(url: URL) {
  const raw=await fs.readFile(url),length=raw.readUInt32LE(12);
  const json=JSON.parse(raw.subarray(20,20+length).toString());
  for(const material of json.materials??[]) {
    if(material.pbrMetallicRoughness) {
      delete material.pbrMetallicRoughness.baseColorTexture;
      delete material.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    delete material.normalTexture;delete material.emissiveTexture;delete material.occlusionTexture;
    delete material.extensions;
  }
  const body=Buffer.from(JSON.stringify(json));
  const padded=Buffer.concat([body,Buffer.alloc((4-body.length%4)%4,32)]),binary=raw.subarray(28+length);
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);
  header.writeUInt32LE(28+padded.length+binary.length,8);header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(binary.length);binHeader.writeUInt32LE(0x004e4942,4);
  const data=Buffer.concat([header,padded,binHeader,binary]);
  return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
}
