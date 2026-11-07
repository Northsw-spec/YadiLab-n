/** Strict, bounded container/header preflight for scenario raster assets.
 * This is deliberately NOT a complete pixel decoder. The browser's native image
 * decoder still determines whether compressed picture data is renderable.
 */
import { PackageIOError } from "./errors.js";

const MAX_SIDE = 8192;
const MAX_PIXELS = 16_777_216;
function fail(path: string, reason: string): never {
  throw new PackageIOError("PACKAGE_RASTER_INVALID", `Raster asset '${path}': ${reason}.`, path);
}
function size(path: string, width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    throw new PackageIOError("PACKAGE_RASTER_DIMENSIONS_EXCEEDED", `Raster asset '${path}' has invalid or excessive dimensions (${width}x${height}); max side ${MAX_SIDE}, max pixels ${MAX_PIXELS}.`, path);
  }
}
function u16be(x: Uint8Array, i: number): number { return (x[i]! << 8) | x[i + 1]!; }
function u16le(x: Uint8Array, i: number): number { return x[i]! | (x[i + 1]! << 8); }
function u32be(x: Uint8Array, i: number): number { return (x[i]! * 0x1000000 + (x[i + 1]! << 16) + (x[i + 2]! << 8) + x[i + 3]!) >>> 0; }
function u32le(x: Uint8Array, i: number): number { return (x[i]! + (x[i + 1]! << 8) + (x[i + 2]! << 16) + x[i + 3]! * 0x1000000) >>> 0; }
function ascii(x: Uint8Array, i: number, n: number): string { return String.fromCharCode(...x.subarray(i, i+n)); }
function crc32(x: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i=start; i<end; i++) {
    c ^= x[i]!;
    for(let j=0;j<8;j++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function png(x: Uint8Array, path: string): void {
  const sig = [137,80,78,71,13,10,26,10];
  if(x.length < 57 || sig.some((v,i)=>x[i]!==v)) fail(path,"invalid PNG signature or truncated PNG");
  let off=8, ihdr=false, idat=false, iend=false, seenPLTE=false, chunkCount=0;
  while(off < x.length) {
    if(off + 12 > x.length || ++chunkCount > 2048) fail(path,"truncated or excessive PNG chunks");
    const n=u32be(x,off); const type=ascii(x,off+4,4);
    if(!/^[A-Za-z]{4}$/.test(type) || n > x.length - off - 12) fail(path,"malformed PNG chunk");
    const end=off+12+n;
    if(crc32(x,off+4,off+8+n)!==u32be(x,off+8+n)) fail(path,"PNG chunk CRC mismatch");
    if(!ihdr && type!=="IHDR") fail(path,"IHDR must be first");
    if(type==="IHDR") {
      if(ihdr || n!==13) fail(path,"duplicate or malformed IHDR");
      ihdr=true;
      const w=u32be(x,off+8),h=u32be(x,off+12); size(path,w,h);
      const depth=x[off+16],color=x[off+17];
      const depths:Record<number,readonly number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if(!depths[color!]?.includes(depth!) || x[off+18]!==0 || x[off+19]!==0 || (x[off+20]!==0 && x[off+20]!==1)) fail(path,"unsupported PNG IHDR");
    } else if(type==="PLTE") {
      if(seenPLTE || idat || n<3 || n>768 || n%3!==0) fail(path,"invalid PNG palette");
      seenPLTE=true;
    } else if(type==="IDAT") {
      if(iend || n===0) fail(path,"invalid IDAT");
      idat=true;
    } else if(type==="IEND") {
      if(n!==0 || !idat || end!==x.length || iend) fail(path,"invalid PNG ending");
      iend=true;
    } else {
      // Unknown critical PNG chunks and APNG animation are unsupported.
      if(type[0]===type[0]!.toUpperCase() || ["acTL","fcTL","fdAT"].includes(type)) fail(path,"unsupported critical/animated PNG chunk");
    }
    off=end;
    if(iend) break;
  }
  if(!ihdr || !idat || !iend || off!==x.length) fail(path,"incomplete PNG structure");
}
function jpeg(x:Uint8Array,path:string): void {
  if(x.length<12 || x[0]!==0xff || x[1]!==0xd8 || x[x.length-2]!==0xff || x[x.length-1]!==0xd9) fail(path,"invalid JPEG framing");
  let off=2, sof=false, sos=false;
  while(off<x.length-2) {
    if(x[off++]!==0xff) fail(path,"invalid JPEG marker boundary");
    while(x[off]===0xff) off++;
    const marker=x[off++];
    if(marker===undefined || marker===0x00 || marker===0xd8 || marker===0xd9 || marker===0x01 || (marker>=0xd0 && marker<=0xd7)) fail(path,"unexpected JPEG marker");
    if(off+2>x.length-2) fail(path,"truncated JPEG segment");
    const n=u16be(x,off);
    if(n<2 || off+n>x.length-2) fail(path,"invalid JPEG segment length");
    if([0xc0,0xc1,0xc2].includes(marker)) {
      if(sof || n<8 || x[off+2]!==8) fail(path,"unsupported/duplicate JPEG SOF");
      sof=true; size(path,u16be(x,off+5),u16be(x,off+3));
    } else if((marker>=0xc0 && marker<=0xcf) && ![0xc4,0xc8,0xcc].includes(marker)) {
      fail(path,"unsupported JPEG coding mode");
    }
    if(marker===0xda) { if(!sof) fail(path,"JPEG scan before frame header"); sos=true; break; }
    off+=n;
  }
  if(!sof || !sos) fail(path,"JPEG requires frame header and scan");
  // Scan entropy is deliberately left to the native browser decoder.
}
function webp(x:Uint8Array,path:string):void {
  if(x.length<30 || ascii(x,0,4)!=="RIFF" || ascii(x,8,4)!=="WEBP" || u32le(x,4)!==x.length-8) fail(path,"invalid WebP RIFF envelope");
  let off=12, image=false, extended=false, canvasW=0,canvasH=0,count=0;
  while(off<x.length) {
    if(off+8>x.length || ++count>256) fail(path,"truncated or excessive WebP chunks");
    const kind=ascii(x,off,4), n=u32le(x,off+4),p=off+8;
    if(n>x.length-p || (n&1 ? p+n+1 : p+n)>x.length) fail(path,"invalid WebP chunk length");
    if(kind==="VP8X") {
      if(extended || off!==12 || n!==10 || (x[p]! & 0x02)!==0) fail(path,"unsupported animated/duplicate WebP extended header");
      extended=true;
      canvasW=1+x[p+4]!+(x[p+5]!<<8)+(x[p+6]!<<16);
      canvasH=1+x[p+7]!+(x[p+8]!<<8)+(x[p+9]!<<16);
      size(path,canvasW,canvasH);
    } else if(kind==="VP8 " || kind==="VP8L") {
      if(image) fail(path,"duplicate WebP image chunk");
      image=true;
      let w:number,h:number;
      if(kind==="VP8 ") {
        if(n<10 || x[p+3]!==0x9d || x[p+4]!==0x01 || x[p+5]!==0x2a) fail(path,"invalid lossy WebP header");
        w=u16le(x,p+6)&0x3fff;h=u16le(x,p+8)&0x3fff;
      } else {
        if(n<5 || x[p]!==0x2f) fail(path,"invalid lossless WebP header");
        w=1+x[p+1]!+((x[p+2]!&0x3f)<<8);
        h=1+(x[p+2]!>>6)+(x[p+3]!<<2)+((x[p+4]!&0x0f)<<10);
      }
      size(path,w,h);
      if(extended && (w>canvasW || h>canvasH)) fail(path,"WebP decoded frame exceeds declared canvas");
    } else if(kind==="ANIM" || kind==="ANMF") {
      fail(path,"animated WebP is not supported");
    } else if(!extended || !["ALPH","ICCP","EXIF","XMP "].includes(kind)) {
      fail(path,"unsupported WebP chunk");
    }
    off=p+n+(n&1);
  }
  if(off!==x.length || !image) fail(path,"missing WebP image payload");
}
/** Safety preflight at BOTH PackageIO read/write and browser media boundaries. */
export function validateRasterAsset(bytes: Uint8Array,path:string,mime:string):void {
  if(!path.startsWith("assets/")) return;
  switch(mime){
    case "image/png":png(bytes,path);return;
    case "image/jpeg":jpeg(bytes,path);return;
    case "image/webp":webp(bytes,path);return;
  }
}
