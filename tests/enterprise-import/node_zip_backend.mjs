import { inflateRawSync } from "node:zlib";

function u16(b,o){return b[o]|(b[o+1]<<8)}
function u32(b,o){return (b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0}
function findEocd(b){for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(u32(b,i)===0x06054b50)return i;throw new Error("EOCD not found")}
export const nodeZipArchiveBackend={
 async open(blob){
  const b=new Uint8Array(await blob.arrayBuffer()); const e=findEocd(b); const count=u16(b,e+10), cdSize=u32(b,e+12), cdOff=u32(b,e+16);
  if(cdOff+cdSize>b.length) throw new Error("central directory out of bounds");
  const entries=[]; let p=cdOff; const dec=new TextDecoder("utf-8",{fatal:true});
  for(let n=0;n<count;n++){
   if(u32(b,p)!==0x02014b50) throw new Error("bad central directory signature");
   const flags=u16(b,p+8), method=u16(b,p+10), comp=u32(b,p+20), uncomp=u32(b,p+24), nameLen=u16(b,p+28), extraLen=u16(b,p+30), commentLen=u16(b,p+32), localOff=u32(b,p+42);
   if(flags&1) throw new Error("encrypted test ZIP unsupported");
   const name=dec.decode(b.slice(p+46,p+46+nameLen)); const directory=name.endsWith("/");
   entries.push({path:name,directory,compressedSize:comp,uncompressedSize:uncomp,read:async()=>{
    if(u32(b,localOff)!==0x04034b50) throw new Error("bad local header"); const ln=u16(b,localOff+26), le=u16(b,localOff+28), start=localOff+30+ln+le, raw=b.slice(start,start+comp);
    let out; if(method===0) out=raw; else if(method===8) out=new Uint8Array(inflateRawSync(raw)); else throw new Error(`unsupported ZIP method ${method}`);
    if(out.byteLength!==uncomp) throw new Error("uncompressed size mismatch"); return out;
   }});
   p+=46+nameLen+extraLen+commentLen;
  }
  return {entries,close:async()=>{}};
 }
};
