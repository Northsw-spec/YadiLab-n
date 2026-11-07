import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { MemoryArchiveBackend, SafePackageIO } from "../../dist-browser-test/package-io/src/index.js";
import { createRuntimePackageMedia, openRuntimePackage } from "../../dist-browser-test/ui/src/browser/index.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scenario = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-normalized.json"), "utf8"));
const layout = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/layout.json"), "utf8"));
const enc = new TextEncoder();
const pngFixture = new Uint8Array(fs.readFileSync(path.join(root,"tests/fixtures/media/safe.png")));
const file = (path, mime, text) => ({ path, mime, bytes: text === undefined && mime === "image/png" ? pngFixture : enc.encode(text ?? "safe") });
const host = (onCreate=()=>{}) => {
  const urls=[]; const revoked=[];
  return { urls, revoked,
    createObjectURL(blob) { onCreate(blob,urls.length); urls.push(blob); return `blob:local/${urls.length}`; },
    revokeObjectURL(url) { revoked.push(url); },
  };
};
let checks=0;
const ok=(value,msg)=>{assert.ok(value,msg);checks++;};
const eq=(value,expected,msg)=>{assert.deepEqual(value,expected,msg);checks++;};
function rejects(map, pattern, msg) {
 const h=host();
 assert.throws(()=>createRuntimePackageMedia(map,h),pattern,msg); checks++;
 eq(h.urls.length,h.revoked.length, `${msg}: allocated URLs rolled back`);
}
rejects(new Map([["assets/evil.svg",file("assets/evil.svg","image/svg+xml",'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')]]), /SVG|forbidden|not allowed/i, "active SVG rejected even from forged read result");
rejects(new Map([["assets/remote.svg",file("assets/remote.svg","image/svg+xml",'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.invalid/x.svg" /></svg>')]]), /SVG|forbidden|not allowed/i, "remote SVG image rejected");
rejects(new Map([["assets/evt.svg",file("assets/evt.svg","image/svg+xml",'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')]]), /SVG|forbidden|not allowed/i, "SVG event handlers rejected");
rejects(new Map([["assets/mime.svg",file("assets/mime.svg","text/html","<b>HTML</b>")]]), /MIME/i, "SVG/HTML MIME spoof rejected");
rejects(new Map([["assets/mime.png",file("assets/mime.png","image/svg+xml","<svg/>")]]), /MIME/i, "mismatched extension/MIME rejected");
rejects(new Map([["assets/../evil.png",file("assets/../evil.png","image/png")]]), /path|traversal|unsafe/i, "path traversal rejected");
rejects(new Map([["assets/spoof.png",file("assets/spoof.png","image/png","<script>evil()</script>")]]), /raster|PNG|signature/i, "forged PNG never obtains Blob URL");
rejects(new Map([["assets/spoof.jpg",file("assets/spoof.jpg","image/jpeg","<svg/>")]]), /raster|JPEG/i, "forged JPEG never obtains Blob URL");
rejects(new Map([["assets/spoof.webp",file("assets/spoof.webp","image/webp","bad")]]), /raster|WebP/i, "forged WebP never obtains Blob URL");
const h=host((_,n)=>{if(n===1)throw new Error("Blob allocation failed");});
assert.throws(()=>createRuntimePackageMedia(new Map([
 ["assets/1.png",file("assets/1.png","image/png")],
 ["assets/2.png",file("assets/2.png","image/png")],
]),h),/allocation failed/);checks++;
eq(h.urls.length,1,"one Blob URL allocated before failure");
eq(h.revoked,["blob:local/1"],"all earlier URLs revoked on subsequent allocation failure");
for(const unsafe of ["https://evil.invalid/asset", "data:image/svg+xml;base64,PHN2Zy8+", "javascript:alert(1)"]){
 const u=[]; const p={createObjectURL:()=>unsafe,revokeObjectURL:x=>u.push(x)};
 assert.throws(()=>createRuntimePackageMedia(new Map([["assets/p.png",file("assets/p.png","image/png")]]),p),/local blob/);checks++;
 eq(u,[unsafe],"invalid host URL revoked before refusing render");
}
const io=new SafePackageIO(new MemoryArchiveBackend(),()=>({valid:true}));
const validateNormalized=x=>({valid:x?.formatId==="infrastructure-cyber-lab.scenario"});
const validateLayout=x=>({valid:x?.formatId==="infrastructure-cyber-lab.layout"});
const author=await io.write(scenario,{distribution:"author",layout,assets:[file("assets/photo.png","image/png")]});
const ha=host();
let result=await openRuntimePackage(author,{packageIO:io,validateNormalized,validateLayout,imageUrlHost:ha});
eq(result.ok,false,"author package denied before allocating image URLs");
eq(ha.urls.length,0,"author denial created no URLs");
const future=structuredClone(scenario);future.minimumEngineVersion="99.0.0";
const newer=await io.write(future,{distribution:"student",layout,assets:[file("assets/photo.png","image/png")]});
const hb=host();
result=await openRuntimePackage(newer,{packageIO:io,validateNormalized,validateLayout,imageUrlHost:hb});
eq(result.ok,false,"Engine-version rejection occurs before allocating URLs");
eq(hb.urls.length,0,"Engine rejection created no URLs");
const invalid={createObjectURL:()=>"https://attacker.invalid",revokeObjectURL() {}};
const good=await io.write(scenario,{distribution:"student",layout,assets:[file("assets/photo.png","image/png")]});
result=await openRuntimePackage(good,{packageIO:io,validateNormalized,validateLayout,imageUrlHost:invalid});
eq(result.ok,false,"invalid image URL host makes package open fail closed");
if(!result.ok)ok(result.diagnostics.some(x=>x.code==="BROWSER_PACKAGE_MEDIA_REJECTED"),"media rejection has explicit diagnostic code");
const app=fs.readFileSync(path.join(root,"ui/app/main.mjs"),"utf8");
ok(!/dangerouslySetInnerHTML|\.innerHTML\s*=/.test(app),"real browser source contains no inline SVG injection");
console.log(`PASS package media adversarial suite: ${checks} assertions.`);
