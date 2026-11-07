import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {validateRasterAsset,MemoryArchiveBackend,SafePackageIO} from '../../dist-packageio-test/package-io/src/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const scenario=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/valid/scenario-normalized.json'),'utf8'));
const cases=[['png','image/png'],['jpg','image/jpeg'],['webp','image/webp']];
let n=0;const check=(c,msg)=>{assert.ok(c,msg);n++};
const input=cases.map(([ext,mime])=>({path:`assets/photo.${ext}`,mime,bytes:new Uint8Array(fs.readFileSync(path.join(root,`tests/fixtures/media/safe.${ext}`)))}));
for(const item of input){validateRasterAsset(item.bytes,item.path,item.mime);n++}
const io=new SafePackageIO(new MemoryArchiveBackend(),()=>({valid:true}));
const blob=await io.write(scenario,{distribution:'student',assets:input});
const out=await io.read(blob);
for(const item of input){
 const match=out.files.get(item.path);
 check(match?.mime===item.mime,`round-trip ${item.mime} metadata`);
 assert.deepEqual(match?.bytes,item.bytes,`round-trip ${item.mime} bytes`);n++;
}
check(out.packageInfo===undefined,'raster validation stays in PackageIO not Engine model');
console.log(`PASS raster preflight functional suite: ${n} assertions.`);
