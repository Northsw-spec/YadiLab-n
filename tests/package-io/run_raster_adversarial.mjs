import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {validateRasterAsset,MemoryArchiveBackend,SafePackageIO,PackageIOError,encodeJson,sha256Hex} from '../../dist-packageio-test/package-io/src/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const scenario=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/valid/scenario-normalized.json'),'utf8'));
const files=Object.fromEntries(['png','jpg','webp'].map(x=>[x,new Uint8Array(fs.readFileSync(path.join(root,`tests/fixtures/media/safe.${x}`)))]));
const mime={png:'image/png',jpg:'image/jpeg',webp:'image/webp'};
let n=0;
const bytes=x=>new Uint8Array(x);
function reject(ext,value,code,label){
 assert.throws(()=>validateRasterAsset(value,`assets/check.${ext}`,mime[ext]),e=>e instanceof PackageIOError&&e.code===code,label);n++;
}
for(const ext of ['png','jpg','webp']){
 reject(ext,new TextEncoder().encode('<svg onload="alert(1)"/>'),'PACKAGE_RASTER_INVALID',`HTML polyglot as ${ext}`);
 reject(ext,bytes(files[ext].subarray(0,15)),'PACKAGE_RASTER_INVALID',`truncated ${ext}`);
}
reject('png',files.jpg,'PACKAGE_RASTER_INVALID','JPEG pretending to be PNG');
reject('jpg',files.png,'PACKAGE_RASTER_INVALID','PNG pretending to be JPEG');
reject('webp',files.png,'PACKAGE_RASTER_INVALID','PNG pretending to be WebP');
const p=bytes(files.png);p[p.length-1]^=1;
reject('png',p,'PACKAGE_RASTER_INVALID','PNG damaged final CRC');
const p2=bytes(files.png);p2[16]=0xff;p2[17]=0xff;p2[18]=0xff;p2[19]=0xff;
reject('png',p2,'PACKAGE_RASTER_INVALID','PNG mutated IHDR rejected by integrity CRC');
function crc32(x,a,b){let c=0xffffffff;for(let i=a;i<b;i++){c^=x[i];for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0}
const p3=bytes(p2);const crc=crc32(p3,12,29);for(let i=0;i<4;i++)p3[29+i]=(crc>>>(24-8*i))&255;
reject('png',p3,'PACKAGE_RASTER_DIMENSIONS_EXCEEDED','valid-CRC excessive PNG dimensions');
const appended=new Uint8Array(files.png.length+8);appended.set(files.png);appended.set(new TextEncoder().encode('bad-data'),files.png.length);
reject('png',appended,'PACKAGE_RASTER_INVALID','PNG with trailing payload');
const j=bytes(files.jpg);j[j.length-1]=0x00;
reject('jpg',j,'PACKAGE_RASTER_INVALID','JPEG missing EOI');
const j2=bytes(files.jpg);const sof=j2.indexOf(0xc0,j2.indexOf(0xff,4));
assert.ok(sof>0,'JPEG fixture contains SOF0');n++;
j2[sof+6]=255;j2[sof+7]=255; // raw SOF: marker, length(2), precision(1), height(2), width(2)
reject('jpg',j2,'PACKAGE_RASTER_DIMENSIONS_EXCEEDED','JPEG excessive width');
const w=bytes(files.webp);w[4]--;
reject('webp',w,'PACKAGE_RASTER_INVALID','WebP RIFF-size corruption');
const w2=bytes(files.webp);w2[23]=0;
reject('webp',w2,'PACKAGE_RASTER_INVALID','WebP bad VP8 signature');
const w3=bytes(files.webp);w3.set(new TextEncoder().encode('ANIM'),12);
reject('webp',w3,'PACKAGE_RASTER_INVALID','animated chunk rejected');
const io=new SafePackageIO(new MemoryArchiveBackend(),()=>({valid:true}));
await assert.rejects(()=>io.write(scenario,{distribution:'student',assets:[{path:'assets/bad.png',mime:'image/png',bytes:files.jpg}]}),e=>e.code==='PACKAGE_RASTER_INVALID','writer prevents MIME/byte spoof');n++;
// Attacker may forge a correct SHA-256; the reader must independently inspect bytes.
const bare={...scenario};delete bare.canonicalSolution;
const scenarioBytes=encodeJson(bare),bad=files.jpg;
const manifest={formatId:'infrastructure-cyber-lab.package',packageVersion:'0.1.0',distribution:'student',scenarioId:scenario.scenarioId,scenarioHash:scenario.sourceHash,schemaVersion:scenario.schemaVersion,minimumEngineVersion:scenario.minimumEngineVersion,entrypoint:'scenario.json',integrityAlgorithm:'sha256',capabilityLocks:scenario.capabilityLocks,profileLocks:scenario.profileLocks,assetLocks:scenario.assetLocks.map(x=>({id:x.id,version:x.version})),files:[{path:'scenario.json',size:scenarioBytes.length,sha256:await sha256Hex(scenarioBytes),mime:'application/json'},{path:'assets/spoof.png',size:bad.length,sha256:await sha256Hex(bad),mime:'image/png'}]};
const crafted=new MemoryArchiveBackend([{path:'manifest.json',bytes:encodeJson(manifest)},{path:'scenario.json',bytes:scenarioBytes},{path:'assets/spoof.png',bytes:bad}]);
await assert.rejects(()=>new SafePackageIO(crafted,()=>({valid:true})).read(new Blob(['synthetic'])),e=>e.code==='PACKAGE_RASTER_INVALID','read rejects correctly hashed PNG/JPEG spoof');n++;
console.log(`PASS raster preflight adversarial suite: ${n} assertions.`);
